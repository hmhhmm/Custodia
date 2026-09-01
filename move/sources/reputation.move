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
module custodia::reputation;

use sui::event;

/// Score for an agent with no completed and no disputed deals. 0-100 scale,
/// chosen to match `CandidateInfo.reputationScore` in
/// frontend/src/app/types.ts.
///
/// Deliberately trivial to change: only `recalculate` below and this
/// constant need editing if the scoring formula is revised.
const COLD_START_SCORE: u64 = 50;

/// Maximum score, i.e. an agent with completed deals and zero disputes.
const MAX_SCORE: u64 = 100;

/// Pseudo-count of COLD_START_SCORE-weighted "virtual" deals blended into every
/// score. Without it the formula has a one-deal cliff: a brand-new agent with a
/// single completed deal scores a perfect 100 and outranks an agent with 999
/// completed and 1 disputed (99). That made a single self-dealt, zero-value
/// deal the cheapest way to top discovery's reputation ranking.
///
/// With the prior, one completion scores 58 and the score approaches 100 only
/// with real volume, so a forged record buys almost nothing. Cold start is
/// unchanged at exactly COLD_START_SCORE.
const PRIOR_WEIGHT: u64 = 5;

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
/// an AgentIdentity and its Reputation in one transaction. A caller that just
/// wants it shared passes the result straight to `share` below.
///
/// Emits the genesis `ReputationUpdated` so an indexer built on that event
/// alone sees the cold-start score. Every later change emits the same event, so
/// the event stream is now complete from creation.
///
/// `public(package)`, and this visibility is a security boundary: a `public`
/// version would let one PTB call `new(<any agent_id>)` then the public
/// `share` and mint a DECOY Reputation claiming any victim's agent. That
/// decoy would defeat the `agent_id()` bindings in `deal`: an attacker could
/// pass a decoy for their own side of a dispute and the victim's real object
/// for the other, taking zero blowback while driving a rival's score down
/// for the cost of gas.
///
/// Package-only minting is what makes "exactly one Reputation per agent"
/// true, which is in turn what makes `reputation.agent_id() == deal.x_agent`
/// a sufficient check rather than a claim an attacker can forge. The only
/// caller is `agent_identity::register`, which mints one per identity and
/// links the two.
public(package) fun new(agent_id: ID, ctx: &mut TxContext): Reputation {
    let reputation = Reputation {
        id: object::new(ctx),
        agent_id,
        completed_deals: 0,
        disputed_deals: 0,
        score: COLD_START_SCORE,
    };

    event::emit(ReputationUpdated {
        reputation_id: object::id(&reputation),
        agent_id,
        completed_deals: 0,
        disputed_deals: 0,
        score: COLD_START_SCORE,
    });

    reputation
}

/// Shares a Reputation. Needed because `Reputation` deliberately has only
/// `key` and not `store`: without `store` it cannot be wrapped inside another
/// object or moved by `public_transfer`, which keeps an agent's track record
/// from being hidden or traded. The cost is that `transfer::share_object` is
/// restricted to this module, so every other caller goes through this helper.
///
/// `public`, not `public(package)`, and that visibility is load-bearing: a PTB
/// that calls `new` (or `agent_identity::register`) receives a `key`-only,
/// non-`drop` value it MUST consume before the transaction ends. It cannot use
/// `public_share_object`, which requires `store`. Without a public way to
/// consume it the whole transaction fails with `UnusedValueWithoutDrop`, which
/// is exactly what made the "composable" constructors uncallable.
///
/// Safe to leave `public` even though `new` is not: without a package-internal
/// mint, the only way to hold a `Reputation` by value is to have received it
/// from `agent_identity::register`, which produces the canonical one. A public
/// consume path with a package-only constructor is the combination that keeps
/// PTB composability without reopening decoy minting.
public fun share(reputation: Reputation) {
    transfer::share_object(reputation);
}

/// Called from `custodia::deal::verify_and_release` for both sides of a
/// released Deal. Package-visible so only Custodia's own modules can move an
/// agent's score — never callable directly from a PTB.
public(package) fun record_completed(reputation: &mut Reputation) {
    reputation.completed_deals = reputation.completed_deals + 1;
    reputation.recalculate();
}

/// Called from `custodia::deal::raise_dispute`.
public(package) fun record_disputed(reputation: &mut Reputation) {
    reputation.disputed_deals = reputation.disputed_deals + 1;
    reputation.recalculate();
}

/// PROPOSED formula — see COLD_START_SCORE and PRIOR_WEIGHT above before
/// changing.
///
/// A Bayesian prior: PRIOR_WEIGHT virtual deals held at COLD_START_SCORE are
/// blended with the real record. At zero deals this reduces exactly to
/// COLD_START_SCORE, so cold start is unchanged; with volume it converges on
/// the raw completed/total ratio.
fun recalculate(reputation: &mut Reputation) {
    let total = reputation.completed_deals + reputation.disputed_deals;

    reputation.score =
        (MAX_SCORE * reputation.completed_deals + COLD_START_SCORE * PRIOR_WEIGHT)
            / (total + PRIOR_WEIGHT);

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
