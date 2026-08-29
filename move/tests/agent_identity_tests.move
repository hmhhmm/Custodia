// Owner: Person 1 (Move/contracts).
//
// The registry is what Person 4's `discoverAgents()` reads
// (frontend/src/agent/discovery.ts), so these tests pin the shape that
// discovery depends on: every registered agent appears in the shared registry
// with its capabilities and a pointer to its Reputation.
#[test_only]
module escrow::agent_identity_tests;

use std::string::String;
use std::unit_test::{assert_eq, destroy};
use sui::test_scenario::{Self, Scenario};
use escrow::agent_identity::{Self, AgentRegistry};
use escrow::reputation::{Self, Reputation};

const LAWYER: address = @0xA;
const COURIER: address = @0xB;
const STRANGER: address = @0xC;

fun legal_caps(): vector<String> {
    vector[b"legal-review".to_string(), b"malaysia".to_string()]
}

fun courier_caps(): vector<String> {
    vector[b"courier".to_string()]
}

fun register(scenario: &mut Scenario, name: vector<u8>, caps: vector<String>) {
    let mut registry = scenario.take_shared<AgentRegistry>();
    let (identity, rep) = agent_identity::register(
        &mut registry,
        name.to_string(),
        caps,
        scenario.ctx(),
    );
    transfer::public_transfer(identity, scenario.ctx().sender());
    rep.share();
    test_scenario::return_shared(registry);
}

#[test]
fun init_creates_an_empty_shared_registry() {
    let mut scenario = test_scenario::begin(LAWYER);
    agent_identity::init_for_testing(scenario.ctx());

    scenario.next_tx(LAWYER);
    let registry = scenario.take_shared<AgentRegistry>();
    assert_eq!(registry.agent_count(), 0);

    test_scenario::return_shared(registry);
    scenario.end();
}

#[test]
fun registering_links_identity_and_reputation_both_ways() {
    let mut scenario = test_scenario::begin(LAWYER);
    agent_identity::init_for_testing(scenario.ctx());

    scenario.next_tx(LAWYER);
    let mut registry = scenario.take_shared<AgentRegistry>();
    let (identity, rep) = agent_identity::register(
        &mut registry,
        b"legal-review".to_string(),
        legal_caps(),
        scenario.ctx(),
    );

    // The two objects point at each other — this is the cycle `register`
    // exists to resolve, so assert both directions.
    assert_eq!(identity.reputation_id(), object::id(&rep));
    assert_eq!(rep.agent_id(), object::id(&identity));

    assert_eq!(identity.owner(), LAWYER);
    assert_eq!(identity.suins_name(), b"legal-review".to_string());
    assert_eq!(rep.score(), 50);

    destroy(identity);
    destroy(rep);
    test_scenario::return_shared(registry);
    scenario.end();
}

#[test]
fun registry_indexes_every_agent_for_discovery() {
    let mut scenario = test_scenario::begin(LAWYER);
    agent_identity::init_for_testing(scenario.ctx());

    scenario.next_tx(LAWYER);
    register(&mut scenario, b"legal-review", legal_caps());

    scenario.next_tx(COURIER);
    register(&mut scenario, b"courier-kl", courier_caps());

    scenario.next_tx(LAWYER);
    let registry = scenario.take_shared<AgentRegistry>();
    let agents = registry.agents();

    assert_eq!(agents.length(), 2);

    // Person 4 filters this list by capability, then ranks by Reputation score.
    let first = &agents[0];
    assert_eq!(first.summary_suins_name(), b"legal-review".to_string());
    assert_eq!(first.summary_owner(), LAWYER);
    assert!(first.summary_capabilities().contains(&b"malaysia".to_string()));

    let second = &agents[1];
    assert_eq!(second.summary_suins_name(), b"courier-kl".to_string());
    assert!(second.summary_capabilities().contains(&b"courier".to_string()));

    test_scenario::return_shared(registry);
    scenario.end();
}

#[test]
fun updating_capabilities_updates_the_registry_too() {
    let mut scenario = test_scenario::begin(LAWYER);
    agent_identity::init_for_testing(scenario.ctx());

    scenario.next_tx(LAWYER);
    let mut registry = scenario.take_shared<AgentRegistry>();
    let (mut identity, rep) = agent_identity::register(
        &mut registry,
        b"legal-review".to_string(),
        legal_caps(),
        scenario.ctx(),
    );

    let updated = vector[b"legal-review".to_string(), b"singapore".to_string()];
    identity.update_capabilities(&mut registry, updated, scenario.ctx());

    // Discovery must never read a stale capability list, so the registry copy
    // has to move in lockstep with the identity.
    assert!(identity.capabilities().contains(&b"singapore".to_string()));
    let agents = registry.agents();
    assert!(agents[0].summary_capabilities().contains(&b"singapore".to_string()));
    assert!(!agents[0].summary_capabilities().contains(&b"malaysia".to_string()));

    destroy(identity);
    destroy(rep);
    test_scenario::return_shared(registry);
    scenario.end();
}

#[test, expected_failure(abort_code = agent_identity::ENotOwner, location = agent_identity)]
fun non_owner_cannot_update_capabilities() {
    let mut scenario = test_scenario::begin(LAWYER);
    agent_identity::init_for_testing(scenario.ctx());

    scenario.next_tx(LAWYER);
    let mut registry = scenario.take_shared<AgentRegistry>();
    let (mut identity, rep) = agent_identity::register(
        &mut registry,
        b"legal-review".to_string(),
        legal_caps(),
        scenario.ctx(),
    );

    scenario.next_tx(STRANGER);
    identity.update_capabilities(&mut registry, courier_caps(), scenario.ctx());

    destroy(identity);
    destroy(rep);
    test_scenario::return_shared(registry);
    scenario.end();
}
