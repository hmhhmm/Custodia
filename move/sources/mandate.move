// Owner: Person 1 (Move/contracts).
//
// Mandate is a scoped spending delegation from a human owner to an agent
// (the delegate) — caps total spend, restricts categories, and expires.
// Checked before PTB #1 (lock-escrow-and-create-deal) is allowed to
// proceed. See /docs/ARCHITECTURE.md for the end-to-end sequence.
//
// STATUS: stub only — no working logic yet. Do not deploy.
module escrow::mandate {
    // VERIFY: exact `use` paths for Sui framework types before implementing.

    /// PROPOSED fields — confirm with team before relying on exact names.
    public struct Mandate has key, store {
        // id: UID,
        // owner: address,
        // delegate: address,
        // max_spend: u64,
        // spent_so_far: u64,
        // allowed_categories: vector<String>,
        // expires_at: u64,
        // revoked: bool,
    }

    // TODO: public fun new(owner, delegate, max_spend, allowed_categories,
    //   expires_at, ctx): Mandate
    //   Confirm how `expires_at` is represented — epoch ms via
    //   sui::clock::Clock vs. epoch number. VERIFY against current Sui
    //   time-handling docs before implementing.

    // TODO: public fun assert_within_mandate(mandate: &Mandate, amount: u64,
    //   category: String, clock: &Clock)
    //   Aborts if revoked, expired, category not allowed, or
    //   spent_so_far + amount > max_spend. Confirm abort codes with team.

    // TODO: public(package) fun record_spend(mandate: &mut Mandate, amount: u64)
    //   Called from the escrow-lock flow once a Deal is created against
    //   this mandate.

    // TODO: public fun revoke(mandate: &mut Mandate, ctx: &TxContext)
    //   Owner-only. Confirm access control approach.
}
