// Owner: Person 1 (Move/contracts).
//
// Mandate is the object that makes "spending through Custodia is capped by an
// on-chain mandate the human can revoke instantly" true, so these tests
// exercise every way a spend can be refused — and, since the Mandate now
// CUSTODIES the funds, every way money enters and leaves it.
//
// NOTE on cleanup in `expected_failure` tests: the `move-unit-testing` skill
// says to skip cleanup after the aborting call because it is dead code. That
// does not apply here — Mandate and Clock have no `drop`, and the compiler's
// unused-value check is STATIC: it cannot know the call above aborts, so it
// rejects the function outright with EC06001. The trailing `destroy` calls
// below are required to compile, not leftovers. Do not delete them.
#[test_only]
module custodia::mandate_tests;

use std::string::String;
use std::unit_test::{assert_eq, destroy};
use sui::clock;
use sui::coin;
use sui::sui::SUI;
use sui::test_scenario;
use custodia::mandate::{Self, Mandate};

const OWNER: address = @0xA;
const DELEGATE: address = @0xB;
const STRANGER: address = @0xC;

const NOW_MS: u64 = 1_000_000;
const EXPIRES_MS: u64 = 2_000_000;

fun categories(): vector<String> {
    vector[b"legal-review".to_string(), b"courier".to_string()]
}

/// A funded mandate owned by the current sender, delegating to DELEGATE.
fun funded(max_spend: u64, funding: u64, ctx: &mut TxContext): Mandate {
    let mut m = mandate::new(DELEGATE, max_spend, categories(), EXPIRES_MS, ctx);
    let c = coin::mint_for_testing<SUI>(funding, ctx);
    m.deposit(c, ctx);
    m
}

#[test]
fun new_mandate_starts_unspent_unfunded_and_active() {
    let ctx = &mut tx_context::dummy();
    let m = mandate::new(DELEGATE, 500, categories(), EXPIRES_MS, ctx);

    assert_eq!(m.max_spend(), 500);
    assert_eq!(m.spent_so_far(), 0);
    assert_eq!(m.remaining(), 500);
    assert_eq!(m.delegate(), DELEGATE);
    // Authorised but empty: nothing can actually be spent yet.
    assert_eq!(m.funds(), 0);
    assert_eq!(m.spendable(), 0);
    assert!(!m.is_revoked());

    destroy(m);
}

#[test]
fun spendable_is_the_minimum_of_authorised_and_custodied() {
    // The distinction that makes custody meaningful: a mandate may authorise
    // more than it holds, and Person 4's UI must show the smaller number.
    let ctx = &mut tx_context::dummy();
    let m = funded(500, 120, ctx);

    assert_eq!(m.remaining(), 500);
    assert_eq!(m.funds(), 120);
    assert_eq!(m.spendable(), 120);

    destroy(m);
}

#[test]
fun spend_within_all_limits_is_allowed() {
    let ctx = &mut tx_context::dummy();
    let mut c = clock::create_for_testing(ctx);
    c.set_for_testing(NOW_MS);

    let m = funded(500, 500, ctx);
    m.assert_within_mandate(150, b"legal-review".to_string(), &c);

    destroy(m);
    destroy(c);
}

#[test, expected_failure(abort_code = mandate::EInsufficientMandateFunds, location = mandate)]
fun a_spend_beyond_custodied_funds_aborts_even_when_authorised() {
    // The whole point of custody. 500 is authorised, only 100 is held.
    let ctx = &mut tx_context::dummy();
    let mut c = clock::create_for_testing(ctx);
    c.set_for_testing(NOW_MS);

    let m = funded(500, 100, ctx);
    m.assert_within_mandate(150, b"legal-review".to_string(), &c);

    destroy(m);
    destroy(c);
}

#[test]
fun withdrawing_for_escrow_moves_money_and_advances_the_counter() {
    let mut scenario = test_scenario::begin(OWNER);
    let m = funded(500, 500, scenario.ctx());
    let mut c = clock::create_for_testing(scenario.ctx());
    c.set_for_testing(NOW_MS);
    let mut m = m;

    scenario.next_tx(DELEGATE);
    let payment = m.withdraw_for_escrow(
        150,
        b"legal-review".to_string(),
        &c,
        scenario.ctx(),
    );

    assert_eq!(payment.value(), 150);
    assert_eq!(m.spent_so_far(), 150);
    assert_eq!(m.remaining(), 350);
    // Money actually left custody — a counter alone would not show this.
    assert_eq!(m.funds(), 350);

    destroy(payment);
    destroy(m);
    destroy(c);
    scenario.end();
}

#[test]
fun a_refund_restores_both_the_balance_and_the_spent_counter() {
    // Without this, every refunded deal would permanently burn the human's
    // budget: they would have the money back but a mandate that believes it
    // is spent.
    let mut scenario = test_scenario::begin(OWNER);
    let mut m = funded(500, 500, scenario.ctx());
    let mut c = clock::create_for_testing(scenario.ctx());
    c.set_for_testing(NOW_MS);

    scenario.next_tx(DELEGATE);
    let payment = m.withdraw_for_escrow(150, b"legal-review".to_string(), &c, scenario.ctx());
    assert_eq!(m.spent_so_far(), 150);

    m.refund(payment);

    assert_eq!(m.spent_so_far(), 0);
    assert_eq!(m.funds(), 500);
    assert_eq!(m.remaining(), 500);

    destroy(m);
    destroy(c);
    scenario.end();
}

#[test]
fun a_revoked_mandate_still_accepts_refunds() {
    // Returning the human's own money to the human's own custody object must
    // not be blockable by a state the human themselves set.
    let mut scenario = test_scenario::begin(OWNER);
    let mut m = funded(500, 500, scenario.ctx());
    let mut c = clock::create_for_testing(scenario.ctx());
    c.set_for_testing(NOW_MS);

    scenario.next_tx(DELEGATE);
    let payment = m.withdraw_for_escrow(150, b"legal-review".to_string(), &c, scenario.ctx());

    scenario.next_tx(OWNER);
    m.revoke(scenario.ctx());
    m.refund(payment);

    assert!(m.is_revoked());
    assert_eq!(m.funds(), 500);

    destroy(m);
    destroy(c);
    scenario.end();
}

#[test]
fun the_owner_can_reclaim_unspent_funds() {
    let mut scenario = test_scenario::begin(OWNER);
    let mut m = funded(500, 400, scenario.ctx());

    let back = m.reclaim(scenario.ctx());

    assert_eq!(back.value(), 400);
    assert_eq!(m.funds(), 0);

    destroy(back);
    destroy(m);
    scenario.end();
}

#[test, expected_failure(abort_code = mandate::ENotOwner, location = mandate)]
fun a_stranger_cannot_reclaim_the_funds() {
    let mut scenario = test_scenario::begin(OWNER);
    let mut m = funded(500, 400, scenario.ctx());

    scenario.next_tx(STRANGER);
    let back = m.reclaim(scenario.ctx());

    destroy(back);
    destroy(m);
    scenario.end();
}

#[test, expected_failure(abort_code = mandate::EDelegateIsOwner, location = mandate)]
fun a_mandate_cannot_delegate_to_its_own_owner() {
    // A self-issued mandate is not a delegation, and it was the shape the old
    // "delegate mints itself a fresh uncapped mandate" bypass relied on.
    let mut scenario = test_scenario::begin(OWNER);
    let m = mandate::new(OWNER, 500, categories(), EXPIRES_MS, scenario.ctx());

    destroy(m);
    scenario.end();
}

#[test, expected_failure(abort_code = mandate::EInvalidMandate, location = mandate)]
fun a_zero_budget_mandate_is_rejected() {
    let ctx = &mut tx_context::dummy();
    let m = mandate::new(DELEGATE, 0, categories(), EXPIRES_MS, ctx);

    destroy(m);
}

#[test, expected_failure(abort_code = mandate::EInvalidMandate, location = mandate)]
fun a_mandate_with_no_categories_is_rejected() {
    let ctx = &mut tx_context::dummy();
    let m = mandate::new(DELEGATE, 500, vector[], EXPIRES_MS, ctx);

    destroy(m);
}

#[test, expected_failure(abort_code = mandate::ESpendLimitExceeded, location = mandate)]
fun spend_over_max_aborts() {
    let ctx = &mut tx_context::dummy();
    let mut c = clock::create_for_testing(ctx);
    c.set_for_testing(NOW_MS);

    let m = funded(500, 1000, ctx);
    m.assert_within_mandate(501, b"legal-review".to_string(), &c);

    destroy(m);
    destroy(c);
}

#[test]
fun a_spend_of_exactly_the_remaining_budget_is_allowed() {
    // Boundary: `<=` not `<`.
    let ctx = &mut tx_context::dummy();
    let mut c = clock::create_for_testing(ctx);
    c.set_for_testing(NOW_MS);

    let m = funded(500, 500, ctx);
    m.assert_within_mandate(500, b"legal-review".to_string(), &c);

    destroy(m);
    destroy(c);
}

#[test, expected_failure(abort_code = mandate::ESpendLimitExceeded, location = mandate)]
fun cumulative_spend_over_max_aborts() {
    let mut scenario = test_scenario::begin(OWNER);
    let mut m = funded(500, 1000, scenario.ctx());
    let mut c = clock::create_for_testing(scenario.ctx());
    c.set_for_testing(NOW_MS);

    scenario.next_tx(DELEGATE);
    let first = m.withdraw_for_escrow(400, b"legal-review".to_string(), &c, scenario.ctx());
    let second = m.withdraw_for_escrow(200, b"legal-review".to_string(), &c, scenario.ctx());

    destroy(first);
    destroy(second);
    destroy(m);
    destroy(c);
    scenario.end();
}

#[test, expected_failure(abort_code = mandate::ECategoryNotAllowed, location = mandate)]
fun spend_in_disallowed_category_aborts() {
    let ctx = &mut tx_context::dummy();
    let mut c = clock::create_for_testing(ctx);
    c.set_for_testing(NOW_MS);

    let m = funded(500, 500, ctx);
    m.assert_within_mandate(100, b"crypto-trading".to_string(), &c);

    destroy(m);
    destroy(c);
}

#[test, expected_failure(abort_code = mandate::EExpired, location = mandate)]
fun spend_after_expiry_aborts() {
    let ctx = &mut tx_context::dummy();
    let mut c = clock::create_for_testing(ctx);
    c.set_for_testing(EXPIRES_MS + 1);

    let m = funded(500, 500, ctx);
    m.assert_within_mandate(100, b"legal-review".to_string(), &c);

    destroy(m);
    destroy(c);
}

#[test, expected_failure(abort_code = mandate::EExpired, location = mandate)]
fun spend_exactly_at_expiry_aborts() {
    // Boundary: the check is `<`, so the expiry instant itself is expired.
    let ctx = &mut tx_context::dummy();
    let mut c = clock::create_for_testing(ctx);
    c.set_for_testing(EXPIRES_MS);

    let m = funded(500, 500, ctx);
    m.assert_within_mandate(100, b"legal-review".to_string(), &c);

    destroy(m);
    destroy(c);
}

#[test, expected_failure(abort_code = mandate::ERevoked, location = mandate)]
fun spend_against_revoked_mandate_aborts() {
    let mut scenario = test_scenario::begin(OWNER);
    let mut m = funded(500, 500, scenario.ctx());
    let mut c = clock::create_for_testing(scenario.ctx());
    c.set_for_testing(NOW_MS);

    m.revoke(scenario.ctx());
    m.assert_within_mandate(100, b"legal-review".to_string(), &c);

    destroy(m);
    destroy(c);
    scenario.end();
}

#[test]
fun owner_can_revoke() {
    let mut scenario = test_scenario::begin(OWNER);
    let mut m = funded(500, 500, scenario.ctx());

    m.revoke(scenario.ctx());
    assert!(m.is_revoked());

    destroy(m);
    scenario.end();
}

#[test, expected_failure(abort_code = mandate::ENotOwner, location = mandate)]
fun non_owner_cannot_revoke() {
    let mut scenario = test_scenario::begin(OWNER);
    let mut m = funded(500, 500, scenario.ctx());

    scenario.next_tx(STRANGER);
    m.revoke(scenario.ctx());

    destroy(m);
    scenario.end();
}

#[test, expected_failure(abort_code = mandate::ENotDelegate, location = mandate)]
fun non_delegate_cannot_spend() {
    let mut scenario = test_scenario::begin(OWNER);
    let mut m = funded(500, 500, scenario.ctx());
    let mut c = clock::create_for_testing(scenario.ctx());
    c.set_for_testing(NOW_MS);

    scenario.next_tx(STRANGER);
    let payment = m.withdraw_for_escrow(100, b"legal-review".to_string(), &c, scenario.ctx());

    destroy(payment);
    destroy(m);
    destroy(c);
    scenario.end();
}
