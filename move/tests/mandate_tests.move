// Owner: Person 1 (Move/contracts).
//
// Mandate is the object that makes "this spending cap is enforced by code, not
// a promise" true, so these tests exercise every way a spend can be refused.
//
// NOTE on cleanup in `expected_failure` tests: the `move-unit-testing` skill
// says to skip cleanup after the aborting call because it is dead code. That
// does not apply here — Mandate and Clock have no `drop`, and the compiler's
// unused-value check is STATIC: it cannot know the call above aborts, so it
// rejects the function outright with EC06001. The trailing `destroy` calls
// below are required to compile, not leftovers. Do not delete them.
#[test_only]
module escrow::mandate_tests;

use std::string::String;
use std::unit_test::{assert_eq, destroy};
use sui::clock;
use escrow::mandate;

const OWNER: address = @0xA;
const DELEGATE: address = @0xB;
const STRANGER: address = @0xC;

const NOW_MS: u64 = 1_000_000;
const EXPIRES_MS: u64 = 2_000_000;

fun categories(): vector<String> {
    vector[b"legal-review".to_string(), b"courier".to_string()]
}

#[test]
fun new_mandate_starts_unspent_and_active() {
    let ctx = &mut tx_context::dummy();
    let m = mandate::new(DELEGATE, 500, categories(), EXPIRES_MS, ctx);

    assert_eq!(m.max_spend(), 500);
    assert_eq!(m.spent_so_far(), 0);
    assert_eq!(m.remaining(), 500);
    assert_eq!(m.delegate(), DELEGATE);
    assert!(!m.is_revoked());

    destroy(m);
}

#[test]
fun spend_within_all_limits_is_allowed() {
    let ctx = &mut tx_context::dummy();
    let mut c = clock::create_for_testing(ctx);
    c.set_for_testing(NOW_MS);

    let m = mandate::new(DELEGATE, 500, categories(), EXPIRES_MS, ctx);
    m.assert_within_mandate(150, b"legal-review".to_string(), &c);

    destroy(m);
    destroy(c);
}

#[test]
fun record_spend_advances_remaining_budget() {
    let ctx = &mut tx_context::dummy();
    let mut m = mandate::new(DELEGATE, 500, categories(), EXPIRES_MS, ctx);

    m.record_spend(120);

    assert_eq!(m.spent_so_far(), 120);
    assert_eq!(m.remaining(), 380);

    destroy(m);
}

#[test, expected_failure(abort_code = mandate::ESpendLimitExceeded, location = mandate)]
fun spend_over_max_aborts() {
    let ctx = &mut tx_context::dummy();
    let mut c = clock::create_for_testing(ctx);
    c.set_for_testing(NOW_MS);

    let m = mandate::new(DELEGATE, 500, categories(), EXPIRES_MS, ctx);
    m.assert_within_mandate(501, b"legal-review".to_string(), &c);

    destroy(m);
    destroy(c);
}

#[test, expected_failure(abort_code = mandate::ESpendLimitExceeded, location = mandate)]
fun cumulative_spend_over_max_aborts() {
    let ctx = &mut tx_context::dummy();
    let mut c = clock::create_for_testing(ctx);
    c.set_for_testing(NOW_MS);

    let mut m = mandate::new(DELEGATE, 500, categories(), EXPIRES_MS, ctx);
    m.assert_within_mandate(400, b"legal-review".to_string(), &c);
    m.record_spend(400);

    // 400 already spent, so a second 200 breaches the 500 cap.
    m.assert_within_mandate(200, b"legal-review".to_string(), &c);

    destroy(m);
    destroy(c);
}

#[test, expected_failure(abort_code = mandate::ECategoryNotAllowed, location = mandate)]
fun spend_in_disallowed_category_aborts() {
    let ctx = &mut tx_context::dummy();
    let mut c = clock::create_for_testing(ctx);
    c.set_for_testing(NOW_MS);

    let m = mandate::new(DELEGATE, 500, categories(), EXPIRES_MS, ctx);
    m.assert_within_mandate(10, b"gambling".to_string(), &c);

    destroy(m);
    destroy(c);
}

#[test, expected_failure(abort_code = mandate::EExpired, location = mandate)]
fun spend_after_expiry_aborts() {
    let ctx = &mut tx_context::dummy();
    let mut c = clock::create_for_testing(ctx);
    c.set_for_testing(EXPIRES_MS + 1);

    let m = mandate::new(DELEGATE, 500, categories(), EXPIRES_MS, ctx);
    m.assert_within_mandate(10, b"legal-review".to_string(), &c);

    destroy(m);
    destroy(c);
}

#[test]
fun owner_can_revoke() {
    let mut scenario = sui::test_scenario::begin(OWNER);
    let mut m = mandate::new(DELEGATE, 500, categories(), EXPIRES_MS, scenario.ctx());

    assert!(!m.is_revoked());
    m.revoke(scenario.ctx());
    assert!(m.is_revoked());

    destroy(m);
    scenario.end();
}

#[test, expected_failure(abort_code = mandate::ERevoked, location = mandate)]
fun spend_against_revoked_mandate_aborts() {
    // The "revoke instantly" feature: the same spend that passes above is
    // refused once `revoked` is flipped.
    let mut scenario = sui::test_scenario::begin(OWNER);
    let mut c = clock::create_for_testing(scenario.ctx());
    c.set_for_testing(NOW_MS);

    let mut m = mandate::new(DELEGATE, 500, categories(), EXPIRES_MS, scenario.ctx());
    m.assert_within_mandate(150, b"legal-review".to_string(), &c);

    m.revoke(scenario.ctx());
    m.assert_within_mandate(150, b"legal-review".to_string(), &c);

    destroy(m);
    destroy(c);
    scenario.end();
}

#[test, expected_failure(abort_code = mandate::ENotOwner, location = mandate)]
fun non_owner_cannot_revoke() {
    let mut scenario = sui::test_scenario::begin(OWNER);
    let mut m = mandate::new(DELEGATE, 500, categories(), EXPIRES_MS, scenario.ctx());

    scenario.next_tx(STRANGER);
    m.revoke(scenario.ctx());

    destroy(m);
    scenario.end();
}

#[test, expected_failure(abort_code = mandate::ENotDelegate, location = mandate)]
fun non_delegate_cannot_spend() {
    let mut scenario = sui::test_scenario::begin(OWNER);
    let m = mandate::new(DELEGATE, 500, categories(), EXPIRES_MS, scenario.ctx());

    scenario.next_tx(STRANGER);
    m.assert_is_delegate(scenario.ctx());

    destroy(m);
    scenario.end();
}
