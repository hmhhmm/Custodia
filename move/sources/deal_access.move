// Owner: Person 3 (verification/storage) — added to Person 1's /move/
// package rather than a separate Move package, since it must be published
// alongside `escrow::deal` for the package ID used in Seal's
// `seal_approve` moveCall target to be meaningful. Coordinate with
// Person 1 before renaming/moving this module.
//
// Seal access-control policy for Deal negotiation terms: an allowlist of
// the two negotiating agents' addresses, modeled on the Seal "whitelist"
// reference pattern
// (https://github.com/MystenLabs/seal/blob/main/move/patterns/sources/whitelist.move).
// This is intentionally the simplest viable policy — do not add a more
// complex access model without flagging it to the team, per
// /docs/ARCHITECTURE.md's scope rules.
//
// STATUS: stub only — no working logic yet. Do not deploy.
//
// VERIFY before implementing: exact Seal Move conventions (entry function
// visibility, the `id: vector<u8>` first-parameter requirement, ID-prefix
// checking) against https://docs.sui.io/sui-stack/seal/using-seal — this
// file follows the documented shape but has not been built/tested against
// a real Seal key server yet.
module escrow::deal_access {
    // VERIFY: exact `use` paths (object::UID, tx_context::TxContext,
    // sui::table::Table or similar) before implementing.

    /// PROPOSED — an allowlist scoped to one Deal, holding exactly the two
    /// negotiating agents' addresses. Confirm with Person 1 whether this
    /// should be a field on Deal itself vs. a separate shared object
    /// referenced by Deal (separate object avoids growing the hot Deal
    /// object on every access-control change).
    public struct DealAllowlist has key {
        // id: UID,
        // deal_id: ID,
        // addresses: vector<address>,   // exactly client_agent + specialist_agent owners
    }

    // TODO: public fun new_for_deal(deal_id: ID, client_owner: address,
    //   specialist_owner: address, ctx: &mut TxContext): DealAllowlist
    //   Creates the allowlist for a Deal at creation time (PTB #1). Confirm
    //   with Person 2 whether this is created in the same PTB as
    //   create_and_lock_escrow or separately.

    // TODO: fun check_policy(caller: address, id: vector<u8>,
    //   allowlist: &DealAllowlist): bool
    //   Per the Seal whitelist pattern: id must be prefixed by
    //   `object::id(allowlist)` bytes, and `caller` must be present in
    //   `allowlist.addresses`. VERIFY exact prefix-checking helper
    //   (bcs/vector slicing) against the reference whitelist.move.

    // TODO: entry fun seal_approve(id: vector<u8>, allowlist: &DealAllowlist,
    //   ctx: &TxContext)
    //   Must be a non-public entry function per Seal's convention. Aborts
    //   (does not return bool) if check_policy fails — this is what a Seal
    //   key server's dry_run_transaction_block evaluates before releasing
    //   key shares. First parameter must be named `id` per Seal's
    //   requirement — VERIFY this against current Seal docs before
    //   implementing, do not assume the exact abort-vs-return convention.
}
