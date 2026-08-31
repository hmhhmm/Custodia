// Owner: Person 1 (Move/contracts).
//
// The registry is what Person 4's `discoverAgents()` reads
// (frontend/src/agent/discovery.ts), so these tests pin the shape that
// discovery depends on: every registered agent appears in the shared registry
// with its capabilities and a pointer to its Reputation.
#[test_only]
module custodia::agent_identity_tests;

use std::string::String;
use std::unit_test::{assert_eq, destroy};
use sui::test_scenario::{Self, Scenario};
use custodia::agent_identity::{Self, AgentIdentity, AgentRegistry};
use custodia::reputation::{Self, Reputation};

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

#[test]
fun is_registered_finds_only_real_agents() {
    // `deal::create_and_lock_escrow` relies on this to reject a specialist ID
    // that names no real agent, which would otherwise strand the escrow.
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

    assert!(registry.is_registered(object::id(&identity)));

    // An ID that belongs to no agent at all.
    let bogus = object::id(&rep);
    assert!(!registry.is_registered(bogus));

    destroy(identity);
    destroy(rep);
    test_scenario::return_shared(registry);
    scenario.end();
}

#[test, expected_failure(abort_code = agent_identity::ENameTaken, location = agent_identity)]
fun a_suins_name_cannot_be_registered_twice() {
    // Without this, an impostor registers the exact name of a known agent and
    // is indistinguishable from them in Person 4's discovery list.
    let mut scenario = test_scenario::begin(LAWYER);
    agent_identity::init_for_testing(scenario.ctx());

    scenario.next_tx(LAWYER);
    register(&mut scenario, b"legal-review", legal_caps());

    scenario.next_tx(STRANGER);
    register(&mut scenario, b"legal-review", legal_caps());

    scenario.end();
}

#[test]
fun transferring_ownership_updates_the_identity_and_the_registry() {
    // Moving the identity with a bare `public_transfer` would leave `owner`
    // stale, and the identity would be permanently unusable by anyone.
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
    let agent_id = object::id(&identity);

    identity.transfer_ownership(&mut registry, COURIER, scenario.ctx());

    // The registry summary must move in lockstep, or discovery shows the wrong
    // controller for the agent.
    let agents = registry.agents();
    assert_eq!(agents[0].summary_agent_id(), agent_id);
    assert_eq!(agents[0].summary_owner(), COURIER);

    scenario.next_tx(COURIER);
    let moved = scenario.take_from_sender<AgentIdentity>();
    assert_eq!(moved.owner(), COURIER);

    scenario.return_to_sender(moved);
    destroy(rep);
    test_scenario::return_shared(registry);
    scenario.end();
}

#[test, expected_failure(abort_code = agent_identity::ENotOwner, location = agent_identity)]
fun non_owner_cannot_transfer_ownership() {
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

    scenario.next_tx(STRANGER);
    identity.transfer_ownership(&mut registry, STRANGER, scenario.ctx());

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

#[test]
fun the_registry_accepts_exactly_its_capacity() {
    let mut scenario = test_scenario::begin(LAWYER);
    agent_identity::init_for_testing(scenario.ctx());

    scenario.next_tx(LAWYER);
    let mut registry = scenario.take_shared<AgentRegistry>();
    agent_identity::fill_registry_for_testing(&mut registry, 256, scenario.ctx());

    assert_eq!(registry.agent_count(), 256);

    test_scenario::return_shared(registry);
    scenario.end();
}

#[test, expected_failure(abort_code = agent_identity::ERegistryFull, location = agent_identity)]
fun registering_past_the_cap_aborts() {
    // The cap converts an irreversible brick — a registry pushed past the
    // object-size ceiling, after which EVERY touching transaction aborts
    // forever — into a clean, legible failure.
    let mut scenario = test_scenario::begin(LAWYER);
    agent_identity::init_for_testing(scenario.ctx());

    scenario.next_tx(LAWYER);
    let mut registry = scenario.take_shared<AgentRegistry>();
    agent_identity::fill_registry_for_testing(&mut registry, 256, scenario.ctx());
    test_scenario::return_shared(registry);

    scenario.next_tx(LAWYER);
    register(&mut scenario, b"one-too-many", legal_caps());

    scenario.end();
}

#[test, expected_failure(abort_code = agent_identity::ETooManyCapabilities, location = agent_identity)]
fun an_oversized_capability_list_is_rejected() {
    // Bounding entry COUNT alone bounds the wrong dimension: unbounded strings
    // could push the shared registry past the object-size ceiling at far fewer
    // than 256 agents.
    let mut scenario = test_scenario::begin(LAWYER);
    agent_identity::init_for_testing(scenario.ctx());

    scenario.next_tx(LAWYER);
    let mut caps = vector[];
    17u64.do!(|_| caps.push_back(b"cap".to_string()));
    register(&mut scenario, b"greedy", caps);

    scenario.end();
}

#[test]
fun a_new_agent_is_never_marked_name_verified() {
    // `suins_name` is self-asserted. Person 4's discovery must render an
    // unverified badge until a real SuiNS ownership proof exists.
    let mut scenario = test_scenario::begin(LAWYER);
    agent_identity::init_for_testing(scenario.ctx());

    scenario.next_tx(LAWYER);
    register(&mut scenario, b"legal-review", legal_caps());

    scenario.next_tx(LAWYER);
    let registry = scenario.take_shared<AgentRegistry>();
    let agents = registry.agents();
    assert!(!agents[0].summary_name_verified());

    test_scenario::return_shared(registry);
    scenario.end();
}
