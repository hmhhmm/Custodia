// Owner: Person 1 (Move/contracts).
//
// The scoring formula is PROPOSED (see reputation.move) and Person 4's
// discovery ranking will depend on it, so these tests pin the exact numbers
// the formula produces. If the team changes the formula, these are the tests
// that should fail first.
//
// The formula now blends a Bayesian prior of PRIOR_WEIGHT virtual deals held at
// COLD_START_SCORE:  score = (100*completed + 50*5) / (completed + disputed + 5)
#[test_only]
module custodia::reputation_tests;

use std::unit_test::{assert_eq, destroy};
use custodia::reputation;

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
    // unproven, not bad. This is the cold-start problem the pitch names. The
    // prior is chosen so this value is exactly COLD_START_SCORE: 250/5 = 50.
    assert_eq!(r.score(), 50);
    assert_eq!(r.agent_id(), agent_id);

    destroy(r);
}

#[test]
fun one_completed_deal_does_not_reach_full_marks() {
    // (100*1 + 250) / (1 + 5) = 350/6 = 58.
    //
    // This is the anti-sybil property, and it is the whole reason the prior
    // exists. Under the old ratio formula a single completed deal scored a
    // perfect 100, so one self-dealt zero-value deal bought the top of Person
    // 4's discovery ranking outright.
    let ctx = &mut tx_context::dummy();
    let mut r = reputation::new(dummy_agent_id(ctx), ctx);

    r.record_completed();

    assert_eq!(r.completed_deals(), 1);
    assert_eq!(r.score(), 58);

    destroy(r);
}

#[test]
fun volume_beats_a_single_forged_completion() {
    // The ranking property stated as a comparison, since this is what discovery
    // actually does with the number. Under the old formula the newcomer (100)
    // outranked the veteran (99); it must not.
    let ctx = &mut tx_context::dummy();

    let mut newcomer = reputation::new(dummy_agent_id(ctx), ctx);
    newcomer.record_completed();

    let mut veteran = reputation::new(dummy_agent_id(ctx), ctx);
    20u64.do!(|_| veteran.record_completed());
    veteran.record_disputed();

    assert!(veteran.score() > newcomer.score());

    destroy(newcomer);
    destroy(veteran);
}

#[test]
fun one_dispute_with_no_completions_is_below_cold_start() {
    // 250/6 = 41. Deliberately not 0: a single dispute is a bad signal, not
    // proof of a worthless agent, and the old formula's 0 was indistinguishable
    // from an agent with 100 disputes.
    let ctx = &mut tx_context::dummy();
    let mut r = reputation::new(dummy_agent_id(ctx), ctx);

    r.record_disputed();

    assert_eq!(r.disputed_deals(), 1);
    assert_eq!(r.score(), 41);

    destroy(r);
}

#[test]
fun even_split_scores_fifty() {
    // 350/7 = 50. An exactly even record lands on cold start under the prior
    // too, which is the property that makes the number readable.
    let ctx = &mut tx_context::dummy();
    let mut r = reputation::new(dummy_agent_id(ctx), ctx);

    r.record_completed();
    r.record_disputed();

    assert_eq!(r.score(), 50);

    destroy(r);
}

#[test]
fun three_completed_one_disputed_scores_sixty_one() {
    // (300 + 250) / 9 = 61.
    let ctx = &mut tx_context::dummy();
    let mut r = reputation::new(dummy_agent_id(ctx), ctx);

    r.record_completed();
    r.record_completed();
    r.record_completed();
    r.record_disputed();

    assert_eq!(r.completed_deals(), 3);
    assert_eq!(r.disputed_deals(), 1);
    assert_eq!(r.score(), 61);

    destroy(r);
}

#[test]
fun integer_division_truncates_rather_than_rounds() {
    // (200 + 250) / 8 = 56.25 -> 56. Documenting the truncation explicitly so
    // nobody is surprised by a score one point below the exact value.
    let ctx = &mut tx_context::dummy();
    let mut r = reputation::new(dummy_agent_id(ctx), ctx);

    r.record_completed();
    r.record_completed();
    r.record_disputed();

    assert_eq!(r.score(), 56);

    destroy(r);
}

#[test]
fun score_converges_toward_max_with_volume() {
    // The prior must wash out with a real track record, or an honest agent
    // could never be distinguished from a new one.
    let ctx = &mut tx_context::dummy();
    let mut r = reputation::new(dummy_agent_id(ctx), ctx);

    100u64.do!(|_| r.record_completed());

    // (10000 + 250) / 105 = 97.
    assert_eq!(r.score(), 97);
    assert!(r.score() < 100);

    destroy(r);
}
