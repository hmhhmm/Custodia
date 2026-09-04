// Owner: Person 1 (Move/contracts).
//
// A granular, specialist-pushed status trail against one Deal — e.g.
// "Picked up", "En route", "Arrived" — richer than deal::DealStatus's own
// 9-state enum, which is deliberately coarse (see deal.move's own header
// comment on why its transition matrix stays minimal and invariant-heavy).
// This module does NOT touch that enum or add any new transition: a
// DealCheckpoint is purely additive reference data alongside Deal, exactly
// the same relationship DealProof already has (see proof.move) — a
// checkpoint records that the specialist reported reaching some real
// intermediate stage, it does not itself move the Deal's own status.
//
// Same access-control story as proof.move's file attachments: a
// checkpoint's optional photo is Seal-encrypted client-side against the
// Deal's EXISTING DealAllowlist (deal_access.move) — no new allowlist
// object, since that policy already scopes access to "either party on
// this deal" regardless of which encrypted artifact it is.
module custodia::checkpoint;

use std::string::String;
use sui::clock::Clock;
use sui::event;
use custodia::agent_identity::AgentIdentity;
use custodia::deal::Deal;

#[error]
const ENotSpecialist: vector<u8> = b"Caller is not the specialist agent on this deal";

#[error]
const ENotIdentityOwner: vector<u8> = b"Transaction sender does not own this agent identity";

#[error]
const EEmptyLabel: vector<u8> = b"Checkpoint label must not be empty";

/// A single specialist-reported checkpoint against one Deal. Write-once —
/// this module exposes no mutator, same reasoning as DealProof (see its
/// own header comment): once created a checkpoint can never be altered,
/// so the client always sees exactly what the specialist reported at the
/// time, never a later edit.
public struct DealCheckpoint has key, store {
    id: UID,
    deal_id: ID,
    /// Free-text, not a closed enum — checkpoint vocabularies differ by
    /// category (courier vs. logistics vs. research/repair), and a fixed
    /// enum would force one vocabulary onto every specialist type. The
    /// frontend defines the suggested labels per category; the chain
    /// itself does not enforce a specific set.
    label: String,
    note: String,
    /// Empty string when no photo was attached to this checkpoint.
    photo_storage_id: String,
    photo_seed_id: String,
    created_by: address,
    created_at_ms: u64,
}

public struct CheckpointCreated has copy, drop {
    checkpoint_id: ID,
    deal_id: ID,
    label: String,
    has_photo: bool,
    created_at_ms: u64,
}

/// Specialist-only — same two-part check deal::mark_delivered uses:
/// caller's AgentIdentity must be this deal's specialist_agent, and the
/// transaction sender must own that identity. Takes `&Deal` read-only
/// purely to verify that relationship; nothing about Deal is mutated.
public fun new_checkpoint(
    deal: &Deal,
    specialist: &AgentIdentity,
    label: String,
    note: String,
    photo_storage_id: String,
    photo_seed_id: String,
    clock: &Clock,
    ctx: &mut TxContext,
): DealCheckpoint {
    assert!(object::id(specialist) == deal.specialist_agent(), ENotSpecialist);
    assert!(specialist.owner() == ctx.sender(), ENotIdentityOwner);
    assert!(!label.is_empty(), EEmptyLabel);

    let checkpoint = DealCheckpoint {
        id: object::new(ctx),
        deal_id: object::id(deal),
        label,
        note,
        photo_storage_id,
        photo_seed_id,
        created_by: ctx.sender(),
        created_at_ms: clock.timestamp_ms(),
    };

    event::emit(CheckpointCreated {
        checkpoint_id: object::id(&checkpoint),
        deal_id: object::id(deal),
        label: checkpoint.label,
        has_photo: !checkpoint.photo_storage_id.is_empty(),
        created_at_ms: checkpoint.created_at_ms,
    });

    checkpoint
}

/// Consume path — DealCheckpoint has no `store`-only drop, so a PTB that
/// creates one must dispose of it this way. Shared, not frozen: same
/// reasoning as proof::share_proof (a freeze on this pattern has hit a
/// toolchain ICE before in this package — see proof.move's note — and
/// sharing is behaviourally equivalent here since there are no mutators).
public fun share_checkpoint(checkpoint: DealCheckpoint) {
    transfer::share_object(checkpoint);
}

entry fun new_and_share(
    deal: &Deal,
    specialist: &AgentIdentity,
    label: String,
    note: String,
    photo_storage_id: String,
    photo_seed_id: String,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    share_checkpoint(new_checkpoint(deal, specialist, label, note, photo_storage_id, photo_seed_id, clock, ctx));
}

public fun deal_id(checkpoint: &DealCheckpoint): ID {
    checkpoint.deal_id
}

public fun label(checkpoint: &DealCheckpoint): String {
    checkpoint.label
}

public fun note(checkpoint: &DealCheckpoint): String {
    checkpoint.note
}

public fun photo_storage_id(checkpoint: &DealCheckpoint): String {
    checkpoint.photo_storage_id
}

public fun photo_seed_id(checkpoint: &DealCheckpoint): String {
    checkpoint.photo_seed_id
}

public fun created_by(checkpoint: &DealCheckpoint): address {
    checkpoint.created_by
}

public fun created_at_ms(checkpoint: &DealCheckpoint): u64 {
    checkpoint.created_at_ms
}
