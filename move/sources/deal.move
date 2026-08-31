// Owner: Person 1 (Move/contracts).
//
// Deal is a single escrowed engagement between a client agent and a specialist
// agent: funds are drawn from the client's Mandate, work is delivered
// off-chain, a proof object is recorded, and the escrow settles. See
// /docs/ARCHITECTURE.md for the full PTB sequence.
//
// Shared object: the client locks escrow, the specialist marks delivery, and
// settlement touches both parties' Reputation. No single address owns the
// whole lifecycle, so shared is forced.
//
// ---------------------------------------------------------------------------
// TWO PROPERTIES THIS MODULE NOW GUARANTEES, AND WHY THEY WERE MISSING
// ---------------------------------------------------------------------------
//
// 1. EVERY STATE HAS A UNILATERAL EXIT ON A TIMER.
//
//    Previously escrow had no terminating path that did not require the
//    counterparty's cooperation: `Escrowed` needed the specialist to deliver,
//    `Delivered` needed the client to release, and `Disputed` was terminal
//    with a live balance. So each party held a free, irreversible option to
//    destroy the other's money by doing nothing. An escrow whose only exit
//    requires bilateral cooperation is not an escrow.
//
//    Now every non-terminal state exits on a deadline, and the timeout paths
//    are PERMISSIONLESS — anyone may poke them. That is safe precisely because
//    of property 2: the destination is fixed by the contract, so there is
//    nothing for a caller to steal, and a specialist who has run out of gas
//    can still be paid by someone else poking the contract.
//
// 2. THE MODULE PINS THE PAYEE. IT NEVER RETURNS THE ESCROW TO THE CALLER.
//
//    `verify_and_release` used to return the `Coin<SUI>` so the PTB could
//    route it, following the "return, don't transfer" composability rule. That
//    rule assumes caller discretion is benign. Here it is not: release is
//    client-signed and the beneficiary is the SPECIALIST, so a client could
//    call release and transfer the payout back to themselves — keeping the
//    money AND the work, while the deal read `Released` and the specialist was
//    credited a completed deal.
//
//    The rule survives, correctly scoped: return the object when the caller is
//    the beneficiary; pin the recipient when it is not. Every payout here is
//    resolved through the registry, so it follows an identity's live owner.
//
// Access control note: Deal stores agent IDs, not addresses, exactly as
// /docs/ARCHITECTURE.md fixes the fields. So functions that need to know WHO
// is calling take the caller's `&AgentIdentity` and check both that the
// identity is the right party on the Deal and that the sender owns it.
module custodia::deal;

use std::string::String;
use sui::balance::{Self, Balance};
use sui::clock::Clock;
use sui::coin::{Self, Coin};
use sui::event;
use sui::sui::SUI;
use custodia::agent_identity::{Self, AgentIdentity, AgentRegistry};
use custodia::mandate::{Self, Mandate};
use custodia::proof::DealProof;
use custodia::reputation::Reputation;

#[error]
const ENotSpecialist: vector<u8> = b"Caller is not the specialist agent on this deal";

#[error]
const ENotClient: vector<u8> = b"Caller is not the client agent on this deal";

/// Separate from ENotSpecialist/ENotClient on purpose: identity-match and
/// identity-ownership are two different failures, and sharing one code made it
/// impossible for a test to prove which assert actually fired.
#[error]
const ENotIdentityOwner: vector<u8> = b"Transaction sender does not own this agent identity";

#[error]
const EWrongReputation: vector<u8> = b"Reputation object is not this agent's canonical one";

#[error]
const EZeroAmount: vector<u8> = b"Custodia amount must be greater than zero";

#[error]
const ESameAgent: vector<u8> = b"Client and specialist must be different agents";

#[error]
const ESameOwner: vector<u8> = b"Client and specialist agents must have different owners";

#[error]
const ESpecialistNotRegistered: vector<u8> = b"Specialist agent is not in the registry";

#[error]
const EAgentNotInRegistry: vector<u8> = b"Cannot resolve a payout address for this agent";

#[error]
const EInvalidTransition: vector<u8> = b"Illegal deal status transition";

#[error]
const EDeadlineNotReached: vector<u8> = b"The deadline for this deal stage has not passed";

#[error]
const EDeadlinePassed: vector<u8> = b"The deadline for this deal stage has passed";

#[error]
const EWindowOutOfRange: vector<u8> = b"Delivery or review window outside the permitted range";

#[error]
const EWrongMandate: vector<u8> = b"Mandate is not the one that funded this deal";

#[error]
const ETermsMismatch: vector<u8> = b"Deal terms differ from the terms being accepted";

#[error]
const ENotArbiter: vector<u8> = b"Caller is not the arbiter named on this deal";

#[error]
const ENoArbiter: vector<u8> = b"This deal names no arbiter; wait for the dispute deadline";

#[error]
const EInvalidSplit: vector<u8> = b"Split must be between 0 and 10000 basis points";

#[error]
const EProofNotForThisDeal: vector<u8> = b"Proof was created for a different deal";

#[error]
const EProofNotBySpecialist: vector<u8> = b"Proof was not created by this deal's specialist";

/// Bounds on the client-set windows. The MIN delivery window stops a deal
/// being born already expired. The MAX review window protects the SPECIALIST
/// by capping how long the client can make them wait — a bound imposed by the
/// counterparty is exactly where one is needed. The MAX delivery window
/// catches the bug class this project already hit once: a seconds-vs-
/// milliseconds mix-up produces a timestamp 1000x off and would otherwise lock
/// funds for centuries.
const MIN_WINDOW_MS: u64 = 3_600_000; // 1 hour
const MAX_DELIVERY_WINDOW_MS: u64 = 2_592_000_000; // 30 days
const MAX_REVIEW_WINDOW_MS: u64 = 604_800_000; // 7 days

/// The arbiter's response time. Protocol-set, not client-set, because neither
/// party should get to choose how long the referee has.
const DISPUTE_WINDOW_MS: u64 = 604_800_000; // 7 days

/// Where an unresolved dispute lands when the arbiter never responds. This is
/// what makes an arbiter unable to stall: they can move the outcome away from
/// the default within the window, and nothing else.
const DEFAULT_CLIENT_BPS: u64 = 5_000;
const BPS_DENOM: u64 = 10_000;

public enum DealStatus has copy, drop, store {
    Negotiating,
    Escrowed,
    Accepted,
    Delivered,
    Verified,
    Released,
    Disputed,
    Refunded,
    Settled,
}

public struct Deal has key {
    id: UID,
    client_agent: ID,
    specialist_agent: ID,
    escrowed_amount: Balance<SUI>,
    status: DealStatus,
    /// Set by `mark_delivered`, and now bound: the referenced `DealProof`
    /// carries this deal's ID and was created by this specialist. Previously
    /// this was an arbitrary caller-supplied ID that nothing validated, so it
    /// could point at another deal's proof, a random object, or nothing.
    proof_ref: Option<ID>,
    /// The Mandate this deal drew from. Refunds MUST return to it — without
    /// this binding an attacker could refund a deal funded by someone else's
    /// Mandate into their own, and every refunded deal would permanently burn
    /// the human's spending cap.
    funding_mandate: ID,
    /// Optional mutually-known referee, set by the client and ratified by the
    /// specialist's signature in `accept`. If none, `resolve_dispute` is
    /// uncallable and the deadline default is the only path — a fully
    /// trustless dispute route with a symmetric, known-in-advance outcome.
    arbiter: Option<address>,
    /// Agreed at creation, applied at delivery, so it must persist.
    review_window_ms: u64,
    /// ONE deadline field for three clocks, disambiguated by `status`, because
    /// they are never live simultaneously:
    ///   Escrowed / Accepted -> delivery deadline
    ///   Delivered           -> review deadline
    ///   Disputed            -> dispute deadline
    ///   terminal            -> meaningless
    stage_deadline_ms: u64,
}

/// `amount` and `category` are carried here because neither is readable from
/// the Deal after settlement: `escrowed_amount` drops to zero, and `category`
/// is consumed by the mandate check and never stored. The terms are here too
/// so a specialist can decide whether to `accept` from the event stream alone.
public struct DealCreated has copy, drop {
    deal_id: ID,
    client_agent: ID,
    specialist_agent: ID,
    amount: u64,
    category: String,
    stage_deadline_ms: u64,
    review_window_ms: u64,
    arbiter: Option<address>,
}

public struct DealAccepted has copy, drop {
    deal_id: ID,
    specialist_agent: ID,
    stage_deadline_ms: u64,
}

public struct DealDelivered has copy, drop {
    deal_id: ID,
    proof_ref: ID,
    stage_deadline_ms: u64,
}

public struct DealReleased has copy, drop {
    deal_id: ID,
    specialist_agent: ID,
    amount: u64,
    /// The module pinned this, so it is a fact rather than a claim.
    paid_to: address,
    /// True when the client never responded and the review window elapsed.
    by_timeout: bool,
}

public enum RefundReason has copy, drop, store {
    OfferWithdrawn,
    DeliveryMissed,
    SpecialistConceded,
}

public struct DealRefunded has copy, drop {
    deal_id: ID,
    client_agent: ID,
    amount: u64,
    reason: RefundReason,
}

public struct DealDisputed has copy, drop {
    deal_id: ID,
    raised_by: ID,
    stage_deadline_ms: u64,
}

public struct DealSettled has copy, drop {
    deal_id: ID,
    client_amount: u64,
    specialist_amount: u64,
    /// None when the dispute window elapsed and the default split applied.
    resolved_by: Option<address>,
}

// ---------------------------------------------------------------------------
// Creation
// ---------------------------------------------------------------------------

/// PTB #1 entry point — lock-escrow-and-create-deal (Person 2).
///
/// Draws `amount` from the client's Mandate (which now custodies the funds)
/// and returns the Deal. The mandate assertions run BEFORE any funds move, so
/// an out-of-bounds spend aborts the whole PTB and no escrow is ever created.
///
/// Takes the client's `&AgentIdentity` but only the specialist's `ID`, and the
/// asymmetry is forced: the specialist's identity is an address-owned object
/// belonging to someone else, and a transaction cannot take another address's
/// owned object as an input. The specialist is validated against the shared
/// registry instead.
public fun create_and_lock_escrow(
    mandate: &mut Mandate,
    registry: &AgentRegistry,
    client: &AgentIdentity,
    specialist_agent: ID,
    category: String,
    amount: u64,
    delivery_window_ms: u64,
    review_window_ms: u64,
    arbiter: Option<address>,
    clock: &Clock,
    ctx: &mut TxContext,
): Deal {
    assert!(client.owner() == ctx.sender(), ENotIdentityOwner);
    let client_agent = object::id(client);

    assert!(client_agent != specialist_agent, ESameAgent);
    assert!(amount > 0, EZeroAmount);
    assert!(
        delivery_window_ms >= MIN_WINDOW_MS && delivery_window_ms <= MAX_DELIVERY_WINDOW_MS,
        EWindowOutOfRange,
    );
    assert!(
        review_window_ms >= MIN_WINDOW_MS && review_window_ms <= MAX_REVIEW_WINDOW_MS,
        EWindowOutOfRange,
    );

    let summary = registry.summary_of(specialist_agent);
    assert!(summary.is_some(), ESpecialistNotRegistered);
    let summary = summary.destroy_some();

    // A speed bump, not Sybil resistance — addresses are free, so a determined
    // attacker uses two wallets. It raises wash-trading from one wallet and one
    // PTB to two wallets and two signed transactions, and removes the case
    // where the same address sits on both sides of a deal. The real fix is an
    // external identity anchor (SuiNS ownership proof), which is not buildable
    // here: no installed skill covers SuiNS. Documented, not pretended away.
    assert!(summary.summary_owner() != client.owner(), ESameOwner);

    // Custody: the coin comes OUT OF the Mandate, not the delegate's wallet.
    // This is what makes the spend cap real rather than advisory.
    let payment = mandate.withdraw_for_escrow(amount, category, clock, ctx);

    let mut deal = Deal {
        id: object::new(ctx),
        client_agent,
        specialist_agent,
        escrowed_amount: payment.into_balance(),
        status: DealStatus::Negotiating,
        proof_ref: option::none(),
        funding_mandate: object::id(mandate),
        arbiter,
        review_window_ms,
        stage_deadline_ms: clock.timestamp_ms() + delivery_window_ms,
    };

    // Constructed at Negotiating and stepped forward through assert_transition
    // rather than assigned directly, so the spec'd first variant is genuinely
    // part of the code path.
    assert_transition(deal.status, DealStatus::Escrowed);
    deal.status = DealStatus::Escrowed;

    event::emit(DealCreated {
        deal_id: object::id(&deal),
        client_agent,
        specialist_agent,
        amount,
        category,
        stage_deadline_ms: deal.stage_deadline_ms,
        review_window_ms,
        arbiter,
    });

    deal
}

entry fun create_and_share(
    mandate: &mut Mandate,
    registry: &AgentRegistry,
    client: &AgentIdentity,
    specialist_agent: ID,
    category: String,
    amount: u64,
    delivery_window_ms: u64,
    review_window_ms: u64,
    arbiter: Option<address>,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    let deal = create_and_lock_escrow(
        mandate,
        registry,
        client,
        specialist_agent,
        category,
        amount,
        delivery_window_ms,
        review_window_ms,
        arbiter,
        clock,
        ctx,
    );
    share(deal);
}

/// Shares a Deal. `Deal` has `key` and no `store`, so `share_object` is
/// restricted to this module and `public_share_object` is unavailable —
/// without this public consume path a PTB calling `create_and_lock_escrow`
/// would hold a value it cannot dispose of and the transaction would fail with
/// `UnusedValueWithoutDrop`.
public fun share(deal: Deal) {
    transfer::share_object(deal);
}

// ---------------------------------------------------------------------------
// Specialist assent
// ---------------------------------------------------------------------------

/// The specialist's on-chain assent to the amount, deadlines and arbiter.
///
/// This is the step that makes the protocol able to tell "the specialist
/// ghosted" apart from "someone fabricated a deal nobody agreed to". Without
/// it, `claim_refund` could not fairly record anything against the specialist,
/// because anyone can name any registered agent as the specialist on a deal
/// they never saw. With it, a refund after acceptance is an objectively true
/// on-chain fact: they said yes, then did not deliver.
///
/// The `expected_*` arguments are echoes: they put the terms the specialist
/// actually agreed to into transaction history, so an auditor never has to
/// reconstruct historical object state to know what was assented to.
public fun accept(
    deal: &mut Deal,
    specialist: &AgentIdentity,
    expected_arbiter: Option<address>,
    expected_deadline_ms: u64,
    expected_amount: u64,
    clock: &Clock,
    ctx: &TxContext,
) {
    assert!(object::id(specialist) == deal.specialist_agent, ENotSpecialist);
    assert!(specialist.owner() == ctx.sender(), ENotIdentityOwner);

    assert!(expected_arbiter == deal.arbiter, ETermsMismatch);
    assert!(expected_deadline_ms == deal.stage_deadline_ms, ETermsMismatch);
    assert!(expected_amount == deal.escrowed_amount.value(), ETermsMismatch);

    assert!(clock.timestamp_ms() < deal.stage_deadline_ms, EDeadlinePassed);

    assert_transition(deal.status, DealStatus::Accepted);
    deal.status = DealStatus::Accepted;

    event::emit(DealAccepted {
        deal_id: object::id(deal),
        specialist_agent: deal.specialist_agent,
        stage_deadline_ms: deal.stage_deadline_ms,
    });
}

// ---------------------------------------------------------------------------
// Delivery
// ---------------------------------------------------------------------------

/// Specialist-only. Records delivery and points `proof_ref` at a real proof
/// object, then starts the client's review clock.
///
/// The two proof asserts are the difference between a pointer and a proof. A
/// bare unvalidated ID let a specialist do the work once and cite it across N
/// deals, or replay a third party's genuine attestation as their own.
public fun mark_delivered(
    deal: &mut Deal,
    specialist: &AgentIdentity,
    proof: &DealProof,
    clock: &Clock,
    ctx: &TxContext,
) {
    assert!(object::id(specialist) == deal.specialist_agent, ENotSpecialist);
    assert!(specialist.owner() == ctx.sender(), ENotIdentityOwner);

    assert!(proof.deal_id() == object::id(deal), EProofNotForThisDeal);
    assert!(proof.created_by() == specialist.owner(), EProofNotBySpecialist);

    assert!(clock.timestamp_ms() < deal.stage_deadline_ms, EDeadlinePassed);

    assert_transition(deal.status, DealStatus::Delivered);
    deal.status = DealStatus::Delivered;
    deal.proof_ref = option::some(object::id(proof));
    deal.stage_deadline_ms = clock.timestamp_ms() + deal.review_window_ms;

    event::emit(DealDelivered {
        deal_id: object::id(deal),
        proof_ref: object::id(proof),
        stage_deadline_ms: deal.stage_deadline_ms,
    });
}

// ---------------------------------------------------------------------------
// Settlement — release
// ---------------------------------------------------------------------------

/// PTB #2 entry point — verify-and-release-and-update-reputation (Person 2).
///
/// CLIENT-ONLY, and that is the security boundary. Reaching `Delivered`
/// requires only the specialist's own signature, so if the specialist could
/// also release they could deliver a junk proof and release in one atomic PTB.
/// The client's signature IS the acceptance step the flow otherwise lacks.
/// Widening this to "either party" would reopen that hole.
///
/// Callable from `Delivered` (the happy path) and from `Disputed` (the client
/// concedes) — a concession is an act against the actor's own interest, so it
/// needs no counterparty signature and no arbiter. Most real disputes should
/// end in a concession, with no third party involved at all.
///
/// Returns NOTHING. See the header note on pinning the payee.
///
/// NOTE on what "verify" means: this confirms the deal reached Delivered with
/// a bound proof object and that the client signed off. It does NOT
/// cryptographically verify a Nautilus attestation on-chain — that would need
/// AWS certificate-chain verification in Move, which is out of scope. Do not
/// describe this as on-chain attestation verification in the demo.
public fun verify_and_release(
    deal: &mut Deal,
    registry: &AgentRegistry,
    client: &AgentIdentity,
    client_reputation: &mut Reputation,
    specialist_reputation: &mut Reputation,
    ctx: &mut TxContext,
) {
    assert!(object::id(client) == deal.client_agent, ENotClient);
    assert!(client.owner() == ctx.sender(), ENotIdentityOwner);

    deal.assert_canonical_reputations(registry, client, client_reputation, specialist_reputation);

    // From Delivered the deal passes through the spec'd `Verified` step. From
    // Disputed it goes straight to Released — the client conceding is not a
    // verification, and Disputed -> Verified is not a legal edge.
    if (rank(deal.status) == 3) {
        assert_transition(deal.status, DealStatus::Verified);
        deal.status = DealStatus::Verified;
    };

    assert_transition(deal.status, DealStatus::Released);
    deal.status = DealStatus::Released;

    deal.pay_specialist(registry, false, ctx);

    client_reputation.record_completed();
    specialist_reputation.record_completed();
}

/// Permissionless once the review window has elapsed. This is the answer to a
/// non-responsive client holding a specialist's payment hostage.
///
/// Permissionless is safe because the destination is fixed by the contract:
/// there is nothing for a caller to steal, and a specialist who has run out of
/// gas can still be paid by anyone poking the contract. Liveness stops
/// depending on one party being online and funded.
///
/// The client is NOT credited a completed deal here — delivery happened and
/// went uncontested, but the client did not participate in settling it.
public fun claim_release(
    deal: &mut Deal,
    registry: &AgentRegistry,
    specialist_reputation: &mut Reputation,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    assert!(clock.timestamp_ms() >= deal.stage_deadline_ms, EDeadlineNotReached);
    assert!(
        specialist_reputation.agent_id() == deal.specialist_agent,
        EWrongReputation,
    );
    deal.assert_canonical_specialist_reputation(registry, specialist_reputation);

    assert_transition(deal.status, DealStatus::Released);
    deal.status = DealStatus::Released;

    deal.pay_specialist(registry, true, ctx);

    specialist_reputation.record_completed();
}

// ---------------------------------------------------------------------------
// Settlement — refund
// ---------------------------------------------------------------------------

/// Client withdraws an offer the specialist never accepted. Nothing is at
/// stake yet, so no reputation moves on either side.
///
/// Only from `Escrowed`. Once the specialist has accepted they may have
/// started work, and a unilateral cancel would be a rug — that is exactly what
/// `accept` buys them.
public fun withdraw_offer(
    deal: &mut Deal,
    mandate: &mut Mandate,
    client: &AgentIdentity,
    ctx: &mut TxContext,
) {
    assert!(object::id(client) == deal.client_agent, ENotClient);
    assert!(client.owner() == ctx.sender(), ENotIdentityOwner);

    // Escrowed ONLY. `Accepted -> Refunded` is a legal edge in the matrix
    // because `claim_refund` uses it after the delivery deadline, so the
    // transition guard alone would let a client cancel work already under way.
    // This is the assert that makes `accept` mean something.
    assert!(rank(deal.status) == 1, EInvalidTransition);

    assert_transition(deal.status, DealStatus::Refunded);
    deal.status = DealStatus::Refunded;

    deal.refund_to_mandate(mandate, RefundReason::OfferWithdrawn, ctx);
}

/// Permissionless once the delivery deadline has passed. Returns the escrow to
/// the funding Mandate.
///
/// The specialist is recorded as disputed ONLY if they had accepted: acceptance
/// makes "said yes, then did not deliver" an objectively true on-chain fact.
/// Without acceptance the deal was never mutual — anyone can name any
/// registered agent as specialist — so dinging them would hand every attacker
/// a free reputation weapon.
public fun claim_refund(
    deal: &mut Deal,
    registry: &AgentRegistry,
    mandate: &mut Mandate,
    specialist_reputation: &mut Reputation,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    assert!(clock.timestamp_ms() >= deal.stage_deadline_ms, EDeadlineNotReached);
    assert!(
        specialist_reputation.agent_id() == deal.specialist_agent,
        EWrongReputation,
    );
    deal.assert_canonical_specialist_reputation(registry, specialist_reputation);

    let was_accepted = deal.status == DealStatus::Accepted;

    assert_transition(deal.status, DealStatus::Refunded);
    deal.status = DealStatus::Refunded;

    deal.refund_to_mandate(mandate, RefundReason::DeliveryMissed, ctx);

    if (was_accepted) {
        specialist_reputation.record_disputed();
    };
}

/// The specialist concedes a dispute. Disputed -> Refunded, no arbiter needed.
public fun concede_refund(
    deal: &mut Deal,
    registry: &AgentRegistry,
    mandate: &mut Mandate,
    specialist: &AgentIdentity,
    specialist_reputation: &mut Reputation,
    ctx: &mut TxContext,
) {
    assert!(object::id(specialist) == deal.specialist_agent, ENotSpecialist);
    assert!(specialist.owner() == ctx.sender(), ENotIdentityOwner);
    assert!(
        object::id(specialist_reputation) == specialist.reputation_id(),
        EWrongReputation,
    );
    let _ = registry;

    assert_transition(deal.status, DealStatus::Refunded);
    deal.status = DealStatus::Refunded;

    deal.refund_to_mandate(mandate, RefundReason::SpecialistConceded, ctx);

    specialist_reputation.record_disputed();
}

// ---------------------------------------------------------------------------
// Dispute
// ---------------------------------------------------------------------------

/// CLIENT-ONLY, and only from `Delivered`, inside the review window.
///
/// Both constraints are load-bearing. Client-only, because a specialist
/// disputing their own deal would just be a way to freeze the client's funds.
/// Delivered-only, because a dispute is about the QUALITY of delivered work,
/// and quality does not exist before delivery — pre-delivery the only question
/// is "did they deliver in time", which the chain answers itself via
/// `claim_refund`.
///
/// Delivered-only is also what stops a free griefing weapon: since reaching
/// `Delivered` requires the specialist's own signature, no agent can be
/// dragged into a dispute over a deal they never engaged with.
public fun raise_dispute(
    deal: &mut Deal,
    client: &AgentIdentity,
    clock: &Clock,
    ctx: &TxContext,
) {
    assert!(object::id(client) == deal.client_agent, ENotClient);
    assert!(client.owner() == ctx.sender(), ENotIdentityOwner);

    assert!(clock.timestamp_ms() < deal.stage_deadline_ms, EDeadlinePassed);

    assert_transition(deal.status, DealStatus::Disputed);
    deal.status = DealStatus::Disputed;
    deal.stage_deadline_ms = clock.timestamp_ms() + DISPUTE_WINDOW_MS;

    event::emit(DealDisputed {
        deal_id: object::id(deal),
        raised_by: deal.client_agent,
        stage_deadline_ms: deal.stage_deadline_ms,
    });
}

/// Arbiter-only. Splits THIS deal's escrow between THESE two parties.
///
/// This is the arbiter's entire power. They have no custody, cannot name a
/// third address, cannot take a fee, cannot touch another deal, and cannot
/// stall — `settle_default` routes around them once the window closes. They
/// were named by the client at creation and ratified by the specialist's
/// signature in `accept`, so neither party can impose a referee on the other.
public fun resolve_dispute(
    deal: &mut Deal,
    registry: &AgentRegistry,
    mandate: &mut Mandate,
    client_reputation: &mut Reputation,
    specialist_reputation: &mut Reputation,
    client_bps: u64,
    ctx: &mut TxContext,
) {
    assert!(deal.arbiter.is_some(), ENoArbiter);
    assert!(*deal.arbiter.borrow() == ctx.sender(), ENotArbiter);
    assert!(client_bps <= BPS_DENOM, EInvalidSplit);

    deal.settle(
        registry,
        mandate,
        client_reputation,
        specialist_reputation,
        client_bps,
        option::some(ctx.sender()),
        ctx,
    );
}

/// Permissionless once the dispute window has elapsed. Splits at the default.
/// This is what makes an arbiter unable to stall, and what gives an
/// arbiter-less deal a terminal outcome that both sides knew in advance.
public fun settle_default(
    deal: &mut Deal,
    registry: &AgentRegistry,
    mandate: &mut Mandate,
    client_reputation: &mut Reputation,
    specialist_reputation: &mut Reputation,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    assert!(clock.timestamp_ms() >= deal.stage_deadline_ms, EDeadlineNotReached);

    deal.settle(
        registry,
        mandate,
        client_reputation,
        specialist_reputation,
        DEFAULT_CLIENT_BPS,
        option::none(),
        ctx,
    );
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

fun settle(
    deal: &mut Deal,
    registry: &AgentRegistry,
    mandate: &mut Mandate,
    client_reputation: &mut Reputation,
    specialist_reputation: &mut Reputation,
    client_bps: u64,
    resolved_by: Option<address>,
    ctx: &mut TxContext,
) {
    assert!(object::id(mandate) == deal.funding_mandate, EWrongMandate);
    assert!(client_reputation.agent_id() == deal.client_agent, EWrongReputation);
    assert!(specialist_reputation.agent_id() == deal.specialist_agent, EWrongReputation);
    deal.assert_canonical_specialist_reputation(registry, specialist_reputation);

    assert_transition(deal.status, DealStatus::Settled);
    deal.status = DealStatus::Settled;

    let total = deal.escrowed_amount.value();

    // Overflow-safe and cast-free. The naive `total * client_bps / BPS_DENOM`
    // overflows u64 above roughly 1.8M SUI. Here
    // `(total % BPS_DENOM) * client_bps <= 9_999 * 10_000 < 10^8`.
    // The specialist's share is computed by subtraction so rounding dust can
    // never be stranded in the Deal.
    let client_amount =
        (total / BPS_DENOM) * client_bps + ((total % BPS_DENOM) * client_bps) / BPS_DENOM;
    let specialist_amount = total - client_amount;

    if (client_amount > 0) {
        let back = coin::from_balance(deal.escrowed_amount.split(client_amount), ctx);
        mandate.refund(back);
    };

    if (specialist_amount > 0) {
        let owner = specialist_owner(registry, deal.specialist_agent);
        let payout = coin::from_balance(deal.escrowed_amount.split(specialist_amount), ctx);
        transfer::public_transfer(payout, owner);
    };

    client_reputation.record_disputed();
    specialist_reputation.record_disputed();

    event::emit(DealSettled {
        deal_id: object::id(deal),
        client_amount,
        specialist_amount,
        resolved_by,
    });
}

fun pay_specialist(deal: &mut Deal, registry: &AgentRegistry, by_timeout: bool, ctx: &mut TxContext) {
    let owner = specialist_owner(registry, deal.specialist_agent);
    let amount = deal.escrowed_amount.value();
    let payout = coin::from_balance(deal.escrowed_amount.withdraw_all(), ctx);
    transfer::public_transfer(payout, owner);

    event::emit(DealReleased {
        deal_id: object::id(deal),
        specialist_agent: deal.specialist_agent,
        amount,
        paid_to: owner,
        by_timeout,
    });
}

fun refund_to_mandate(
    deal: &mut Deal,
    mandate: &mut Mandate,
    reason: RefundReason,
    ctx: &mut TxContext,
) {
    assert!(object::id(mandate) == deal.funding_mandate, EWrongMandate);

    let amount = deal.escrowed_amount.value();
    let back = coin::from_balance(deal.escrowed_amount.withdraw_all(), ctx);
    mandate.refund(back);

    event::emit(DealRefunded {
        deal_id: object::id(deal),
        client_agent: deal.client_agent,
        amount,
        reason,
    });
}

fun specialist_owner(registry: &AgentRegistry, specialist_agent: ID): address {
    let owner = registry.owner_of(specialist_agent);
    assert!(owner.is_some(), EAgentNotInRegistry);
    owner.destroy_some()
}

/// Both Reputations must be the CANONICAL ones — the objects
/// `AgentIdentity.reputation_id` points at — not merely objects that claim the
/// right `agent_id`. `reputation::new` is package-only, which already makes
/// one-per-agent true; this asserts it rather than relying on that invariant
/// being maintained by review, since package visibility extends to any module
/// added by a future upgrade.
fun assert_canonical_reputations(
    deal: &Deal,
    registry: &AgentRegistry,
    client: &AgentIdentity,
    client_reputation: &Reputation,
    specialist_reputation: &Reputation,
) {
    assert!(object::id(client_reputation) == client.reputation_id(), EWrongReputation);
    assert!(client_reputation.agent_id() == deal.client_agent, EWrongReputation);
    deal.assert_canonical_specialist_reputation(registry, specialist_reputation);
}

fun assert_canonical_specialist_reputation(
    deal: &Deal,
    registry: &AgentRegistry,
    specialist_reputation: &Reputation,
) {
    let summary = registry.summary_of(deal.specialist_agent);
    assert!(summary.is_some(), EAgentNotInRegistry);
    assert!(
        object::id(specialist_reputation) == summary.destroy_some().summary_reputation_id(),
        EWrongReputation,
    );
}

/// The full legal transition set, written as the matrix it is.
///
/// This replaced rank arithmetic: nine states with three terminals do not
/// linearise, and the old `to == from + 1` form silently permitted edges that
/// only happened to be unreachable.
///
/// Every non-terminal state has at least one time-triggered exit, so there is
/// no cell where inaction is the winning move.
/// Written as explicit (from, to) rank pairs rather than a tuple `match` on
/// two enums: the tuple-pattern form ICEs the 1.78.1 compiler
/// ("ICE should have failed in naming"). This is the same matrix, and it is
/// still an explicit allow-list rather than the old `to == from + 1`
/// arithmetic, which silently permitted edges that only happened to be
/// unreachable.
fun assert_transition(from: DealStatus, to: DealStatus) {
    let f = rank(from);
    let t = rank(to);

    let ok =
        (f == 0 && t == 1) ||                                   // Negotiating -> Escrowed
        (f == 1 && t == 2) || (f == 1 && t == 7) ||             // Escrowed -> Accepted | Refunded
        (f == 2 && t == 3) || (f == 2 && t == 7) ||             // Accepted -> Delivered | Refunded
        (f == 3 && t == 4) || (f == 3 && t == 5) ||             // Delivered -> Verified | Released
        (f == 3 && t == 6) ||                                   // Delivered -> Disputed
        (f == 4 && t == 5) ||                                   // Verified -> Released
        (f == 6 && t == 5) || (f == 6 && t == 7) ||             // Disputed -> Released | Refunded
        (f == 6 && t == 8);                                     // Disputed -> Settled

    assert!(ok, EInvalidTransition);
}

fun rank(status: DealStatus): u8 {
    match (status) {
        DealStatus::Negotiating => 0,
        DealStatus::Escrowed => 1,
        DealStatus::Accepted => 2,
        DealStatus::Delivered => 3,
        DealStatus::Verified => 4,
        DealStatus::Released => 5,
        DealStatus::Disputed => 6,
        DealStatus::Refunded => 7,
        DealStatus::Settled => 8,
    }
}

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

public fun client_agent(deal: &Deal): ID {
    deal.client_agent
}

public fun specialist_agent(deal: &Deal): ID {
    deal.specialist_agent
}

/// Amount still held in escrow. Zero once settled.
public fun escrowed_amount(deal: &Deal): u64 {
    deal.escrowed_amount.value()
}

public fun status(deal: &Deal): DealStatus {
    deal.status
}

/// Numeric status for clients that cannot pattern-match a Move enum.
/// 0 Negotiating · 1 Escrowed · 2 Accepted · 3 Delivered · 4 Verified
/// 5 Released · 6 Disputed · 7 Refunded · 8 Settled
///
/// NOTE for Person 4: these numbers CHANGED when `Accepted` was inserted.
/// Released was 4 and is now 5; Disputed was 5 and is now 6.
public fun status_rank(deal: &Deal): u8 {
    rank(deal.status)
}

public fun proof_ref(deal: &Deal): Option<ID> {
    deal.proof_ref
}

public fun funding_mandate(deal: &Deal): ID {
    deal.funding_mandate
}

public fun arbiter(deal: &Deal): Option<address> {
    deal.arbiter
}

public fun review_window_ms(deal: &Deal): u64 {
    deal.review_window_ms
}

public fun stage_deadline_ms(deal: &Deal): u64 {
    deal.stage_deadline_ms
}

/// The two owner addresses currently party to this deal, resolved through the
/// registry so ownership transfers are reflected.
///
/// Offered to Person 3: an access-control policy can DERIVE its allowlist from
/// this rather than storing a second copy that drifts out of sync after a
/// `transfer_ownership`.
public fun party_owners(deal: &Deal, registry: &AgentRegistry): (address, address) {
    (
        specialist_owner(registry, deal.client_agent),
        specialist_owner(registry, deal.specialist_agent),
    )
}

// ---------------------------------------------------------------------------
// Test-only event accessors
// ---------------------------------------------------------------------------
//
// Event struct fields are private to their defining module, so a test module
// can retrieve a `DealReleased` via `sui::event::events_by_type` but cannot
// read it. These accessors exist so the event stream — which is Person 2's
// only source for a new Deal's ID and Person 4's only source for receipt
// amount and category — can actually be asserted. `#[test_only]` code is
// stripped from published bytecode, so they cost nothing on-chain.

#[test_only]
public fun released_paid_to(e: &DealReleased): address { e.paid_to }

#[test_only]
public fun released_amount(e: &DealReleased): u64 { e.amount }

#[test_only]
public fun released_by_timeout(e: &DealReleased): bool { e.by_timeout }

#[test_only]
public fun created_amount(e: &DealCreated): u64 { e.amount }

#[test_only]
public fun created_category(e: &DealCreated): String { e.category }

#[test_only]
public fun created_deal_id(e: &DealCreated): ID { e.deal_id }

#[test_only]
public fun settled_client_amount(e: &DealSettled): u64 { e.client_amount }

#[test_only]
public fun settled_specialist_amount(e: &DealSettled): u64 { e.specialist_amount }

#[test_only]
public fun settled_resolved_by(e: &DealSettled): Option<address> { e.resolved_by }

#[test_only]
public fun refunded_amount(e: &DealRefunded): u64 { e.amount }
