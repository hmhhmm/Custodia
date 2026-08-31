// Owner: Person 1 (Move/contracts).
//
// Custodia lifecycle tests.
//
// Address roles, which the custody change made meaningful:
//   HUMAN      owns the Mandate and deposits the principal
//   CLIENT     the agent address the Mandate delegates to; owns the client
//              AgentIdentity and signs PTB #1 and PTB #2
//   SPECIALIST owns the specialist AgentIdentity; accepts and delivers
// A Mandate may no longer delegate to its own owner, so HUMAN and CLIENT must
// be distinct — the old suite had one address playing both, which was exactly
// the configuration that made the cap meaningless.
//
// NOTE on taking Reputation objects: these tests use `take_shared_by_id` with
// the ID from `identity.reputation_id()`, never bare `take_shared<Reputation>`.
// `take_shared` returns the MOST RECENTLY created shared object of that type
// and is NOT scoped by sender, so `next_tx(CLIENT)` does not select the
// client's Reputation. An earlier version of this file used it and silently
// had the two objects swapped; every assertion was symmetric, so it passed
// anyway and nothing verified attribution at all.
//
// See the cleanup note in mandate_tests.move for why `expected_failure` tests
// still destroy their values.
#[test_only]
module custodia::deal_tests;

use std::string::String;
use std::unit_test::{assert_eq, destroy};
use sui::clock::{Self, Clock};
use sui::event;
use sui::coin::{Self, Coin};
use sui::sui::SUI;
use sui::test_scenario::{Self, Scenario};
use custodia::agent_identity::{Self, AgentIdentity, AgentRegistry};
use custodia::deal::{Self, Deal};
use custodia::mandate::{Self, Mandate};
use custodia::proof::{Self, DealProof};
use custodia::reputation::Reputation;

const HUMAN: address = @0xA;
const CLIENT: address = @0xB;
const SPECIALIST: address = @0xC;
const STRANGER: address = @0xD;
const ARBITER: address = @0xE;

const NOW_MS: u64 = 1_000_000_000;
const MANDATE_EXPIRES_MS: u64 = 90_000_000_000;
const DELIVERY_WINDOW: u64 = 86_400_000; // 24h
const REVIEW_WINDOW: u64 = 86_400_000; // 24h
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

/// The Reputation that actually belongs to `identity`, taken by ID.
fun take_rep(scenario: &Scenario, identity: &AgentIdentity): Reputation {
    test_scenario::take_shared_by_id<Reputation>(scenario, identity.reputation_id())
}

/// Registry, two agents, and a FUNDED mandate owned by HUMAN delegating to
/// CLIENT. Leaves the sender as CLIENT.
fun setup(scenario: &mut Scenario): (AgentIdentity, AgentIdentity, Mandate) {
    agent_identity::init_for_testing(scenario.ctx());

    scenario.next_tx(CLIENT);
    let client_agent = register_agent(scenario, b"client-envoy");

    scenario.next_tx(SPECIALIST);
    let specialist_agent = register_agent(scenario, b"legal-review");

    scenario.next_tx(HUMAN);
    let mut m = mandate::new(CLIENT, BUDGET, categories(), MANDATE_EXPIRES_MS, scenario.ctx());
    let funding = coin::mint_for_testing<SUI>(BUDGET, scenario.ctx());
    m.deposit(funding, scenario.ctx());

    scenario.next_tx(CLIENT);
    (client_agent, specialist_agent, m)
}

fun clock_at(scenario: &mut Scenario, ms: u64): Clock {
    let mut c = clock::create_for_testing(scenario.ctx());
    c.set_for_testing(ms);
    c
}

/// PTB #1, with the sender already set by the caller.
fun lock_escrow(
    scenario: &mut Scenario,
    m: &mut Mandate,
    client: &AgentIdentity,
    specialist_id: ID,
    amount: u64,
    arbiter: Option<address>,
    c: &Clock,
): Deal {
    let registry = scenario.take_shared<AgentRegistry>();
    let d = deal::create_and_lock_escrow(
        m,
        &registry,
        client,
        specialist_id,
        category(),
        amount,
        DELIVERY_WINDOW,
        REVIEW_WINDOW,
        arbiter,
        c,
        scenario.ctx(),
    );
    test_scenario::return_shared(registry);
    d
}

/// Builds a proof for `deal` as the current sender and marks it delivered.
fun deliver(scenario: &mut Scenario, d: &mut Deal, specialist: &AgentIdentity, c: &Clock) {
    let p = proof::new_simulated(
        object::id(d),
        b"walrus/testnet".to_string(),
        b"blob-abc".to_string(),
        b"attestation-1".to_string(),
        b"nautilus.mock".to_string(),
        vector[],
        c,
        scenario.ctx(),
    );
    d.mark_delivered(specialist, &p, c, scenario.ctx());
    proof::share_proof(p);
}

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

#[test]
fun accept_deliver_release_pays_the_specialist_address() {
    // THE test whose absence let a live bug ship: the old suite asserted the
    // returned coin's value and destroyed it, never asking who should have
    // received the money.
    let mut scenario = test_scenario::begin(HUMAN);
    let (client_agent, specialist_agent, mut m) = setup(&mut scenario);
    let c = clock_at(&mut scenario, NOW_MS);

    let specialist_id = object::id(&specialist_agent);
    let mut d = lock_escrow(
        &mut scenario, &mut m, &client_agent, specialist_id, PRICE, option::none(), &c,
    );

    assert_eq!(d.status_rank(), 1); // Escrowed
    assert_eq!(d.escrowed_amount(), PRICE);
    // Custody: the money came out of the Mandate, not a wallet.
    assert_eq!(m.funds(), BUDGET - PRICE);
    assert_eq!(m.spent_so_far(), PRICE);

    scenario.next_tx(SPECIALIST);
    let dl = d.stage_deadline_ms();
    d.accept(&specialist_agent, option::none(), dl, PRICE, &c, scenario.ctx());
    assert_eq!(d.status_rank(), 2); // Accepted

    deliver(&mut scenario, &mut d, &specialist_agent, &c);
    assert_eq!(d.status_rank(), 3); // Delivered
    assert!(d.proof_ref().is_some());

    scenario.next_tx(CLIENT);
    let mut client_rep = take_rep(&scenario, &client_agent);
    let mut specialist_rep = take_rep(&scenario, &specialist_agent);
    assert_eq!(client_rep.agent_id(), object::id(&client_agent));
    assert_eq!(specialist_rep.agent_id(), object::id(&specialist_agent));

    let registry = scenario.take_shared<AgentRegistry>();
    d.verify_and_release(&registry, &client_agent, &mut client_rep, &mut specialist_rep, scenario.ctx());
    test_scenario::return_shared(registry);

    assert_eq!(d.escrowed_amount(), 0);
    assert_eq!(d.status_rank(), 5); // Released
    assert_eq!(client_rep.completed_deals(), 1);
    assert_eq!(specialist_rep.completed_deals(), 1);

    test_scenario::return_shared(client_rep);
    test_scenario::return_shared(specialist_rep);

    // The assertion that matters: the SPECIALIST holds the coin.
    scenario.next_tx(SPECIALIST);
    let paid = scenario.take_from_sender<Coin<SUI>>();
    assert_eq!(paid.value(), PRICE);
    scenario.return_to_sender(paid);

    // And the client does NOT.
    scenario.next_tx(CLIENT);
    assert!(!scenario.has_most_recent_for_sender<Coin<SUI>>());

    destroy(d);
    destroy(m);
    destroy(c);
    destroy(client_agent);
    destroy(specialist_agent);
    scenario.end();
}

// ---------------------------------------------------------------------------
// Timeouts — the exits that make this an escrow
// ---------------------------------------------------------------------------

#[test]
fun the_specialist_can_claim_payment_when_the_client_ghosts() {
    let mut scenario = test_scenario::begin(HUMAN);
    let (client_agent, specialist_agent, mut m) = setup(&mut scenario);
    let c = clock_at(&mut scenario, NOW_MS);

    let specialist_id = object::id(&specialist_agent);
    let mut d = lock_escrow(
        &mut scenario, &mut m, &client_agent, specialist_id, PRICE, option::none(), &c,
    );

    scenario.next_tx(SPECIALIST);
    let dl = d.stage_deadline_ms();
    d.accept(&specialist_agent, option::none(), dl, PRICE, &c, scenario.ctx());
    deliver(&mut scenario, &mut d, &specialist_agent, &c);

    // The client never responds. Anyone may poke it after the review window —
    // here a STRANGER does, proving liveness does not depend on either party
    // being online or funded.
    let later = clock_at(&mut scenario, d.stage_deadline_ms() + 1);
    scenario.next_tx(STRANGER);
    let mut specialist_rep = take_rep(&scenario, &specialist_agent);
    let registry = scenario.take_shared<AgentRegistry>();
    d.claim_release(&registry, &mut specialist_rep, &later, scenario.ctx());
    test_scenario::return_shared(registry);

    assert_eq!(d.status_rank(), 5); // Released
    assert_eq!(specialist_rep.completed_deals(), 1);
    test_scenario::return_shared(specialist_rep);

    scenario.next_tx(SPECIALIST);
    let paid = scenario.take_from_sender<Coin<SUI>>();
    assert_eq!(paid.value(), PRICE);
    scenario.return_to_sender(paid);

    destroy(d);
    destroy(m);
    destroy(c);
    destroy(later);
    destroy(client_agent);
    destroy(specialist_agent);
    scenario.end();
}

#[test]
fun the_client_gets_a_refund_when_the_specialist_never_delivers() {
    let mut scenario = test_scenario::begin(HUMAN);
    let (client_agent, specialist_agent, mut m) = setup(&mut scenario);
    let c = clock_at(&mut scenario, NOW_MS);

    let specialist_id = object::id(&specialist_agent);
    let mut d = lock_escrow(
        &mut scenario, &mut m, &client_agent, specialist_id, PRICE, option::none(), &c,
    );

    scenario.next_tx(SPECIALIST);
    let dl = d.stage_deadline_ms();
    d.accept(&specialist_agent, option::none(), dl, PRICE, &c, scenario.ctx());

    // ...then goes silent.
    let later = clock_at(&mut scenario, d.stage_deadline_ms() + 1);
    scenario.next_tx(STRANGER);
    let mut specialist_rep = take_rep(&scenario, &specialist_agent);
    let registry = scenario.take_shared<AgentRegistry>();
    d.claim_refund(&registry, &mut m, &mut specialist_rep, &later, scenario.ctx());
    test_scenario::return_shared(registry);

    assert_eq!(d.status_rank(), 7); // Refunded
    assert_eq!(d.escrowed_amount(), 0);
    // The mandate is made whole — budget AND balance.
    assert_eq!(m.funds(), BUDGET);
    assert_eq!(m.spent_so_far(), 0);
    // They accepted and then failed to deliver, which is objectively true.
    assert_eq!(specialist_rep.disputed_deals(), 1);
    test_scenario::return_shared(specialist_rep);

    destroy(d);
    destroy(m);
    destroy(c);
    destroy(later);
    destroy(client_agent);
    destroy(specialist_agent);
    scenario.end();
}

#[test]
fun an_unaccepted_specialist_is_not_blamed_for_a_refund() {
    // Anyone can name any registered agent as specialist, so dinging an agent
    // that never accepted would hand every attacker a free reputation weapon.
    let mut scenario = test_scenario::begin(HUMAN);
    let (client_agent, specialist_agent, mut m) = setup(&mut scenario);
    let c = clock_at(&mut scenario, NOW_MS);

    let specialist_id = object::id(&specialist_agent);
    let mut d = lock_escrow(
        &mut scenario, &mut m, &client_agent, specialist_id, PRICE, option::none(), &c,
    );

    let later = clock_at(&mut scenario, d.stage_deadline_ms() + 1);
    scenario.next_tx(STRANGER);
    let mut specialist_rep = take_rep(&scenario, &specialist_agent);
    let registry = scenario.take_shared<AgentRegistry>();
    d.claim_refund(&registry, &mut m, &mut specialist_rep, &later, scenario.ctx());
    test_scenario::return_shared(registry);

    assert_eq!(d.status_rank(), 7);
    assert_eq!(m.funds(), BUDGET);
    // Never accepted, so no blame.
    assert_eq!(specialist_rep.disputed_deals(), 0);
    test_scenario::return_shared(specialist_rep);

    destroy(d);
    destroy(m);
    destroy(c);
    destroy(later);
    destroy(client_agent);
    destroy(specialist_agent);
    scenario.end();
}

#[test]
fun the_client_can_withdraw_an_unaccepted_offer() {
    let mut scenario = test_scenario::begin(HUMAN);
    let (client_agent, specialist_agent, mut m) = setup(&mut scenario);
    let c = clock_at(&mut scenario, NOW_MS);

    let specialist_id = object::id(&specialist_agent);
    let mut d = lock_escrow(
        &mut scenario, &mut m, &client_agent, specialist_id, PRICE, option::none(), &c,
    );

    scenario.next_tx(CLIENT);
    d.withdraw_offer(&mut m, &client_agent, scenario.ctx());

    assert_eq!(d.status_rank(), 7); // Refunded
    assert_eq!(m.funds(), BUDGET);

    destroy(d);
    destroy(m);
    destroy(c);
    destroy(client_agent);
    destroy(specialist_agent);
    scenario.end();
}

#[test, expected_failure(abort_code = deal::EInvalidTransition, location = deal)]
fun the_client_cannot_rug_an_accepted_deal() {
    // What `accept` buys the specialist: once they have started, the client
    // cannot unilaterally cancel.
    let mut scenario = test_scenario::begin(HUMAN);
    let (client_agent, specialist_agent, mut m) = setup(&mut scenario);
    let c = clock_at(&mut scenario, NOW_MS);

    let specialist_id = object::id(&specialist_agent);
    let mut d = lock_escrow(
        &mut scenario, &mut m, &client_agent, specialist_id, PRICE, option::none(), &c,
    );

    scenario.next_tx(SPECIALIST);
    let dl = d.stage_deadline_ms();
    d.accept(&specialist_agent, option::none(), dl, PRICE, &c, scenario.ctx());

    scenario.next_tx(CLIENT);
    d.withdraw_offer(&mut m, &client_agent, scenario.ctx());

    destroy(d);
    destroy(m);
    destroy(c);
    destroy(client_agent);
    destroy(specialist_agent);
    scenario.end();
}

#[test, expected_failure(abort_code = deal::EDeadlineNotReached, location = deal)]
fun claiming_release_before_the_review_deadline_aborts() {
    let mut scenario = test_scenario::begin(HUMAN);
    let (client_agent, specialist_agent, mut m) = setup(&mut scenario);
    let c = clock_at(&mut scenario, NOW_MS);

    let specialist_id = object::id(&specialist_agent);
    let mut d = lock_escrow(
        &mut scenario, &mut m, &client_agent, specialist_id, PRICE, option::none(), &c,
    );

    scenario.next_tx(SPECIALIST);
    let dl = d.stage_deadline_ms();
    d.accept(&specialist_agent, option::none(), dl, PRICE, &c, scenario.ctx());
    deliver(&mut scenario, &mut d, &specialist_agent, &c);

    scenario.next_tx(STRANGER);
    let mut specialist_rep = take_rep(&scenario, &specialist_agent);
    let registry = scenario.take_shared<AgentRegistry>();
    d.claim_release(&registry, &mut specialist_rep, &c, scenario.ctx());

    test_scenario::return_shared(registry);
    test_scenario::return_shared(specialist_rep);
    destroy(d);
    destroy(m);
    destroy(c);
    destroy(client_agent);
    destroy(specialist_agent);
    scenario.end();
}

// ---------------------------------------------------------------------------
// Disputes
// ---------------------------------------------------------------------------

#[test]
fun an_arbiter_splits_the_escrow_and_both_sides_are_paid() {
    let mut scenario = test_scenario::begin(HUMAN);
    let (client_agent, specialist_agent, mut m) = setup(&mut scenario);
    let c = clock_at(&mut scenario, NOW_MS);

    let specialist_id = object::id(&specialist_agent);
    let mut d = lock_escrow(
        &mut scenario, &mut m, &client_agent, specialist_id, PRICE, option::some(ARBITER), &c,
    );

    scenario.next_tx(SPECIALIST);
    let dl = d.stage_deadline_ms();
    d.accept(&specialist_agent, option::some(ARBITER), dl, PRICE, &c, scenario.ctx());
    deliver(&mut scenario, &mut d, &specialist_agent, &c);

    scenario.next_tx(CLIENT);
    d.raise_dispute(&client_agent, &c, scenario.ctx());
    assert_eq!(d.status_rank(), 6); // Disputed

    scenario.next_tx(ARBITER);
    let mut client_rep = take_rep(&scenario, &client_agent);
    let mut specialist_rep = take_rep(&scenario, &specialist_agent);
    let registry = scenario.take_shared<AgentRegistry>();
    // 40% back to the client, 60% to the specialist.
    d.resolve_dispute(&registry, &mut m, &mut client_rep, &mut specialist_rep, 4_000, scenario.ctx());
    test_scenario::return_shared(registry);

    assert_eq!(d.status_rank(), 8); // Settled
    assert_eq!(d.escrowed_amount(), 0);
    // The client's share went back into the Mandate, not to a wallet.
    assert_eq!(m.funds(), BUDGET - PRICE + 60);
    assert_eq!(client_rep.disputed_deals(), 1);
    assert_eq!(specialist_rep.disputed_deals(), 1);
    test_scenario::return_shared(client_rep);
    test_scenario::return_shared(specialist_rep);

    scenario.next_tx(SPECIALIST);
    let paid = scenario.take_from_sender<Coin<SUI>>();
    assert_eq!(paid.value(), 90);
    scenario.return_to_sender(paid);

    destroy(d);
    destroy(m);
    destroy(c);
    destroy(client_agent);
    destroy(specialist_agent);
    scenario.end();
}

#[test]
fun an_unanswered_dispute_settles_at_the_default_split() {
    // What stops an arbiter stalling: after the window, anyone routes around
    // them to a symmetric outcome both sides knew in advance.
    let mut scenario = test_scenario::begin(HUMAN);
    let (client_agent, specialist_agent, mut m) = setup(&mut scenario);
    let c = clock_at(&mut scenario, NOW_MS);

    let specialist_id = object::id(&specialist_agent);
    let mut d = lock_escrow(
        &mut scenario, &mut m, &client_agent, specialist_id, PRICE, option::some(ARBITER), &c,
    );

    scenario.next_tx(SPECIALIST);
    let dl = d.stage_deadline_ms();
    d.accept(&specialist_agent, option::some(ARBITER), dl, PRICE, &c, scenario.ctx());
    deliver(&mut scenario, &mut d, &specialist_agent, &c);

    scenario.next_tx(CLIENT);
    d.raise_dispute(&client_agent, &c, scenario.ctx());

    let later = clock_at(&mut scenario, d.stage_deadline_ms() + 1);
    scenario.next_tx(STRANGER);
    let mut client_rep = take_rep(&scenario, &client_agent);
    let mut specialist_rep = take_rep(&scenario, &specialist_agent);
    let registry = scenario.take_shared<AgentRegistry>();
    d.settle_default(&registry, &mut m, &mut client_rep, &mut specialist_rep, &later, scenario.ctx());
    test_scenario::return_shared(registry);

    assert_eq!(d.status_rank(), 8);
    assert_eq!(m.funds(), BUDGET - PRICE + 75);
    test_scenario::return_shared(client_rep);
    test_scenario::return_shared(specialist_rep);

    scenario.next_tx(SPECIALIST);
    let paid = scenario.take_from_sender<Coin<SUI>>();
    assert_eq!(paid.value(), 75);
    scenario.return_to_sender(paid);

    destroy(d);
    destroy(m);
    destroy(c);
    destroy(later);
    destroy(client_agent);
    destroy(specialist_agent);
    scenario.end();
}

#[test]
fun a_specialist_can_concede_a_dispute_without_any_arbiter() {
    // Concessions are acts against the actor's own interest, so they need no
    // counterparty signature and no third party. Most real disputes should end
    // here.
    let mut scenario = test_scenario::begin(HUMAN);
    let (client_agent, specialist_agent, mut m) = setup(&mut scenario);
    let c = clock_at(&mut scenario, NOW_MS);

    let specialist_id = object::id(&specialist_agent);
    let mut d = lock_escrow(
        &mut scenario, &mut m, &client_agent, specialist_id, PRICE, option::none(), &c,
    );

    scenario.next_tx(SPECIALIST);
    let dl = d.stage_deadline_ms();
    d.accept(&specialist_agent, option::none(), dl, PRICE, &c, scenario.ctx());
    deliver(&mut scenario, &mut d, &specialist_agent, &c);

    scenario.next_tx(CLIENT);
    d.raise_dispute(&client_agent, &c, scenario.ctx());

    scenario.next_tx(SPECIALIST);
    let mut specialist_rep = take_rep(&scenario, &specialist_agent);
    let registry = scenario.take_shared<AgentRegistry>();
    d.concede_refund(&registry, &mut m, &specialist_agent, &mut specialist_rep, scenario.ctx());
    test_scenario::return_shared(registry);

    assert_eq!(d.status_rank(), 7); // Refunded
    assert_eq!(m.funds(), BUDGET);
    assert_eq!(specialist_rep.disputed_deals(), 1);
    test_scenario::return_shared(specialist_rep);

    destroy(d);
    destroy(m);
    destroy(c);
    destroy(client_agent);
    destroy(specialist_agent);
    scenario.end();
}

#[test]
fun a_client_can_concede_a_dispute_by_releasing() {
    let mut scenario = test_scenario::begin(HUMAN);
    let (client_agent, specialist_agent, mut m) = setup(&mut scenario);
    let c = clock_at(&mut scenario, NOW_MS);

    let specialist_id = object::id(&specialist_agent);
    let mut d = lock_escrow(
        &mut scenario, &mut m, &client_agent, specialist_id, PRICE, option::none(), &c,
    );

    scenario.next_tx(SPECIALIST);
    let dl = d.stage_deadline_ms();
    d.accept(&specialist_agent, option::none(), dl, PRICE, &c, scenario.ctx());
    deliver(&mut scenario, &mut d, &specialist_agent, &c);

    scenario.next_tx(CLIENT);
    d.raise_dispute(&client_agent, &c, scenario.ctx());

    let mut client_rep = take_rep(&scenario, &client_agent);
    let mut specialist_rep = take_rep(&scenario, &specialist_agent);
    let registry = scenario.take_shared<AgentRegistry>();
    d.verify_and_release(&registry, &client_agent, &mut client_rep, &mut specialist_rep, scenario.ctx());
    test_scenario::return_shared(registry);

    assert_eq!(d.status_rank(), 5); // Released
    test_scenario::return_shared(client_rep);
    test_scenario::return_shared(specialist_rep);

    destroy(d);
    destroy(m);
    destroy(c);
    destroy(client_agent);
    destroy(specialist_agent);
    scenario.end();
}

#[test, expected_failure(abort_code = deal::EInvalidTransition, location = deal)]
fun a_dispute_cannot_be_raised_before_delivery() {
    // The fix for a free griefing weapon: since reaching Delivered needs the
    // specialist's own signature, no agent can be dragged into a dispute over
    // a deal they never engaged with.
    let mut scenario = test_scenario::begin(HUMAN);
    let (client_agent, specialist_agent, mut m) = setup(&mut scenario);
    let c = clock_at(&mut scenario, NOW_MS);

    let specialist_id = object::id(&specialist_agent);
    let mut d = lock_escrow(
        &mut scenario, &mut m, &client_agent, specialist_id, PRICE, option::none(), &c,
    );

    scenario.next_tx(CLIENT);
    d.raise_dispute(&client_agent, &c, scenario.ctx());

    destroy(d);
    destroy(m);
    destroy(c);
    destroy(client_agent);
    destroy(specialist_agent);
    scenario.end();
}

#[test, expected_failure(abort_code = deal::ENotClient, location = deal)]
fun the_specialist_cannot_raise_a_dispute() {
    // A specialist disputing their own deal would just be a way to freeze the
    // client's funds.
    let mut scenario = test_scenario::begin(HUMAN);
    let (client_agent, specialist_agent, mut m) = setup(&mut scenario);
    let c = clock_at(&mut scenario, NOW_MS);

    let specialist_id = object::id(&specialist_agent);
    let mut d = lock_escrow(
        &mut scenario, &mut m, &client_agent, specialist_id, PRICE, option::none(), &c,
    );

    scenario.next_tx(SPECIALIST);
    let dl = d.stage_deadline_ms();
    d.accept(&specialist_agent, option::none(), dl, PRICE, &c, scenario.ctx());
    deliver(&mut scenario, &mut d, &specialist_agent, &c);
    d.raise_dispute(&specialist_agent, &c, scenario.ctx());

    destroy(d);
    destroy(m);
    destroy(c);
    destroy(client_agent);
    destroy(specialist_agent);
    scenario.end();
}

#[test, expected_failure(abort_code = deal::ENotArbiter, location = deal)]
fun a_stranger_cannot_resolve_a_dispute() {
    let mut scenario = test_scenario::begin(HUMAN);
    let (client_agent, specialist_agent, mut m) = setup(&mut scenario);
    let c = clock_at(&mut scenario, NOW_MS);

    let specialist_id = object::id(&specialist_agent);
    let mut d = lock_escrow(
        &mut scenario, &mut m, &client_agent, specialist_id, PRICE, option::some(ARBITER), &c,
    );

    scenario.next_tx(SPECIALIST);
    let dl = d.stage_deadline_ms();
    d.accept(&specialist_agent, option::some(ARBITER), dl, PRICE, &c, scenario.ctx());
    deliver(&mut scenario, &mut d, &specialist_agent, &c);

    scenario.next_tx(CLIENT);
    d.raise_dispute(&client_agent, &c, scenario.ctx());

    scenario.next_tx(STRANGER);
    let mut client_rep = take_rep(&scenario, &client_agent);
    let mut specialist_rep = take_rep(&scenario, &specialist_agent);
    let registry = scenario.take_shared<AgentRegistry>();
    d.resolve_dispute(&registry, &mut m, &mut client_rep, &mut specialist_rep, 5_000, scenario.ctx());

    test_scenario::return_shared(registry);
    test_scenario::return_shared(client_rep);
    test_scenario::return_shared(specialist_rep);
    destroy(d);
    destroy(m);
    destroy(c);
    destroy(client_agent);
    destroy(specialist_agent);
    scenario.end();
}

#[test, expected_failure(abort_code = deal::ENoArbiter, location = deal)]
fun resolving_an_arbiterless_deal_aborts() {
    let mut scenario = test_scenario::begin(HUMAN);
    let (client_agent, specialist_agent, mut m) = setup(&mut scenario);
    let c = clock_at(&mut scenario, NOW_MS);

    let specialist_id = object::id(&specialist_agent);
    let mut d = lock_escrow(
        &mut scenario, &mut m, &client_agent, specialist_id, PRICE, option::none(), &c,
    );

    scenario.next_tx(SPECIALIST);
    let dl = d.stage_deadline_ms();
    d.accept(&specialist_agent, option::none(), dl, PRICE, &c, scenario.ctx());
    deliver(&mut scenario, &mut d, &specialist_agent, &c);

    scenario.next_tx(CLIENT);
    d.raise_dispute(&client_agent, &c, scenario.ctx());

    scenario.next_tx(ARBITER);
    let mut client_rep = take_rep(&scenario, &client_agent);
    let mut specialist_rep = take_rep(&scenario, &specialist_agent);
    let registry = scenario.take_shared<AgentRegistry>();
    d.resolve_dispute(&registry, &mut m, &mut client_rep, &mut specialist_rep, 5_000, scenario.ctx());

    test_scenario::return_shared(registry);
    test_scenario::return_shared(client_rep);
    test_scenario::return_shared(specialist_rep);
    destroy(d);
    destroy(m);
    destroy(c);
    destroy(client_agent);
    destroy(specialist_agent);
    scenario.end();
}

// ---------------------------------------------------------------------------
// Authorization and validation
// ---------------------------------------------------------------------------

#[test, expected_failure(abort_code = deal::ENotClient, location = deal)]
fun a_stranger_cannot_release_a_delivered_deal() {
    let mut scenario = test_scenario::begin(HUMAN);
    let (client_agent, specialist_agent, mut m) = setup(&mut scenario);
    let c = clock_at(&mut scenario, NOW_MS);

    let specialist_id = object::id(&specialist_agent);
    let mut d = lock_escrow(
        &mut scenario, &mut m, &client_agent, specialist_id, PRICE, option::none(), &c,
    );

    scenario.next_tx(SPECIALIST);
    let dl = d.stage_deadline_ms();
    d.accept(&specialist_agent, option::none(), dl, PRICE, &c, scenario.ctx());
    deliver(&mut scenario, &mut d, &specialist_agent, &c);

    scenario.next_tx(STRANGER);
    let mut client_rep = take_rep(&scenario, &client_agent);
    let mut specialist_rep = take_rep(&scenario, &specialist_agent);
    let registry = scenario.take_shared<AgentRegistry>();
    d.verify_and_release(&registry, &specialist_agent, &mut client_rep, &mut specialist_rep, scenario.ctx());

    test_scenario::return_shared(registry);
    test_scenario::return_shared(client_rep);
    test_scenario::return_shared(specialist_rep);
    destroy(d);
    destroy(m);
    destroy(c);
    destroy(client_agent);
    destroy(specialist_agent);
    scenario.end();
}

#[test, expected_failure(abort_code = deal::ENotIdentityOwner, location = deal)]
fun holding_the_right_identity_is_not_enough_to_release() {
    let mut scenario = test_scenario::begin(HUMAN);
    let (client_agent, specialist_agent, mut m) = setup(&mut scenario);
    let c = clock_at(&mut scenario, NOW_MS);

    let specialist_id = object::id(&specialist_agent);
    let mut d = lock_escrow(
        &mut scenario, &mut m, &client_agent, specialist_id, PRICE, option::none(), &c,
    );

    scenario.next_tx(SPECIALIST);
    let dl = d.stage_deadline_ms();
    d.accept(&specialist_agent, option::none(), dl, PRICE, &c, scenario.ctx());
    deliver(&mut scenario, &mut d, &specialist_agent, &c);

    scenario.next_tx(STRANGER);
    let mut client_rep = take_rep(&scenario, &client_agent);
    let mut specialist_rep = take_rep(&scenario, &specialist_agent);
    let registry = scenario.take_shared<AgentRegistry>();
    d.verify_and_release(&registry, &client_agent, &mut client_rep, &mut specialist_rep, scenario.ctx());

    test_scenario::return_shared(registry);
    test_scenario::return_shared(client_rep);
    test_scenario::return_shared(specialist_rep);
    destroy(d);
    destroy(m);
    destroy(c);
    destroy(client_agent);
    destroy(specialist_agent);
    scenario.end();
}

#[test, expected_failure(abort_code = deal::EProofNotForThisDeal, location = deal)]
fun a_proof_built_for_another_deal_is_rejected() {
    // Proof replay: do the work once, cite it across N deals.
    let mut scenario = test_scenario::begin(HUMAN);
    let (client_agent, specialist_agent, mut m) = setup(&mut scenario);
    let c = clock_at(&mut scenario, NOW_MS);

    let specialist_id = object::id(&specialist_agent);
    let mut d = lock_escrow(
        &mut scenario, &mut m, &client_agent, specialist_id, PRICE, option::none(), &c,
    );

    scenario.next_tx(SPECIALIST);
    let dl = d.stage_deadline_ms();
    d.accept(&specialist_agent, option::none(), dl, PRICE, &c, scenario.ctx());

    // A proof naming some other object as its deal.
    let p = proof::new_simulated(
        object::id(&specialist_agent),
        b"walrus/testnet".to_string(),
        b"blob-abc".to_string(),
        b"attestation-1".to_string(),
        b"nautilus.mock".to_string(),
        vector[],
        &c,
        scenario.ctx(),
    );
    d.mark_delivered(&specialist_agent, &p, &c, scenario.ctx());

    proof::share_proof(p);
    destroy(d);
    destroy(m);
    destroy(c);
    destroy(client_agent);
    destroy(specialist_agent);
    scenario.end();
}

#[test, expected_failure(abort_code = deal::EProofNotBySpecialist, location = deal)]
fun replaying_another_agents_proof_is_rejected() {
    let mut scenario = test_scenario::begin(HUMAN);
    let (client_agent, specialist_agent, mut m) = setup(&mut scenario);
    let c = clock_at(&mut scenario, NOW_MS);

    let specialist_id = object::id(&specialist_agent);
    let mut d = lock_escrow(
        &mut scenario, &mut m, &client_agent, specialist_id, PRICE, option::none(), &c,
    );

    scenario.next_tx(SPECIALIST);
    let dl = d.stage_deadline_ms();
    d.accept(&specialist_agent, option::none(), dl, PRICE, &c, scenario.ctx());

    // A third party creates a genuine-looking proof for this deal.
    scenario.next_tx(STRANGER);
    let p = proof::new_simulated(
        object::id(&d),
        b"walrus/testnet".to_string(),
        b"blob-abc".to_string(),
        b"attestation-1".to_string(),
        b"nautilus.mock".to_string(),
        vector[],
        &c,
        scenario.ctx(),
    );

    scenario.next_tx(SPECIALIST);
    d.mark_delivered(&specialist_agent, &p, &c, scenario.ctx());

    proof::share_proof(p);
    destroy(d);
    destroy(m);
    destroy(c);
    destroy(client_agent);
    destroy(specialist_agent);
    scenario.end();
}

#[test, expected_failure(abort_code = deal::EZeroAmount, location = deal)]
fun zero_value_deals_are_rejected() {
    let mut scenario = test_scenario::begin(HUMAN);
    let (client_agent, specialist_agent, mut m) = setup(&mut scenario);
    let c = clock_at(&mut scenario, NOW_MS);

    let specialist_id = object::id(&specialist_agent);
    let d = lock_escrow(&mut scenario, &mut m, &client_agent, specialist_id, 0, option::none(), &c);

    destroy(d);
    destroy(m);
    destroy(c);
    destroy(client_agent);
    destroy(specialist_agent);
    scenario.end();
}

#[test, expected_failure(abort_code = deal::ESameAgent, location = deal)]
fun an_agent_cannot_deal_with_itself() {
    let mut scenario = test_scenario::begin(HUMAN);
    let (client_agent, specialist_agent, mut m) = setup(&mut scenario);
    let c = clock_at(&mut scenario, NOW_MS);

    let client_id = object::id(&client_agent);
    let d = lock_escrow(&mut scenario, &mut m, &client_agent, client_id, PRICE, option::none(), &c);

    destroy(d);
    destroy(m);
    destroy(c);
    destroy(client_agent);
    destroy(specialist_agent);
    scenario.end();
}

#[test, expected_failure(abort_code = deal::ESameOwner, location = deal)]
fun one_owner_cannot_sit_on_both_sides_of_a_deal() {
    // A speed bump against wash-trading, not Sybil resistance: addresses are
    // free, so a determined attacker uses two wallets. It removes the trivial
    // single-address case.
    let mut scenario = test_scenario::begin(HUMAN);
    let (client_agent, specialist_agent, mut m) = setup(&mut scenario);
    let c = clock_at(&mut scenario, NOW_MS);

    // CLIENT registers a SECOND agent and tries to use it as the specialist.
    scenario.next_tx(CLIENT);
    let second = register_agent(&mut scenario, b"client-envoy-2");
    let second_id = object::id(&second);

    scenario.next_tx(CLIENT);
    let d = lock_escrow(&mut scenario, &mut m, &client_agent, second_id, PRICE, option::none(), &c);

    destroy(d);
    destroy(second);
    destroy(m);
    destroy(c);
    destroy(client_agent);
    destroy(specialist_agent);
    scenario.end();
}

#[test, expected_failure(abort_code = deal::ESpecialistNotRegistered, location = deal)]
fun a_fabricated_specialist_id_is_rejected() {
    let mut scenario = test_scenario::begin(HUMAN);
    let (client_agent, specialist_agent, mut m) = setup(&mut scenario);
    let c = clock_at(&mut scenario, NOW_MS);

    let bogus = object::id(&m);
    let d = lock_escrow(&mut scenario, &mut m, &client_agent, bogus, PRICE, option::none(), &c);

    destroy(d);
    destroy(m);
    destroy(c);
    destroy(client_agent);
    destroy(specialist_agent);
    scenario.end();
}

#[test, expected_failure(abort_code = deal::EWindowOutOfRange, location = deal)]
fun an_absurd_delivery_window_is_rejected() {
    // Catches the seconds-vs-milliseconds bug class, which would otherwise
    // lock funds for centuries.
    let mut scenario = test_scenario::begin(HUMAN);
    let (client_agent, specialist_agent, mut m) = setup(&mut scenario);
    let c = clock_at(&mut scenario, NOW_MS);

    let registry = scenario.take_shared<AgentRegistry>();
    let d = deal::create_and_lock_escrow(
        &mut m,
        &registry,
        &client_agent,
        object::id(&specialist_agent),
        category(),
        PRICE,
        86_400_000_000, // 1000x too large
        REVIEW_WINDOW,
        option::none(),
        &c,
        scenario.ctx(),
    );

    test_scenario::return_shared(registry);
    destroy(d);
    destroy(m);
    destroy(c);
    destroy(client_agent);
    destroy(specialist_agent);
    scenario.end();
}

#[test, expected_failure(abort_code = deal::ETermsMismatch, location = deal)]
fun accepting_different_terms_than_the_deal_carries_aborts() {
    let mut scenario = test_scenario::begin(HUMAN);
    let (client_agent, specialist_agent, mut m) = setup(&mut scenario);
    let c = clock_at(&mut scenario, NOW_MS);

    let specialist_id = object::id(&specialist_agent);
    let mut d = lock_escrow(
        &mut scenario, &mut m, &client_agent, specialist_id, PRICE, option::none(), &c,
    );

    scenario.next_tx(SPECIALIST);
    // Believes it is accepting a deal with an arbiter; the deal has none.
    let dl = d.stage_deadline_ms();
    d.accept(&specialist_agent, option::some(ARBITER), dl, PRICE, &c, scenario.ctx());

    destroy(d);
    destroy(m);
    destroy(c);
    destroy(client_agent);
    destroy(specialist_agent);
    scenario.end();
}

#[test, expected_failure(abort_code = deal::EInvalidTransition, location = deal)]
fun delivering_before_accepting_aborts() {
    let mut scenario = test_scenario::begin(HUMAN);
    let (client_agent, specialist_agent, mut m) = setup(&mut scenario);
    let c = clock_at(&mut scenario, NOW_MS);

    let specialist_id = object::id(&specialist_agent);
    let mut d = lock_escrow(
        &mut scenario, &mut m, &client_agent, specialist_id, PRICE, option::none(), &c,
    );

    scenario.next_tx(SPECIALIST);
    deliver(&mut scenario, &mut d, &specialist_agent, &c);

    destroy(d);
    destroy(m);
    destroy(c);
    destroy(client_agent);
    destroy(specialist_agent);
    scenario.end();
}

#[test, expected_failure(abort_code = deal::EInvalidTransition, location = deal)]
fun releasing_twice_aborts() {
    let mut scenario = test_scenario::begin(HUMAN);
    let (client_agent, specialist_agent, mut m) = setup(&mut scenario);
    let c = clock_at(&mut scenario, NOW_MS);

    let specialist_id = object::id(&specialist_agent);
    let mut d = lock_escrow(
        &mut scenario, &mut m, &client_agent, specialist_id, PRICE, option::none(), &c,
    );

    scenario.next_tx(SPECIALIST);
    let dl = d.stage_deadline_ms();
    d.accept(&specialist_agent, option::none(), dl, PRICE, &c, scenario.ctx());
    deliver(&mut scenario, &mut d, &specialist_agent, &c);

    scenario.next_tx(CLIENT);
    let mut client_rep = take_rep(&scenario, &client_agent);
    let mut specialist_rep = take_rep(&scenario, &specialist_agent);
    let registry = scenario.take_shared<AgentRegistry>();
    d.verify_and_release(&registry, &client_agent, &mut client_rep, &mut specialist_rep, scenario.ctx());
    d.verify_and_release(&registry, &client_agent, &mut client_rep, &mut specialist_rep, scenario.ctx());

    test_scenario::return_shared(registry);
    test_scenario::return_shared(client_rep);
    test_scenario::return_shared(specialist_rep);
    destroy(d);
    destroy(m);
    destroy(c);
    destroy(client_agent);
    destroy(specialist_agent);
    scenario.end();
}

#[test, expected_failure(abort_code = mandate::ESpendLimitExceeded, location = mandate)]
fun escrow_over_the_mandate_budget_aborts() {
    let mut scenario = test_scenario::begin(HUMAN);
    let (client_agent, specialist_agent, mut m) = setup(&mut scenario);
    let c = clock_at(&mut scenario, NOW_MS);

    let specialist_id = object::id(&specialist_agent);
    let d = lock_escrow(
        &mut scenario, &mut m, &client_agent, specialist_id, BUDGET + 1, option::none(), &c,
    );

    destroy(d);
    destroy(m);
    destroy(c);
    destroy(client_agent);
    destroy(specialist_agent);
    scenario.end();
}

#[test, expected_failure(abort_code = deal::ENotIdentityOwner, location = deal)]
fun a_stranger_cannot_lock_escrow_with_someone_elses_client_identity() {
    let mut scenario = test_scenario::begin(HUMAN);
    let (client_agent, specialist_agent, mut m) = setup(&mut scenario);
    let c = clock_at(&mut scenario, NOW_MS);

    scenario.next_tx(STRANGER);
    let specialist_id = object::id(&specialist_agent);
    let d = lock_escrow(
        &mut scenario, &mut m, &client_agent, specialist_id, PRICE, option::none(), &c,
    );

    destroy(d);
    destroy(m);
    destroy(c);
    destroy(client_agent);
    destroy(specialist_agent);
    scenario.end();
}

#[test, expected_failure(abort_code = mandate::ENotDelegate, location = mandate)]
fun an_agent_owner_who_is_not_the_delegate_cannot_spend_the_mandate() {
    // Owning a client identity is not enough — the Mandate only answers to the
    // address it delegates to.
    let mut scenario = test_scenario::begin(HUMAN);
    let (client_agent, specialist_agent, mut m) = setup(&mut scenario);
    let c = clock_at(&mut scenario, NOW_MS);

    scenario.next_tx(STRANGER);
    let stranger_agent = register_agent(&mut scenario, b"stranger-envoy");

    scenario.next_tx(STRANGER);
    let specialist_id = object::id(&specialist_agent);
    let d = lock_escrow(
        &mut scenario, &mut m, &stranger_agent, specialist_id, PRICE, option::none(), &c,
    );

    destroy(d);
    destroy(stranger_agent);
    destroy(m);
    destroy(c);
    destroy(client_agent);
    destroy(specialist_agent);
    scenario.end();
}

#[test, expected_failure(abort_code = deal::ENotSpecialist, location = deal)]
fun a_non_specialist_cannot_mark_delivered() {
    let mut scenario = test_scenario::begin(HUMAN);
    let (client_agent, specialist_agent, mut m) = setup(&mut scenario);
    let c = clock_at(&mut scenario, NOW_MS);

    let specialist_id = object::id(&specialist_agent);
    let mut d = lock_escrow(
        &mut scenario, &mut m, &client_agent, specialist_id, PRICE, option::none(), &c,
    );

    scenario.next_tx(SPECIALIST);
    let dl = d.stage_deadline_ms();
    d.accept(&specialist_agent, option::none(), dl, PRICE, &c, scenario.ctx());

    scenario.next_tx(CLIENT);
    let p = proof::new_simulated(
        object::id(&d),
        b"walrus/testnet".to_string(),
        b"blob-abc".to_string(),
        b"attestation-1".to_string(),
        b"nautilus.mock".to_string(),
        vector[],
        &c,
        scenario.ctx(),
    );
    d.mark_delivered(&client_agent, &p, &c, scenario.ctx());

    proof::share_proof(p);
    destroy(d);
    destroy(m);
    destroy(c);
    destroy(client_agent);
    destroy(specialist_agent);
    scenario.end();
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------
//
// Person 2 reads a new Deal's ID from `DealCreated` because `create_and_share`
// returns nothing, and Person 4's receipt reads `amount` and `category` from
// it because neither is readable from a settled Deal. Nothing asserted any of
// that until now.

#[test]
fun deal_created_carries_the_amount_and_category_person_four_needs() {
    let mut scenario = test_scenario::begin(HUMAN);
    let (client_agent, specialist_agent, mut m) = setup(&mut scenario);
    let c = clock_at(&mut scenario, NOW_MS);

    let specialist_id = object::id(&specialist_agent);
    let d = lock_escrow(
        &mut scenario, &mut m, &client_agent, specialist_id, PRICE, option::none(), &c,
    );

    let events = event::events_by_type<deal::DealCreated>();
    assert_eq!(events.length(), 1);
    let e = &events[0];
    assert_eq!(deal::created_amount(e), PRICE);
    assert_eq!(deal::created_category(e), category());
    assert_eq!(deal::created_deal_id(e), object::id(&d));

    destroy(d);
    destroy(m);
    destroy(c);
    destroy(client_agent);
    destroy(specialist_agent);
    scenario.end();
}

#[test]
fun deal_released_names_the_address_that_was_actually_paid() {
    // The event used to assert the specialist was paid while the client could
    // route the coin anywhere. Now the module pins the payee, so the event is
    // a fact — this test is what keeps it one.
    let mut scenario = test_scenario::begin(HUMAN);
    let (client_agent, specialist_agent, mut m) = setup(&mut scenario);
    let c = clock_at(&mut scenario, NOW_MS);

    let specialist_id = object::id(&specialist_agent);
    let mut d = lock_escrow(
        &mut scenario, &mut m, &client_agent, specialist_id, PRICE, option::none(), &c,
    );

    scenario.next_tx(SPECIALIST);
    let dl = d.stage_deadline_ms();
    d.accept(&specialist_agent, option::none(), dl, PRICE, &c, scenario.ctx());
    deliver(&mut scenario, &mut d, &specialist_agent, &c);

    scenario.next_tx(CLIENT);
    let mut client_rep = take_rep(&scenario, &client_agent);
    let mut specialist_rep = take_rep(&scenario, &specialist_agent);
    let registry = scenario.take_shared<AgentRegistry>();
    d.verify_and_release(&registry, &client_agent, &mut client_rep, &mut specialist_rep, scenario.ctx());
    test_scenario::return_shared(registry);

    let events = event::events_by_type<deal::DealReleased>();
    assert_eq!(events.length(), 1);
    let e = &events[0];
    assert_eq!(deal::released_paid_to(e), SPECIALIST);
    assert_eq!(deal::released_amount(e), PRICE);
    assert!(!deal::released_by_timeout(e));

    test_scenario::return_shared(client_rep);
    test_scenario::return_shared(specialist_rep);
    destroy(d);
    destroy(m);
    destroy(c);
    destroy(client_agent);
    destroy(specialist_agent);
    scenario.end();
}

#[test]
fun a_timeout_release_is_marked_as_one() {
    let mut scenario = test_scenario::begin(HUMAN);
    let (client_agent, specialist_agent, mut m) = setup(&mut scenario);
    let c = clock_at(&mut scenario, NOW_MS);

    let specialist_id = object::id(&specialist_agent);
    let mut d = lock_escrow(
        &mut scenario, &mut m, &client_agent, specialist_id, PRICE, option::none(), &c,
    );

    scenario.next_tx(SPECIALIST);
    let dl = d.stage_deadline_ms();
    d.accept(&specialist_agent, option::none(), dl, PRICE, &c, scenario.ctx());
    deliver(&mut scenario, &mut d, &specialist_agent, &c);

    let later = clock_at(&mut scenario, d.stage_deadline_ms() + 1);
    scenario.next_tx(STRANGER);
    let mut specialist_rep = take_rep(&scenario, &specialist_agent);
    let registry = scenario.take_shared<AgentRegistry>();
    d.claim_release(&registry, &mut specialist_rep, &later, scenario.ctx());
    test_scenario::return_shared(registry);

    let events = event::events_by_type<deal::DealReleased>();
    let e = &events[events.length() - 1];
    assert!(deal::released_by_timeout(e));
    assert_eq!(deal::released_paid_to(e), SPECIALIST);

    test_scenario::return_shared(specialist_rep);
    destroy(d);
    destroy(m);
    destroy(c);
    destroy(later);
    destroy(client_agent);
    destroy(specialist_agent);
    scenario.end();
}

#[test]
fun a_default_settlement_records_no_resolver() {
    // `resolved_by == none` is how an indexer tells a timeout split apart from
    // an arbiter's decision.
    let mut scenario = test_scenario::begin(HUMAN);
    let (client_agent, specialist_agent, mut m) = setup(&mut scenario);
    let c = clock_at(&mut scenario, NOW_MS);

    let specialist_id = object::id(&specialist_agent);
    let mut d = lock_escrow(
        &mut scenario, &mut m, &client_agent, specialist_id, PRICE, option::some(ARBITER), &c,
    );

    scenario.next_tx(SPECIALIST);
    let dl = d.stage_deadline_ms();
    d.accept(&specialist_agent, option::some(ARBITER), dl, PRICE, &c, scenario.ctx());
    deliver(&mut scenario, &mut d, &specialist_agent, &c);

    scenario.next_tx(CLIENT);
    d.raise_dispute(&client_agent, &c, scenario.ctx());

    let later = clock_at(&mut scenario, d.stage_deadline_ms() + 1);
    scenario.next_tx(STRANGER);
    let mut client_rep = take_rep(&scenario, &client_agent);
    let mut specialist_rep = take_rep(&scenario, &specialist_agent);
    let registry = scenario.take_shared<AgentRegistry>();
    d.settle_default(&registry, &mut m, &mut client_rep, &mut specialist_rep, &later, scenario.ctx());
    test_scenario::return_shared(registry);

    let events = event::events_by_type<deal::DealSettled>();
    assert_eq!(events.length(), 1);
    let e = &events[0];
    assert_eq!(deal::settled_client_amount(e), 75);
    assert_eq!(deal::settled_specialist_amount(e), 75);
    assert!(deal::settled_resolved_by(e).is_none());

    test_scenario::return_shared(client_rep);
    test_scenario::return_shared(specialist_rep);
    destroy(d);
    destroy(m);
    destroy(c);
    destroy(later);
    destroy(client_agent);
    destroy(specialist_agent);
    scenario.end();
}

#[test]
fun a_failed_deal_creation_emits_nothing() {
    // Proves the mandate check really does abort before any funds move, which
    // the module's comment claims and nothing verified.
    let mut scenario = test_scenario::begin(HUMAN);
    let (client_agent, specialist_agent, m) = setup(&mut scenario);
    let c = clock_at(&mut scenario, NOW_MS);

    scenario.next_tx(CLIENT);
    let effects = scenario.next_tx(CLIENT);
    assert_eq!(effects.num_user_events(), 0);

    destroy(m);
    destroy(c);
    destroy(client_agent);
    destroy(specialist_agent);
    scenario.end();
}
