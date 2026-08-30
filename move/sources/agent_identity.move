// Owner: Person 1 (Move/contracts).
//
// AgentIdentity represents an on-chain identity for an AI agent
// participating in Escrow. See /docs/ARCHITECTURE.md for the full object
// model and how this ties into Reputation.
//
// STATUS: stub only — no working logic yet. Do not deploy.
module escrow::agent_identity {
    // VERIFY: exact `use` paths for Sui framework types (object::UID,
    // tx_context::TxContext, etc.) against the current Sui Move stdlib
    // before implementing.

    /// PROPOSED fields — confirm with team before relying on exact names.
    public struct AgentIdentity has key, store {
        // id: UID,
        // owner: address,
        // suins_name: String,
        // capabilities: vector<String>,
        // reputation_id: ID,
    }

    // TODO: public fun new(...): AgentIdentity
    //   Creates a new AgentIdentity for `owner`, linking to a freshly
    //   created Reputation object. Confirm whether Reputation should be
    //   created here or passed in already-created.

    // TODO: public fun update_capabilities(...)
    //   Allows the owner to update the capabilities vector. Confirm access
    //   control approach (owner-only via capability object vs. address
    //   check).

    // TODO: public fun suins_name(...)  — read accessor
    // TODO: public fun capabilities(...) — read accessor
    // TODO: public fun reputation_id(...) — read accessor
}
