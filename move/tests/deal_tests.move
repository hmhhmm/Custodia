// Owner: Person 1 (Move/contracts).
//
// Escrow lifecycle tests. These cover the two functions Person 2's PTBs call
// (`create_and_lock_escrow`, `verify_and_release`), the access control on
// delivery and release, and the status-transition guard.
//
// See the cleanup note in mandate_tests.move for why `expected_failure` tests
// still destroy their values.
//
// NOTE on taking Reputation objects: these tests use `take_shared_by_id` with
// the ID from `identity.reputation_id()`, never bare `take_shared<Reputation>`.
// `take_shared` returns the MOST RECENTLY created shared object of that type
// and is NOT scoped by the current sender, so `next_tx(CLIENT)` does not select
// the client's Reputation. An earlier version of this file used it and silently
// had the two objects swapped; every assertion was symmetric, so the tests
// passed anyway and nothing verified reputation attribution at all.
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
use escrow::reputation::Reputation;

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

fun category(): String {
    b"legal-review".to_string()
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

/// Takes the Reputation that actually belongs to `identity`, by ID.
fun take_rep(scenario: &Scenario, identity: &AgentIdentity): Reputation {
    test_scenario::take_shared_by_id<Reputation>(scenario, identity.reputation_id())
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

/// The full PTB #1 call, which every test needs and which now takes the shared
/// registry and the client's identity.
fun lock_escrow(
    scenario: &mut Scenario,
    m: &mut Mandate,
    client_agent: &AgentIdentity,
    specialist_id: ID,
    amount: u64,
    c: &clock::Clock,
): deal::Deal {
    let registry = scenario.take_shared<AgentRegistry>();
    let payment = coin::mint_for_testing<SUI>(amount, scenario.ctx());
    let d = deal::create_and_lock_escrow(
        m,
        &registry,
        client_agent,
        payment,
        specialist_id,
        category(),
        c,
        scenario.ctx(),
    );
    test_scenario::return_shared(registry);
    d
}

#[test]
fun escrow_deliver_release_completes_and_pays_specialist() {
    let mut scenario = test_scenario::begin(CLIENT);
    let (client_agent, specialist_agent, mut m) = setup(&mut scenario);

    let mut c = clock::create_for_testing(scenario.ctx());
    c.set_for_testing(NOW_MS);

    // PTB #1 — lock escrow and create the deal.
    let specialist_id = object::id(&specialist_agent);
    let mut d = lock_escrow(&mut scenario, &mut m, &client_agent, specialist_id, PRICE, &c);

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

    // PTB #2 — the CLIENT verifies, releases, and both reputations update.
    scenario.next_tx(CLIENT);
    let mut client_rep = take_rep(&scenario, &client_agent);
    let mut specialist_rep = take_rep(&scenario, &specialist_agent);

    // The attribution assertion the old suite was missing entirely.
    assert_eq!(client_rep.agent_id(), object::id(&client_agent));
    assert_eq!(specialist_rep.agent_id(), object::id(&specialist_agent));

    let payout = d.verify_and_release(
        &client_agent,
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
    // One completion no longer scores a perfect 100 — see reputation_tests.
    assert_eq!(specialist_rep.score(), 58);

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
fun entry_create_and_share_locks_escrow_and_shares_the_deal() {
    // The `entry` wrappers are the ONLY functions a PTB can call that both
    // create and dispose of these objects, so they were the paths most worth
    // covering and had no coverage at all.
    let mut scenario = test_scenario::begin(CLIENT);
    let (client_agent, specialist_agent, mut m) = setup(&mut scenario);

    let mut c = clock::create_for_testing(scenario.ctx());
    c.set_for_testing(NOW_MS);

    scenario.next_tx(CLIENT);
    let registry = scenario.take_shared<AgentRegistry>();
    let payment = coin::mint_for_testing<SUI>(PRICE, scenario.ctx());
    deal::create_and_share(
        &mut m,
        &registry,
        &client_agent,
        payment,
        object::id(&specialist_agent),
        category(),
        &c,
        scenario.ctx(),
    );
    test_scenario::return_shared(registry);

    scenario.next_tx(CLIENT);
    let d = scenario.take_shared<deal::Deal>();
    assert_eq!(d.status_rank(), 1);
    assert_eq!(d.escrowed_amount(), PRICE);

    test_scenario::return_shared(d);
    destroy(m);
    destroy(c);
    destroy(client_agent);
    destroy(specialist_agent);
    scenario.end();
}

#[test, expected_failure(abort_code = deal::ENotClient, location = deal)]
fun stranger_cannot_release_a_delivered_deal() {
    // THE critical regression test. Before the fix, `verify_and_release` had no
    // caller check at all, so any address could release any delivered deal and
    // route the payout to itself.
    let mut scenario = test_scenario::begin(CLIENT);
    let (client_agent, specialist_agent, mut m) = setup(&mut scenario);

    let mut c = clock::create_for_testing(scenario.ctx());
    c.set_for_testing(NOW_MS);

    let specialist_id = object::id(&specialist_agent);
    let mut d = lock_escrow(&mut scenario, &mut m, &client_agent, specialist_id, PRICE, &c);

    scenario.next_tx(SPECIALIST);
    let proof_ref = fresh_proof_ref(&mut scenario);
    d.mark_delivered(&specialist_agent, proof_ref, scenario.ctx());

    // STRANGER holds no identity on this deal, so the best they can do is pass
    // one of the real parties' identities — which fails the ownership check.
    scenario.next_tx(STRANGER);
    let mut client_rep = take_rep(&scenario, &client_agent);
    let mut specialist_rep = take_rep(&scenario, &specialist_agent);

    let payout = d.verify_and_release(
        &specialist_agent,
        &mut client_rep,
        &mut specialist_rep,
        scenario.ctx(),
    );

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

#[test, expected_failure(abort_code = deal::ENotIdentityOwner, location = deal)]
fun non_owner_of_the_client_identity_cannot_release() {
    // Second half of the release guard: holding the right identity is not
    // enough, the sender must own it.
    let mut scenario = test_scenario::begin(CLIENT);
    let (client_agent, specialist_agent, mut m) = setup(&mut scenario);

    let mut c = clock::create_for_testing(scenario.ctx());
    c.set_for_testing(NOW_MS);

    let specialist_id = object::id(&specialist_agent);
    let mut d = lock_escrow(&mut scenario, &mut m, &client_agent, specialist_id, PRICE, &c);

    scenario.next_tx(SPECIALIST);
    let proof_ref = fresh_proof_ref(&mut scenario);
    d.mark_delivered(&specialist_agent, proof_ref, scenario.ctx());

    scenario.next_tx(STRANGER);
    let mut client_rep = take_rep(&scenario, &client_agent);
    let mut specialist_rep = take_rep(&scenario, &specialist_agent);

    let payout = d.verify_and_release(
        &client_agent,
        &mut client_rep,
        &mut specialist_rep,
        scenario.ctx(),
    );

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

#[test, expected_failure(abort_code = deal::EWrongReputation, location = deal)]
fun release_with_an_unrelated_reputation_aborts() {
    // Reputation farming: pass your own Reputation to collect a completed deal
    // off someone else's release.
    let mut scenario = test_scenario::begin(CLIENT);
    let (client_agent, specialist_agent, mut m) = setup(&mut scenario);

    scenario.next_tx(STRANGER);
    let outsider = register_agent(&mut scenario, b"outsider");

    let mut c = clock::create_for_testing(scenario.ctx());
    c.set_for_testing(NOW_MS);

    scenario.next_tx(CLIENT);
    let specialist_id = object::id(&specialist_agent);
    let mut d = lock_escrow(&mut scenario, &mut m, &client_agent, specialist_id, PRICE, &c);

    scenario.next_tx(SPECIALIST);
    let proof_ref = fresh_proof_ref(&mut scenario);
    d.mark_delivered(&specialist_agent, proof_ref, scenario.ctx());

    scenario.next_tx(CLIENT);
    let mut client_rep = take_rep(&scenario, &client_agent);
    let mut outsider_rep = take_rep(&scenario, &outsider);

    let payout = d.verify_and_release(
        &client_agent,
        &mut client_rep,
        &mut outsider_rep,
        scenario.ctx(),
    );

    destroy(payout);
    destroy(d);
    destroy(m);
    destroy(c);
    destroy(client_agent);
    destroy(specialist_agent);
    destroy(outsider);
    test_scenario::return_shared(client_rep);
    test_scenario::return_shared(outsider_rep);
    scenario.end();
}

#[test, expected_failure(abort_code = deal::EWrongReputation, location = deal)]
fun disputing_with_a_rivals_reputation_aborts() {
    // Reputation griefing: be a party to a throwaway deal, then dispute it
    // while passing a competitor's Reputation to tank their score.
    let mut scenario = test_scenario::begin(CLIENT);
    let (client_agent, specialist_agent, mut m) = setup(&mut scenario);

    scenario.next_tx(STRANGER);
    let rival = register_agent(&mut scenario, b"rival");

    let mut c = clock::create_for_testing(scenario.ctx());
    c.set_for_testing(NOW_MS);

    scenario.next_tx(CLIENT);
    let specialist_id = object::id(&specialist_agent);
    let mut d = lock_escrow(&mut scenario, &mut m, &client_agent, specialist_id, PRICE, &c);

    scenario.next_tx(CLIENT);
    let mut client_rep = take_rep(&scenario, &client_agent);
    let mut rival_rep = take_rep(&scenario, &rival);

    d.raise_dispute(&client_agent, &mut client_rep, &mut rival_rep, scenario.ctx());

    destroy(d);
    destroy(m);
    destroy(c);
    destroy(client_agent);
    destroy(specialist_agent);
    destroy(rival);
    test_scenario::return_shared(client_rep);
    test_scenario::return_shared(rival_rep);
    scenario.end();
}

#[test, expected_failure(abort_code = deal::ENotParty, location = deal)]
fun non_party_cannot_raise_a_dispute() {
    let mut scenario = test_scenario::begin(CLIENT);
    let (client_agent, specialist_agent, mut m) = setup(&mut scenario);

    scenario.next_tx(STRANGER);
    let outsider = register_agent(&mut scenario, b"outsider");

    let mut c = clock::create_for_testing(scenario.ctx());
    c.set_for_testing(NOW_MS);

    scenario.next_tx(CLIENT);
    let specialist_id = object::id(&specialist_agent);
    let mut d = lock_escrow(&mut scenario, &mut m, &client_agent, specialist_id, PRICE, &c);

    scenario.next_tx(STRANGER);
    let mut client_rep = take_rep(&scenario, &client_agent);
    let mut specialist_rep = take_rep(&scenario, &specialist_agent);

    d.raise_dispute(&outsider, &mut client_rep, &mut specialist_rep, scenario.ctx());

    destroy(d);
    destroy(m);
    destroy(c);
    destroy(client_agent);
    destroy(specialist_agent);
    destroy(outsider);
    test_scenario::return_shared(client_rep);
    test_scenario::return_shared(specialist_rep);
    scenario.end();
}

#[test, expected_failure(abort_code = deal::EInvalidTransition, location = deal)]
fun releasing_twice_aborts() {
    let mut scenario = test_scenario::begin(CLIENT);
    let (client_agent, specialist_agent, mut m) = setup(&mut scenario);

    let mut c = clock::create_for_testing(scenario.ctx());
    c.set_for_testing(NOW_MS);

    let specialist_id = object::id(&specialist_agent);
    let mut d = lock_escrow(&mut scenario, &mut m, &client_agent, specialist_id, PRICE, &c);

    scenario.next_tx(SPECIALIST);
    let proof_ref = fresh_proof_ref(&mut scenario);
    d.mark_delivered(&specialist_agent, proof_ref, scenario.ctx());

    scenario.next_tx(CLIENT);
    let mut client_rep = take_rep(&scenario, &client_agent);
    let mut specialist_rep = take_rep(&scenario, &specialist_agent);

    let first = d.verify_and_release(
        &client_agent,
        &mut client_rep,
        &mut specialist_rep,
        scenario.ctx(),
    );
    let second = d.verify_and_release(
        &client_agent,
        &mut client_rep,
        &mut specialist_rep,
        scenario.ctx(),
    );

    destroy(first);
    destroy(second);
    destroy(d);
    destroy(m);
    destroy(c);
    destroy(client_agent);
    destroy(specialist_agent);
    test_scenario::return_shared(client_rep);
    test_scenario::return_shared(specialist_rep);
    scenario.end();
}

#[test, expected_failure(abort_code = deal::EInvalidTransition, location = deal)]
fun releasing_a_disputed_deal_aborts_and_funds_stay_locked() {
    // This is the assertion the demo narrative rests on: once disputed, the
    // escrow cannot be released by anyone.
    let mut scenario = test_scenario::begin(CLIENT);
    let (client_agent, specialist_agent, mut m) = setup(&mut scenario);

    let mut c = clock::create_for_testing(scenario.ctx());
    c.set_for_testing(NOW_MS);

    let specialist_id = object::id(&specialist_agent);
    let mut d = lock_escrow(&mut scenario, &mut m, &client_agent, specialist_id, PRICE, &c);

    scenario.next_tx(SPECIALIST);
    let proof_ref = fresh_proof_ref(&mut scenario);
    d.mark_delivered(&specialist_agent, proof_ref, scenario.ctx());

    scenario.next_tx(CLIENT);
    let mut client_rep = take_rep(&scenario, &client_agent);
    let mut specialist_rep = take_rep(&scenario, &specialist_agent);

    d.raise_dispute(&client_agent, &mut client_rep, &mut specialist_rep, scenario.ctx());
    assert_eq!(d.escrowed_amount(), PRICE);

    let payout = d.verify_and_release(
        &client_agent,
        &mut client_rep,
        &mut specialist_rep,
        scenario.ctx(),
    );

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

#[test, expected_failure(abort_code = deal::EZeroAmount, location = deal)]
fun zero_value_deals_are_rejected() {
    // A zero-value deal costs nothing to create, which is what made reputation
    // farming and dispute griefing free.
    let mut scenario = test_scenario::begin(CLIENT);
    let (client_agent, specialist_agent, mut m) = setup(&mut scenario);

    let mut c = clock::create_for_testing(scenario.ctx());
    c.set_for_testing(NOW_MS);

    let specialist_id = object::id(&specialist_agent);
    let d = lock_escrow(&mut scenario, &mut m, &client_agent, specialist_id, 0, &c);

    destroy(d);
    destroy(m);
    destroy(c);
    destroy(client_agent);
    destroy(specialist_agent);
    scenario.end();
}

#[test, expected_failure(abort_code = deal::ESameAgent, location = deal)]
fun an_agent_cannot_deal_with_itself() {
    // Self-dealing credited both sides of the same owner's reputation.
    let mut scenario = test_scenario::begin(CLIENT);
    let (client_agent, specialist_agent, mut m) = setup(&mut scenario);

    let mut c = clock::create_for_testing(scenario.ctx());
    c.set_for_testing(NOW_MS);

    let client_id = object::id(&client_agent);
    let d = lock_escrow(&mut scenario, &mut m, &client_agent, client_id, PRICE, &c);

    destroy(d);
    destroy(m);
    destroy(c);
    destroy(client_agent);
    destroy(specialist_agent);
    scenario.end();
}

#[test, expected_failure(abort_code = deal::ESpecialistNotRegistered, location = deal)]
fun a_fabricated_specialist_id_is_rejected() {
    // A deal naming an ID nobody owns can never reach Delivered, so the escrow
    // would be stranded with no actor able to move it.
    let mut scenario = test_scenario::begin(CLIENT);
    let (client_agent, specialist_agent, mut m) = setup(&mut scenario);

    let mut c = clock::create_for_testing(scenario.ctx());
    c.set_for_testing(NOW_MS);

    scenario.next_tx(CLIENT);
    let bogus = fresh_proof_ref(&mut scenario);
    let d = lock_escrow(&mut scenario, &mut m, &client_agent, bogus, PRICE, &c);

    destroy(d);
    destroy(m);
    destroy(c);
    destroy(client_agent);
    destroy(specialist_agent);
    scenario.end();
}

#[test, expected_failure(abort_code = deal::ENotIdentityOwner, location = deal)]
fun cannot_lock_escrow_naming_someone_elses_agent_as_client() {
    // `client_agent` used to be an unvalidated caller-supplied ID, so a delegate
    // could emit DealCreated naming any victim's agent as the client.
    let mut scenario = test_scenario::begin(CLIENT);
    let (client_agent, specialist_agent, mut m) = setup(&mut scenario);

    let mut c = clock::create_for_testing(scenario.ctx());
    c.set_for_testing(NOW_MS);

    // CLIENT is the mandate's delegate, but passes the SPECIALIST's identity as
    // the client agent — an identity CLIENT does not own.
    scenario.next_tx(CLIENT);
    let client_id = object::id(&client_agent);
    let d = lock_escrow(&mut scenario, &mut m, &specialist_agent, client_id, PRICE, &c);

    destroy(d);
    destroy(m);
    destroy(c);
    destroy(client_agent);
    destroy(specialist_agent);
    scenario.end();
}

#[test, expected_failure(abort_code = mandate::ESpendLimitExceeded, location = mandate)]
fun escrow_over_mandate_budget_aborts() {
    let mut scenario = test_scenario::begin(CLIENT);
    let (client_agent, specialist_agent, mut m) = setup(&mut scenario);

    let mut c = clock::create_for_testing(scenario.ctx());
    c.set_for_testing(NOW_MS);

    let specialist_id = object::id(&specialist_agent);
    let d = lock_escrow(&mut scenario, &mut m, &client_agent, specialist_id, BUDGET + 1, &c);

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
    let specialist_id = object::id(&specialist_agent);
    let d = lock_escrow(&mut scenario, &mut m, &client_agent, specialist_id, PRICE, &c);

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

    let specialist_id = object::id(&specialist_agent);
    let mut d = lock_escrow(&mut scenario, &mut m, &client_agent, specialist_id, PRICE, &c);

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

#[test, expected_failure(abort_code = deal::ENotIdentityOwner, location = deal)]
fun specialist_identity_not_owned_by_sender_cannot_mark_delivered() {
    // The second assert in mark_delivered, which was previously unreachable by
    // any test because it shared an abort code with the first.
    let mut scenario = test_scenario::begin(CLIENT);
    let (client_agent, specialist_agent, mut m) = setup(&mut scenario);

    let mut c = clock::create_for_testing(scenario.ctx());
    c.set_for_testing(NOW_MS);

    let specialist_id = object::id(&specialist_agent);
    let mut d = lock_escrow(&mut scenario, &mut m, &client_agent, specialist_id, PRICE, &c);

    // Right identity, wrong sender: STRANGER does not own it.
    scenario.next_tx(STRANGER);
    let proof_ref = fresh_proof_ref(&mut scenario);
    d.mark_delivered(&specialist_agent, proof_ref, scenario.ctx());

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

    let specialist_id = object::id(&specialist_agent);
    let mut d = lock_escrow(&mut scenario, &mut m, &client_agent, specialist_id, PRICE, &c);

    scenario.next_tx(CLIENT);
    let mut client_rep = take_rep(&scenario, &client_agent);
    let mut specialist_rep = take_rep(&scenario, &specialist_agent);

    // Escrowed -> Verified is not a legal single step; delivery must happen
    // first. Without this guard a client could drain escrow without delivery.
    let payout = d.verify_and_release(
        &client_agent,
        &mut client_rep,
        &mut specialist_rep,
        scenario.ctx(),
    );

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

    let specialist_id = object::id(&specialist_agent);
    let mut d = lock_escrow(&mut scenario, &mut m, &client_agent, specialist_id, PRICE, &c);

    scenario.next_tx(CLIENT);
    let mut client_rep = take_rep(&scenario, &client_agent);
    let mut specialist_rep = take_rep(&scenario, &specialist_agent);

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

#[test]
fun the_specialist_may_also_dispute() {
    // Only the client side was covered before.
    let mut scenario = test_scenario::begin(CLIENT);
    let (client_agent, specialist_agent, mut m) = setup(&mut scenario);

    let mut c = clock::create_for_testing(scenario.ctx());
    c.set_for_testing(NOW_MS);

    let specialist_id = object::id(&specialist_agent);
    let mut d = lock_escrow(&mut scenario, &mut m, &client_agent, specialist_id, PRICE, &c);

    scenario.next_tx(SPECIALIST);
    let mut client_rep = take_rep(&scenario, &client_agent);
    let mut specialist_rep = take_rep(&scenario, &specialist_agent);

    d.raise_dispute(&specialist_agent, &mut client_rep, &mut specialist_rep, scenario.ctx());

    assert_eq!(d.status_rank(), 5);

    destroy(d);
    destroy(m);
    destroy(c);
    destroy(client_agent);
    destroy(specialist_agent);
    test_scenario::return_shared(client_rep);
    test_scenario::return_shared(specialist_rep);
    scenario.end();
}
