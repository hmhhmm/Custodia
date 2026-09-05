// Owner: Person 1 (Move/contracts).
//
// The real task brief a specialist needs to actually do the work — what
// the item specifically is, where to collect/deliver it, contact
// details — was never stored anywhere on-chain before this module: the
// client's Chat conversation produces a rich, specific task description
// (see agent/chat.ts's start_deal/start_deal_chain tool schemas), but
// nothing carried it past the moment createDealAndEscrow finished — a
// specialist accepting a Deal saw only its category and amount, with no
// way to learn where to go or what to actually do. This module gives
// that brief a real, Deal-scoped home.
//
// Same write-once shared-object pattern as checkpoint.move and
// proof.move: created once by the CLIENT right after escrow locks,
// Seal-encrypted client-side against the Deal's existing DealAllowlist
// (no new access-control object — that policy already scopes access to
// "either party on this deal"), readable by both parties once shared.
module custodia::deal_brief;

use std::string::String;
use sui::event;
use custodia::agent_identity::AgentIdentity;
use custodia::deal::Deal;

#[error]
const ENotClient: vector<u8> = b"Caller is not the client agent on this deal";

#[error]
const ENotIdentityOwner: vector<u8> = b"Transaction sender does not own this agent identity";

#[error]
const EEmptyStorageId: vector<u8> = b"Brief must reference a stored artifact";

/// A Deal's real work order — Seal-encrypted content stored on Walrus,
/// exactly like a DealProof's deliverable. Write-once: this module
/// exposes no mutator, so once written a brief can never be silently
/// changed after a specialist has already started work against it.
public struct DealBrief has key, store {
    id: UID,
    deal_id: ID,
    /// The Walrus blob id of the Seal-encrypted brief text.
    storage_id: String,
    /// The Seal identity/seed used to encrypt it — needed back,
    /// unchanged, to decrypt (same convention as DealProof/DealCheckpoint's
    /// own seed fields; not derivable from the allowlist id alone).
    seed_id: String,
    created_by: address,
}

public struct DealBriefCreated has copy, drop {
    brief_id: ID,
    deal_id: ID,
}

/// Client-only, same two-part check deal::verify_and_release uses:
/// caller's AgentIdentity must be this deal's client_agent, and the
/// transaction sender must own that identity.
public fun new_brief(
    deal: &Deal,
    client: &AgentIdentity,
    storage_id: String,
    seed_id: String,
    ctx: &mut TxContext,
): DealBrief {
    assert!(object::id(client) == deal.client_agent(), ENotClient);
    assert!(client.owner() == ctx.sender(), ENotIdentityOwner);
    assert!(!storage_id.is_empty(), EEmptyStorageId);

    let brief = DealBrief {
        id: object::new(ctx),
        deal_id: object::id(deal),
        storage_id,
        seed_id,
        created_by: ctx.sender(),
    };

    event::emit(DealBriefCreated {
        brief_id: object::id(&brief),
        deal_id: object::id(deal),
    });

    brief
}

public fun share_brief(brief: DealBrief) {
    transfer::share_object(brief);
}

entry fun new_and_share(
    deal: &Deal,
    client: &AgentIdentity,
    storage_id: String,
    seed_id: String,
    ctx: &mut TxContext,
) {
    share_brief(new_brief(deal, client, storage_id, seed_id, ctx));
}

public fun deal_id(brief: &DealBrief): ID {
    brief.deal_id
}

public fun storage_id(brief: &DealBrief): String {
    brief.storage_id
}

public fun seed_id(brief: &DealBrief): String {
    brief.seed_id
}

public fun created_by(brief: &DealBrief): address {
    brief.created_by
}
