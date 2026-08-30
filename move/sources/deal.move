// Owner: Person 1 (Move/contracts).
//
// Deal represents a single escrowed engagement between a client agent and
// a specialist agent: funds are locked, work is delivered off-chain,
// verified (proof_ref points at a Walrus/Nautilus-backed record — see
// Person 3's verification flow), and then released. This is the core
// escrow lock/release logic. See /docs/ARCHITECTURE.md for the full
// PTB sequence.
//
// STATUS: stub only — no working logic yet. Do not deploy.
module escrow::deal {
    // VERIFY: exact `use` paths for Sui framework types (object::UID,
    // balance::Balance, sui::sui::SUI, tx_context::TxContext) before
    // implementing.

    /// PROPOSED status enum — confirm with team before relying on exact
    /// variant names, since frontend/src/sui reads this to drive UI state.
    public enum DealStatus has copy, drop, store {
        Negotiating,
        Escrowed,
        Delivered,
        Verified,
        Released,
        Disputed,
    }

    /// PROPOSED fields — confirm with team before relying on exact names.
    public struct Deal has key, store {
        // id: UID,
        // client_agent: ID,
        // specialist_agent: ID,
        // escrowed_amount: Balance<SUI>,
        // status: DealStatus,
        // proof_ref: Option<ID>,
    }

    // TODO: public fun create_and_lock_escrow(client_agent: ID,
    //   specialist_agent: ID, payment: Coin<SUI>, mandate: &mut Mandate,
    //   ctx: &mut TxContext): Deal
    //   Entry point for PTB #1 (lock-escrow-and-create-deal). Must call
    //   mandate::assert_within_mandate + mandate::record_spend. Confirm
    //   exact PTB composition with Person 2 before finalizing signature —
    //   mark this "TBD — confirm with Person 2" until then.

    // TODO: public fun mark_delivered(deal: &mut Deal, proof_ref: ID)
    //   Called once Person 3's verification flow has a proof reference
    //   (Walrus blob ID / Nautilus attestation ID — confirm which).

    // TODO: public fun verify_and_release(deal: &mut Deal,
    //   client_reputation: &mut Reputation, specialist_reputation: &mut Reputation,
    //   ctx: &mut TxContext)
    //   Entry point for PTB #2 (verify-and-release-and-update-reputation).
    //   Transfers escrowed_amount to specialist, sets status to Released,
    //   calls reputation::record_completed on both sides. Confirm dispute
    //   path separately — do not conflate with the happy path.

    // TODO: public fun raise_dispute(deal: &mut Deal, ctx: &mut TxContext)
    //   Sets status to Disputed. Dispute resolution mechanism is OUT OF
    //   SCOPE for the hackathon demo per /docs/ARCHITECTURE.md — stub only,
    //   do not build resolution logic.
}
