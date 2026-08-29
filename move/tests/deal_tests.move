// Owner: Person 1 (Move/contracts).
//
// Escrow lifecycle tests. These cover the two functions Person 2's PTBs call
// (`create_and_lock_escrow`, `verify_and_release`), the access control on
// delivery, and the status-transition guard.
//
// See the cleanup note in mandate_tests.move for why `expected_failure` tests
// still destroy their values.
#[test_only]
module escrow::deal_tests;

use std::string::String;
use std::unit_test::{assert_eq, destroy};
use sui::clock;
use sui::coin;
use sui::sui::SUI;
use sui::test_scenario::{Self, Scenario};
use escrow::agent_identity::{Self, AgentIdentity, AgentRegistry};
use escrow::deal;
use escrow::mandate::{Self, Mandate};
use escrow::reputation::{Self, Reputation};

const CLIENT: address = @0xA;
const SPECIALIST: address = @0xB;
const STRANGER: address = @0xC;

const NOW_MS: u64 = 1_000_000;
const EXPIRES_MS: u64 = 2_000_000;
const BUDGET: u64 = 1_000;
const PRICE: u64 = 150;

fun categories(): vector<String> {
    vector[b"legal-review".to_string()]
}

/// Registers one agent owned by the current sender and shares its Reputation.
fun register_agent(scenario: &mut Scenario, name: vector<u8>): AgentIdentity {
    let mut registry = scenario.take_shared<AgentRegistry>();
    let (identity, reputation) = agent_identity::register(
        &mut registry,
        name.to_string(),
        categories(),
        scenario.ctx(),
    );
    reputation.share();
    test_scenario::return_shared(registry);
    identity
}

/// A throwaway ID standing in for Person 3's verification record. The UID has
/// no `drop`, so it must be explicitly deleted after taking its inner ID.
fun fresh_proof_ref(scenario: &mut Scenario): ID {
    let id = object::new(scenario.ctx());
    let inner = id.to_inner();
    id.delete();
    inner
}

/// Sets up: shared registry, a client agent, a specialist agent, and a Mandate
/// whose delegate is CLIENT (the address that will submit PTB #1).
fun setup(scenario: &mut Scenario): (AgentIdentity, AgentIdentity, Mandate) {
    agent_identity::init_for_testing(scenario.ctx());

    scenario.next_tx(CLIENT);
    let client_agent = register_agent(scenario, b"client-envoy");

    scenario.next_tx(SPECIALIST);
    let specialist_agent = register_agent(scenario, b"legal-review");

    scenario.next_tx(CLIENT);
    let m = mandate::new(CLIENT, BUDGET, categories(), EXPIRES_MS, scenario.ctx());

    (client_agent, specialist_agent, m)
}

#[test]
fun escrow_deliver_release_completes_and_pays_specialist() {
    let mut scenario = test_scenario::begin(CLIENT);
    let (client_agent, specialist_agent, mut m) = setup(&mut scenario);

    let mut c = clock::create_for_testing(scenario.ctx());
    c.set_for_testing(NOW_MS);

    // PTB #1 — lock escrow and create the deal.
    let payment = coin::mint_for_testing<SUI>(PRICE, scenario.ctx());
    let mut d = deal::create_and_lock_escrow(
        &mut m,
        payment,
        object::id(&client_agent),
        object::id(&specialist_agent),
        b"legal-review".to_string(),
        &c,
        scenario.ctx(),
    );

    assert_eq!(d.status_rank(), 1); // Escrowed
    assert_eq!(d.escrowed_amount(), PRICE);
    assert_eq!(m.spent_so_far(), PRICE);
    assert_eq!(m.remaining(), BUDGET - PRICE);

    // Specialist delivers, pointing proof_ref at Person 3's verification record.
    scenario.next_tx(SPECIALIST);
    let proof_ref = fresh_proof_ref(&mut scenario);
    d.mark_delivered(&specialist_agent, proof_ref, scenario.ctx());

    assert_eq!(d.status_rank(), 2); // Delivered
    assert!(d.proof_ref().is_some());

    // PTB #2 — verify, release, update both reputations.
    scenario.next_tx(CLIENT);
    let mut client_rep = scenario.take_shared<Reputation>();
    scenario.next_tx(SPECIALIST);
    let mut specialist_rep = scenario.take_shared<Reputation>();

    let payout = d.verify_and_release(
        &mut client_rep,
        &mut specialist_rep,
        scenario.ctx(),
    );

    // The escrowed SUI actually moved out of the Deal and into a returned Coin
    // the PTB can transfer — this is the assertion that proves escrow works.
    assert_eq!(payout.value(), PRICE);
    assert_eq!(d.escrowed_amount(), 0);
    assert_eq!(d.status_rank(), 4); // Released

    assert_eq!(client_rep.completed_deals(), 1);
    assert_eq!(specialist_rep.completed_deals(), 1);
    assert_eq!(specialist_rep.score(), 100);

    destroy(payout);
    destroy(d);
    destroy(m);
    destroy(c);
    destroy(client_agent);
    destroy(specialist_agent);
    test_scenario::return_shared(client_rep);
    test_scenario::return_shared(specialist_rep);
    scenario.end();
}

#[test, expected_failure(abort_code = mandate::ESpendLimitExceeded, location = mandate)]
fun escrow_over_mandate_budget_aborts_before_funds_move() {
    let mut scenario = test_scenario::begin(CLIENT);
    let (client_agent, specialist_agent, mut m) = setup(&mut scenario);

    let mut c = clock::create_for_testing(scenario.ctx());
    c.set_for_testing(NOW_MS);

    let payment = coin::mint_for_testing<SUI>(BUDGET + 1, scenario.ctx());
    let d = deal::create_and_lock_escrow(
        &mut m,
        payment,
        object::id(&client_agent),
        object::id(&specialist_agent),
        b"legal-review".to_string(),
        &c,
        scenario.ctx(),
    );

    destroy(d);
    destroy(m);
    destroy(c);
    destroy(client_agent);
    destroy(specialist_agent);
    scenario.end();
}

#[test, expected_failure(abort_code = mandate::ENotDelegate, location = mandate)]
fun non_delegate_cannot_lock_escrow() {
    let mut scenario = test_scenario::begin(CLIENT);
    let (client_agent, specialist_agent, mut m) = setup(&mut scenario);

    let mut c = clock::create_for_testing(scenario.ctx());
    c.set_for_testing(NOW_MS);

    // STRANGER is not the mandate's delegate.
    scenario.next_tx(STRANGER);
    let payment = coin::mint_for_testing<SUI>(PRICE, scenario.ctx());
    let d = deal::create_and_lock_escrow(
        &mut m,
        payment,
        object::id(&client_agent),
        object::id(&specialist_agent),
        b"legal-review".to_string(),
        &c,
        scenario.ctx(),
    );

    destroy(d);
    destroy(m);
    destroy(c);
    destroy(client_agent);
    destroy(specialist_agent);
    scenario.end();
}

#[test, expected_failure(abort_code = deal::ENotSpecialist, location = deal)]
fun non_specialist_cannot_mark_delivered() {
    let mut scenario = test_scenario::begin(CLIENT);
    let (client_agent, specialist_agent, mut m) = setup(&mut scenario);

    let mut c = clock::create_for_testing(scenario.ctx());
    c.set_for_testing(NOW_MS);

    let payment = coin::mint_for_testing<SUI>(PRICE, scenario.ctx());
    let mut d = deal::create_and_lock_escrow(
        &mut m,
        payment,
        object::id(&client_agent),
        object::id(&specialist_agent),
        b"legal-review".to_string(),
        &c,
        scenario.ctx(),
    );

    // The client agent is a party to the deal but is not the specialist.
    let proof_ref = fresh_proof_ref(&mut scenario);
    d.mark_delivered(&client_agent, proof_ref, scenario.ctx());

    destroy(d);
    destroy(m);
    destroy(c);
    destroy(client_agent);
    destroy(specialist_agent);
    scenario.end();
}

#[test, expected_failure(abort_code = deal::EInvalidTransition, location = deal)]
fun release_before_delivery_aborts() {
    let mut scenario = test_scenario::begin(CLIENT);
    let (client_agent, specialist_agent, mut m) = setup(&mut scenario);

    let mut c = clock::create_for_testing(scenario.ctx());
    c.set_for_testing(NOW_MS);

    let payment = coin::mint_for_testing<SUI>(PRICE, scenario.ctx());
    let mut d = deal::create_and_lock_escrow(
        &mut m,
        payment,
        object::id(&client_agent),
        object::id(&specialist_agent),
        b"legal-review".to_string(),
        &c,
        scenario.ctx(),
    );

    scenario.next_tx(CLIENT);
    let mut client_rep = scenario.take_shared<Reputation>();
    scenario.next_tx(SPECIALIST);
    let mut specialist_rep = scenario.take_shared<Reputation>();

    // Escrowed -> Verified is not a legal single step; delivery must happen
    // first. Without this guard a client could drain escrow without delivery.
    let payout = d.verify_and_release(&mut client_rep, &mut specialist_rep, scenario.ctx());

    destroy(payout);
    destroy(d);
    destroy(m);
    destroy(c);
    destroy(client_agent);
    destroy(specialist_agent);
    test_scenario::return_shared(client_rep);
    test_scenario::return_shared(specialist_rep);
    scenario.end();
}

#[test]
fun dispute_marks_deal_disputed_and_records_against_both() {
    let mut scenario = test_scenario::begin(CLIENT);
    let (client_agent, specialist_agent, mut m) = setup(&mut scenario);

    let mut c = clock::create_for_testing(scenario.ctx());
    c.set_for_testing(NOW_MS);

    let payment = coin::mint_for_testing<SUI>(PRICE, scenario.ctx());
    let mut d = deal::create_and_lock_escrow(
        &mut m,
        payment,
        object::id(&client_agent),
        object::id(&specialist_agent),
        b"legal-review".to_string(),
        &c,
        scenario.ctx(),
    );

    scenario.next_tx(CLIENT);
    let mut client_rep = scenario.take_shared<Reputation>();
    scenario.next_tx(SPECIALIST);
    let mut specialist_rep = scenario.take_shared<Reputation>();

    scenario.next_tx(CLIENT);
    d.raise_dispute(&client_agent, &mut client_rep, &mut specialist_rep, scenario.ctx());

    assert_eq!(d.status_rank(), 5); // Disputed
    assert_eq!(client_rep.disputed_deals(), 1);
    assert_eq!(specialist_rep.disputed_deals(), 1);
    // Escrow stays locked: dispute RESOLUTION is out of scope by design.
    assert_eq!(d.escrowed_amount(), PRICE);

    destroy(d);
    destroy(m);
    destroy(c);
    destroy(client_agent);
    destroy(specialist_agent);
    test_scenario::return_shared(client_rep);
    test_scenario::return_shared(specialist_rep);
    scenario.end();
}
