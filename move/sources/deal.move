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
use escrow::agent_identity::AgentIdentity;
use escrow::mandate::Mandate;
use escrow::reputation::Reputation;

#[error]
const ENotSpecialist: vector<u8> = b"Caller is not the specialist agent on this deal";

#[error]
const ENotParty: vector<u8> = b"Caller is not a party to this deal";

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

public struct DealCreated has copy, drop {
    deal_id: ID,
    client_agent: ID,
    specialist_agent: ID,
    amount: u64,
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
/// composable; `create_and_share` is the convenience path.
public fun create_and_lock_escrow(
    mandate: &mut Mandate,
    payment: Coin<SUI>,
    client_agent: ID,
    specialist_agent: ID,
    category: String,
    clock: &Clock,
    ctx: &mut TxContext,
): Deal {
    mandate.assert_is_delegate(ctx);

    let amount = payment.value();
    mandate.assert_within_mandate(amount, category, clock);
    mandate.record_spend(amount);

    let deal = Deal {
        id: object::new(ctx),
        client_agent,
        specialist_agent,
        escrowed_amount: payment.into_balance(),
        status: DealStatus::Escrowed,
        proof_ref: option::none(),
    };

    event::emit(DealCreated {
        deal_id: object::id(&deal),
        client_agent,
        specialist_agent,
        amount,
    });

    deal
}

entry fun create_and_share(
    mandate: &mut Mandate,
    payment: Coin<SUI>,
    client_agent: ID,
    specialist_agent: ID,
    category: String,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    let deal = create_and_lock_escrow(
        mandate,
        payment,
        client_agent,
        specialist_agent,
        category,
        clock,
        ctx,
    );
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
    assert!(specialist.owner() == ctx.sender(), ENotSpecialist);

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
/// NOTE on what "verify" means here: this function confirms the Deal reached
/// Delivered with a proof_ref set. It does NOT cryptographically verify a
/// Nautilus attestation on-chain — that would require verifying an AWS
/// certificate chain in Move, which is out of scope (see
/// /docs/ARCHITECTURE.md). Do not describe this as on-chain attestation
/// verification in the demo.
public fun verify_and_release(
    deal: &mut Deal,
    client_reputation: &mut Reputation,
    specialist_reputation: &mut Reputation,
    ctx: &mut TxContext,
): Coin<SUI> {
    assert_transition(&deal.status, &DealStatus::Verified);
    deal.status = DealStatus::Verified;

    let amount = deal.escrowed_amount.value();
    let payout = coin::from_balance(deal.escrowed_amount.split(amount), ctx);

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
    assert!(party.owner() == ctx.sender(), ENotParty);

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
