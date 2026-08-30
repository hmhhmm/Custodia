// Owner: Person 1 (Move/contracts).
//
// Reputation tracks an agent's track record of completed and disputed
// deals, plus a derived score. Linked from AgentIdentity.reputation_id and
// updated as part of PTB #2 (verify-and-release-and-update-reputation).
//
// STATUS: stub only — no working logic yet. Do not deploy.
module escrow::reputation {
    // VERIFY: exact `use` paths for Sui framework types before implementing.

    /// PROPOSED fields — confirm with team before relying on exact names.
    public struct Reputation has key, store {
        // id: UID,
        // agent_id: ID,
        // completed_deals: u64,
        // disputed_deals: u64,
        // score: u64,
    }

    // TODO: public fun new(agent_id: ID, ...): Reputation
    //   Creates a fresh Reputation object, score initialized to some
    //   PROPOSED baseline — confirm baseline value with team.

    // TODO: public(package) fun record_completed(...)
    //   Increments completed_deals and recalculates score. Confirm the
    //   scoring formula with team before implementing — do not invent one
    //   silently, this affects agent discovery/matching in
    //   frontend/src/agent.

    // TODO: public(package) fun record_disputed(...)
    //   Increments disputed_deals and recalculates score.

    // TODO: public fun score(...) — read accessor
    // TODO: public fun completed_deals(...) — read accessor
    // TODO: public fun disputed_deals(...) — read accessor
}
