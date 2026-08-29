// Owner: Person 1 (Move/contracts).
//
// The scoring formula is PROPOSED (see reputation.move) and Person 4's
// discovery ranking will depend on it, so these tests pin the exact numbers
// the formula produces. If the team changes the formula, these are the tests
// that should fail first.
#[test_only]
module escrow::reputation_tests;

use std::unit_test::{assert_eq, destroy};
use escrow::reputation;

/// A throwaway ID to stand in for an AgentIdentity. The UID must be explicitly
/// deleted — it has no `drop`, so leaking it fails the borrow checker.
fun dummy_agent_id(ctx: &mut TxContext): ID {
    let id = object::new(ctx);
    let inner = id.to_inner();
    id.delete();
    inner
}

#[test]
fun new_reputation_starts_at_cold_start_score() {
    let ctx = &mut tx_context::dummy();
    let agent_id = dummy_agent_id(ctx);
    let r = reputation::new(agent_id, ctx);

    assert_eq!(r.completed_deals(), 0);
    assert_eq!(r.disputed_deals(), 0);
    // Cold start is deliberately neutral, not zero: a brand-new agent is
    // unproven, not bad. This is the cold-start problem the pitch names.
    assert_eq!(r.score(), 50);
    assert_eq!(r.agent_id(), agent_id);

    destroy(r);
}

#[test]
fun one_completed_deal_scores_full_marks() {
    let ctx = &mut tx_context::dummy();
    let mut r = reputation::new(dummy_agent_id(ctx), ctx);

    r.record_completed();

    assert_eq!(r.completed_deals(), 1);
    assert_eq!(r.score(), 100);

    destroy(r);
}

#[test]
fun one_dispute_with_no_completions_scores_zero() {
    let ctx = &mut tx_context::dummy();
    let mut r = reputation::new(dummy_agent_id(ctx), ctx);

    r.record_disputed();

    assert_eq!(r.disputed_deals(), 1);
    assert_eq!(r.score(), 0);

    destroy(r);
}

#[test]
fun even_split_scores_fifty() {
    let ctx = &mut tx_context::dummy();
    let mut r = reputation::new(dummy_agent_id(ctx), ctx);

    r.record_completed();
    r.record_disputed();

    assert_eq!(r.score(), 50);

    destroy(r);
}

#[test]
fun three_completed_one_disputed_scores_seventy_five() {
    let ctx = &mut tx_context::dummy();
    let mut r = reputation::new(dummy_agent_id(ctx), ctx);

    r.record_completed();
    r.record_completed();
    r.record_completed();
    r.record_disputed();

    assert_eq!(r.completed_deals(), 3);
    assert_eq!(r.disputed_deals(), 1);
    assert_eq!(r.score(), 75);

    destroy(r);
}

#[test]
fun integer_division_truncates_rather_than_rounds() {
    // 2 of 3 completed is 66.67 -> 66. Documenting the truncation explicitly so
    // nobody is surprised by an agent showing 66 instead of 67 in the UI.
    let ctx = &mut tx_context::dummy();
    let mut r = reputation::new(dummy_agent_id(ctx), ctx);

    r.record_completed();
    r.record_completed();
    r.record_disputed();

    assert_eq!(r.score(), 66);

    destroy(r);
}
