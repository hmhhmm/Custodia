// Owner: Person 1 (Move/contracts).
//
// Deal represents a single escrowed engagement between a client agent and a
// specialist agent: funds are locked, work is delivered off-chain, verified
// (proof_ref points at a Walrus/Nautilus-backed record — see Person 3's
// verification flow), and then released. This is the core escrow lock/release
// logic. See /docs/ARCHITECTURE.md for the full PTB sequence.
//
// Shared object: the client locks escrow, the specialist marks delivery, and
// release touches both parties' Reputation. No single address owns the whole
// lifecycle, so shared is forced.
//
// Access control note: Deal stores agent IDs, not addresses, exactly as
// /docs/ARCHITECTURE.md fixes the fields (per /CLAUDE.md rule 5 the four core
// objects' fields are not to be restructured). So functions that need to know
// WHO is calling take the caller's `&AgentIdentity` and check both that the
// identity is the right party on the Deal and that the sender owns it.
module escrow::deal;

use std::string::String;
use sui::balance::Balance;
use sui::clock::Clock;
use sui::coin::{Self, Coin};
use sui::event;
use sui::sui::SUI;
use escrow::agent_identity::{AgentIdentity, AgentRegistry};
use escrow::mandate::Mandate;
use escrow::reputation::Reputation;

#[error]
const ENotSpecialist: vector<u8> = b"Caller is not the specialist agent on this deal";

#[error]
const ENotClient: vector<u8> = b"Caller is not the client agent on this deal";

#[error]
const ENotParty: vector<u8> = b"Caller is not a party to this deal";

/// Separate from ENotSpecialist/ENotClient/ENotParty on purpose: identity-match
/// and identity-ownership are two different failures, and sharing one code made
/// it impossible for a test to prove which assert actually fired.
#[error]
const ENotIdentityOwner: vector<u8> = b"Transaction sender does not own this agent identity";

#[error]
const EWrongReputation: vector<u8> = b"Reputation object does not belong to this deal's agent";

#[error]
const ENoProof: vector<u8> = b"Deal has no proof_ref set";

#[error]
const EZeroAmount: vector<u8> = b"Escrow amount must be greater than zero";

#[error]
const ESameAgent: vector<u8> = b"Client and specialist must be different agents";

#[error]
const ESpecialistNotRegistered: vector<u8> = b"Specialist agent is not in the registry";

#[error]
const EInvalidTransition: vector<u8> = b"Illegal deal status transition";

public enum DealStatus has copy, drop, store {
    Negotiating,
    Escrowed,
    Delivered,
    Verified,
    Released,
    Disputed,
}

public struct Deal has key {
    id: UID,
    client_agent: ID,
    specialist_agent: ID,
    escrowed_amount: Balance<SUI>,
    status: DealStatus,
    /// Set by `mark_delivered`. Points at Person 3's verification record.
    /// STILL `Option<ID>` and deliberately so — Person 3's proposed `DealProof`
    /// shape (Walrus blob ID + attestation ID + `attestation_mocked` bool, see
    /// frontend/src/verification/proof.ts) is not yet confirmed, and building
    /// the on-chain object now would lock in a format nobody has agreed to.
    proof_ref: Option<ID>,
}

/// `amount` and `category` are carried here because neither is readable from
/// the Deal after release: `escrowed_amount` drops to zero, and `category` is
/// consumed by the mandate check and never stored. Person 4's receipt and
/// dashboard (`DealReceipt.amount`, `DealSummary.category`) have no other
/// on-chain source, so this event is their only one.
///
/// Event structs are frozen at publish like any other, so this field was added
/// now rather than discovered missing later.
public struct DealCreated has copy, drop {
    deal_id: ID,
    client_agent: ID,
    specialist_agent: ID,
    amount: u64,
    category: String,
}

public struct DealDelivered has copy, drop {
    deal_id: ID,
    proof_ref: ID,
}

public struct DealReleased has copy, drop {
    deal_id: ID,
    specialist_agent: ID,
    amount: u64,
}

public struct DealDisputed has copy, drop {
    deal_id: ID,
    raised_by: ID,
}

/// PTB #1 entry point — lock-escrow-and-create-deal (Person 2).
///
/// Checks the Mandate, locks `payment` into escrow, and returns the Deal. The
/// mandate assertions run BEFORE any funds move, so an out-of-bounds spend
/// aborts the whole PTB and no escrow is ever created.
///
/// Returns the Deal rather than sharing it internally so the PTB stays
/// composable — the returned value is consumed with the public `share` below,
/// or `create_and_share` does both in one call.
///
/// Takes the client's `&AgentIdentity` but only the specialist's `ID`, and that
/// asymmetry is forced: the specialist's identity is an address-owned object
/// belonging to someone else, and a transaction cannot take another address's
/// owned object as an input. The specialist is instead validated against the
/// shared registry, which is enough to reject a fabricated ID.
public fun create_and_lock_escrow(
    mandate: &mut Mandate,
    registry: &AgentRegistry,
    client: &AgentIdentity,
    payment: Coin<SUI>,
    specialist_agent: ID,
    category: String,
    clock: &Clock,
    ctx: &mut TxContext,
): Deal {
    mandate.assert_is_delegate(ctx);

    // Binds the deal's client agent to the mandate's delegate. Previously
    // `client_agent` was an unvalidated caller-supplied ID, so a delegate could
    // emit DealCreated naming any victim's agent as the client.
    assert!(client.owner() == ctx.sender(), ENotIdentityOwner);
    let client_agent = object::id(client);

    // Blocks self-dealing: one owner controlling both sides of a deal credited
    // both reputations on release, which made a forged track record free.
    assert!(client_agent != specialist_agent, ESameAgent);
    assert!(registry.is_registered(specialist_agent), ESpecialistNotRegistered);

    let amount = payment.value();
    // Zero-value deals cost nothing to create, which is what made reputation
    // farming and dispute griefing free.
    assert!(amount > 0, EZeroAmount);

    mandate.assert_within_mandate(amount, category, clock);
    mandate.record_spend(amount);

    // Constructed at Negotiating and stepped forward through assert_transition
    // rather than assigned Escrowed directly, so the spec'd first variant is
    // actually part of the code path. It still does not persist on-chain — a
    // real negotiation phase would need its own entry point, which is out of
    // scope — but the state machine is no longer entered by assignment.
    let mut deal = Deal {
        id: object::new(ctx),
        client_agent,
        specialist_agent,
        escrowed_amount: payment.into_balance(),
        status: DealStatus::Negotiating,
        proof_ref: option::none(),
    };

    assert_transition(&deal.status, &DealStatus::Escrowed);
    deal.status = DealStatus::Escrowed;

    event::emit(DealCreated {
        deal_id: object::id(&deal),
        client_agent,
        specialist_agent,
        amount,
        category,
    });

    deal
}

entry fun create_and_share(
    mandate: &mut Mandate,
    registry: &AgentRegistry,
    client: &AgentIdentity,
    payment: Coin<SUI>,
    specialist_agent: ID,
    category: String,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    let deal = create_and_lock_escrow(
        mandate,
        registry,
        client,
        payment,
        specialist_agent,
        category,
        clock,
        ctx,
    );
    share(deal);
}

/// Shares a Deal. `Deal` has `key` and no `store`, so `share_object` is
/// restricted to this module and `public_share_object` is unavailable. Without
/// this public consume path a PTB calling `create_and_lock_escrow` would hold a
/// value it cannot transfer, share, or drop, and the whole transaction would
/// fail with `UnusedValueWithoutDrop`.
public fun share(deal: Deal) {
    transfer::share_object(deal);
}

/// Specialist-only. Records that work was delivered and points `proof_ref` at
/// Person 3's verification record.
public fun mark_delivered(
    deal: &mut Deal,
    specialist: &AgentIdentity,
    proof_ref: ID,
    ctx: &TxContext,
) {
    assert!(object::id(specialist) == deal.specialist_agent, ENotSpecialist);
    assert!(specialist.owner() == ctx.sender(), ENotIdentityOwner);

    assert_transition(&deal.status, &DealStatus::Delivered);
    deal.status = DealStatus::Delivered;
    deal.proof_ref = option::some(proof_ref);

    event::emit(DealDelivered { deal_id: object::id(deal), proof_ref });
}

/// PTB #2 entry point — verify-and-release-and-update-reputation (Person 2).
///
/// Moves the Deal Delivered -> Verified -> Released, credits both agents'
/// Reputation, and RETURNS the escrowed Coin rather than transferring it
/// internally. Returning it keeps the function composable: the PTB decides
/// where the payout goes (per the `composable-move-functions` skill).
///
/// CLIENT-ONLY, and that is the security boundary, not a preference. Reaching
/// `Delivered` requires only the specialist's own signature, and `proof_ref` is
/// an arbitrary caller-supplied ID that nothing validates — so if the
/// specialist could also release, they could call `mark_delivered` with a junk
/// proof and `verify_and_release` in one atomic PTB and take the escrow having
/// done nothing. Requiring the client's signature here makes that signature the
/// acceptance step the flow otherwise has nowhere.
///
/// This also rules out the wider hole: previously there was NO caller check at
/// all, so any address on the network could release any delivered deal and
/// route the payout to itself. Note that widening this to "either party may
/// call" — mirroring `raise_dispute` — would reopen the specialist self-release
/// path. It must stay client-only.
///
/// NOTE on what "verify" means here: this function confirms the Deal reached
/// Delivered with a proof_ref set, and that the client signed off. It does NOT
/// cryptographically verify a Nautilus attestation on-chain — that would
/// require verifying an AWS certificate chain in Move, which is out of scope
/// (see /docs/ARCHITECTURE.md). Do not describe this as on-chain attestation
/// verification in the demo.
///
/// A non-responsive client can currently hold the escrow indefinitely by simply
/// never calling this. A Clock-based timeout letting the specialist claim after
/// N ms would close that, and is deliberately NOT built here — it is new scope
/// and needs team agreement on the window.
public fun verify_and_release(
    deal: &mut Deal,
    client: &AgentIdentity,
    client_reputation: &mut Reputation,
    specialist_reputation: &mut Reputation,
    ctx: &mut TxContext,
): Coin<SUI> {
    assert!(object::id(client) == deal.client_agent, ENotClient);
    assert!(client.owner() == ctx.sender(), ENotIdentityOwner);

    // Without these two, an attacker passes their own Reputation objects and
    // credits themselves a completed deal off someone else's release.
    assert!(client_reputation.agent_id() == deal.client_agent, EWrongReputation);
    assert!(
        specialist_reputation.agent_id() == deal.specialist_agent,
        EWrongReputation,
    );

    assert_transition(&deal.status, &DealStatus::Verified);

    // Ordered after the transition guard so that releasing an undelivered deal
    // still reports EInvalidTransition, which is the more precise failure.
    // Holds transitively today, since Delivered is only reachable through
    // mark_delivered, which always sets proof_ref — asserted anyway so the
    // guarantee is enforced rather than merely described in the comment above.
    assert!(deal.proof_ref.is_some(), ENoProof);

    deal.status = DealStatus::Verified;

    let amount = deal.escrowed_amount.value();
    let payout = coin::from_balance(deal.escrowed_amount.withdraw_all(), ctx);

    assert_transition(&deal.status, &DealStatus::Released);
    deal.status = DealStatus::Released;

    client_reputation.record_completed();
    specialist_reputation.record_completed();

    event::emit(DealReleased {
        deal_id: object::id(deal),
        specialist_agent: deal.specialist_agent,
        amount,
    });

    payout
}

/// Either party may dispute. Sets status to Disputed and records the dispute
/// against both reputations.
///
/// Dispute RESOLUTION is explicitly out of scope for the hackathon demo per
/// /docs/ARCHITECTURE.md — there is deliberately no function here that moves a
/// Deal out of Disputed or refunds the escrow. Escrowed funds stay locked in
/// the Deal object. Do not build resolution logic without flagging it first.
///
/// "Locked" is precise, and "burned" would not be: Deal is a shared object and
/// struct types stay anchored to the original package ID, so a later upgrade
/// can add a `resolve_dispute` that operates on Deals created today. But that
/// recovery exists only while the UpgradeCap does — destroying it for
/// immutability, or losing it, makes every disputed escrow permanently
/// unreachable. Decide UpgradeCap custody deliberately before publishing.
///
/// Either party can still freeze the other's funds indefinitely at the cost of
/// gas. That is a real griefing primitive and it is not fixed here.
public fun raise_dispute(
    deal: &mut Deal,
    party: &AgentIdentity,
    client_reputation: &mut Reputation,
    specialist_reputation: &mut Reputation,
    ctx: &TxContext,
) {
    let party_id = object::id(party);
    assert!(
        party_id == deal.client_agent || party_id == deal.specialist_agent,
        ENotParty,
    );
    assert!(party.owner() == ctx.sender(), ENotIdentityOwner);

    // Same binding as verify_and_release, in the other direction. Without it, a
    // party to any throwaway deal could pass a rival's Reputation and drive
    // their score down for the cost of gas.
    assert!(client_reputation.agent_id() == deal.client_agent, EWrongReputation);
    assert!(
        specialist_reputation.agent_id() == deal.specialist_agent,
        EWrongReputation,
    );

    assert_transition(&deal.status, &DealStatus::Disputed);
    deal.status = DealStatus::Disputed;

    client_reputation.record_disputed();
    specialist_reputation.record_disputed();

    event::emit(DealDisputed { deal_id: object::id(deal), raised_by: party_id });
}

/// Ordinal position of a status in the happy path. Disputed sits outside it.
fun rank(status: &DealStatus): u8 {
    match (status) {
        DealStatus::Negotiating => 0,
        DealStatus::Escrowed => 1,
        DealStatus::Delivered => 2,
        DealStatus::Verified => 3,
        DealStatus::Released => 4,
        DealStatus::Disputed => 5,
    }
}

/// Legal transitions: one step forward along the happy path, or a jump to
/// Disputed from any non-terminal state. Released and Disputed are terminal.
fun assert_transition(from: &DealStatus, to: &DealStatus) {
    let from_rank = rank(from);
    let to_rank = rank(to);

    let allowed = if (to_rank == 5) {
        from_rank < 4
    } else {
        from_rank < 4 && to_rank == from_rank + 1
    };

    assert!(allowed, EInvalidTransition);
}

public fun client_agent(deal: &Deal): ID {
    deal.client_agent
}

public fun specialist_agent(deal: &Deal): ID {
    deal.specialist_agent
}

/// Amount still held in escrow. Zero once released.
public fun escrowed_amount(deal: &Deal): u64 {
    deal.escrowed_amount.value()
}

public fun status(deal: &Deal): DealStatus {
    deal.status
}

/// Numeric status for clients that cannot pattern-match a Move enum.
/// 0 Negotiating · 1 Escrowed · 2 Delivered · 3 Verified · 4 Released · 5 Disputed
public fun status_rank(deal: &Deal): u8 {
    rank(&deal.status)
}

public fun proof_ref(deal: &Deal): Option<ID> {
    deal.proof_ref
}
