// Owner: Person 1 (Move/contracts).
//
// Reputation tracks an agent's track record of completed and disputed deals,
// plus a derived score. Linked from AgentIdentity.reputation_id and updated as
// part of PTB #2 (verify-and-release-and-update-reputation).
//
// Shared object: PTB #2 updates BOTH the client's and the specialist's
// Reputation in one transaction, and neither party owns the other's. An
// address-owned object could only be used by its owner, so shared is forced
// here, not a preference.
module escrow::reputation;

use sui::event;

/// PROPOSED — score for an agent with no completed and no disputed deals.
/// 0-100 scale, chosen to match what Person 4's UI already renders
/// (`CandidateInfo.reputationScore` in frontend/src/app/types.ts).
///
/// /docs/ARCHITECTURE.md flags the scoring formula as needing team
/// confirmation. This is a concrete PROPOSED formula so the package can be
/// built and deployed — it is deliberately trivial to change: only
/// `recalculate` below and this constant need editing. Confirm with the team
/// before Person 4's discovery ranking depends on the exact numbers.
const COLD_START_SCORE: u64 = 50;

/// Maximum score, i.e. an agent with completed deals and zero disputes.
const MAX_SCORE: u64 = 100;

public struct Reputation has key {
    id: UID,
    agent_id: ID,
    completed_deals: u64,
    disputed_deals: u64,
    score: u64,
}

public struct ReputationUpdated has copy, drop {
    reputation_id: ID,
    agent_id: ID,
    completed_deals: u64,
    disputed_deals: u64,
    score: u64,
}

/// Creates a fresh Reputation for `agent_id` at the cold-start score.
///
/// Returns the object rather than sharing it internally, so a PTB can create
/// an AgentIdentity and its Reputation in one composable transaction. Use
/// `create_and_share` for the non-composable convenience path.
public fun new(agent_id: ID, ctx: &mut TxContext): Reputation {
    Reputation {
        id: object::new(ctx),
        agent_id,
        completed_deals: 0,
        disputed_deals: 0,
        score: COLD_START_SCORE,
    }
}

entry fun create_and_share(agent_id: ID, ctx: &mut TxContext) {
    transfer::share_object(new(agent_id, ctx));
}

/// Shares a Reputation. Needed because `Reputation` deliberately has only
/// `key` and not `store`: without `store` it cannot be wrapped inside another
/// object or moved by `public_transfer`, which keeps an agent's track record
/// from being hidden or traded. The cost is that `transfer::share_object` is
/// restricted to this module, so sibling modules go through this helper.
public(package) fun share(reputation: Reputation) {
    transfer::share_object(reputation);
}

/// Called from `escrow::deal::verify_and_release` for both sides of a
/// released Deal. Package-visible so only Escrow's own modules can move an
/// agent's score — never callable directly from a PTB.
public(package) fun record_completed(reputation: &mut Reputation) {
    reputation.completed_deals = reputation.completed_deals + 1;
    reputation.recalculate();
}

/// Called from `escrow::deal::raise_dispute`.
public(package) fun record_disputed(reputation: &mut Reputation) {
    reputation.disputed_deals = reputation.disputed_deals + 1;
    reputation.recalculate();
}

/// PROPOSED formula — see COLD_START_SCORE above before changing.
fun recalculate(reputation: &mut Reputation) {
    let total = reputation.completed_deals + reputation.disputed_deals;

    reputation.score = if (total == 0) {
        COLD_START_SCORE
    } else {
        (MAX_SCORE * reputation.completed_deals) / total
    };

    event::emit(ReputationUpdated {
        reputation_id: object::id(reputation),
        agent_id: reputation.agent_id,
        completed_deals: reputation.completed_deals,
        disputed_deals: reputation.disputed_deals,
        score: reputation.score,
    });
}

public fun agent_id(reputation: &Reputation): ID {
    reputation.agent_id
}

public fun score(reputation: &Reputation): u64 {
    reputation.score
}

public fun completed_deals(reputation: &Reputation): u64 {
    reputation.completed_deals
}

public fun disputed_deals(reputation: &Reputation): u64 {
    reputation.disputed_deals
}
