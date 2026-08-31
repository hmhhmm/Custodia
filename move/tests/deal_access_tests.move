// Owner: Person 3's module, tests written by Person 1 alongside the
// implementation. Verifies the Seal allowlist policy: only the two parties,
// only for ids carrying the allowlist's own object-id prefix.
#[test_only]
module custodia::deal_access_tests;

use std::unit_test::{assert_eq, destroy};
use sui::test_scenario;
use custodia::deal_access;

const CLIENT_OWNER: address = @0xA;
const SPECIALIST_OWNER: address = @0xB;
const STRANGER: address = @0xC;

/// A dummy deal id — the policy stores it but keys off its OWN object id.
fun dummy_deal_id(ctx: &mut TxContext): ID {
    let id = object::new(ctx);
    let inner = id.to_inner();
    id.delete();
    inner
}

/// An id the key server would ask about: the allowlist's id prefix + a nonce.
fun prefixed_id(allowlist: &deal_access::DealAllowlist, nonce: vector<u8>): vector<u8> {
    let mut id = allowlist.id_bytes();
    id.append(nonce);
    id
}

#[test]
fun a_party_with_a_correctly_prefixed_id_is_approved() {
    let mut scenario = test_scenario::begin(CLIENT_OWNER);
    let allowlist = deal_access::new_for_testing(
        dummy_deal_id(scenario.ctx()),
        vector[CLIENT_OWNER, SPECIALIST_OWNER],
        scenario.ctx(),
    );

    let id = prefixed_id(&allowlist, b"nonce-1");
    assert!(deal_access::check_policy_for_testing(CLIENT_OWNER, id, &allowlist));
    assert!(deal_access::check_policy_for_testing(SPECIALIST_OWNER, id, &allowlist));

    deal_access::destroy_for_testing(allowlist);
    scenario.end();
}

#[test]
fun a_stranger_is_denied_even_with_the_right_prefix() {
    let mut scenario = test_scenario::begin(CLIENT_OWNER);
    let allowlist = deal_access::new_for_testing(
        dummy_deal_id(scenario.ctx()),
        vector[CLIENT_OWNER, SPECIALIST_OWNER],
        scenario.ctx(),
    );

    let id = prefixed_id(&allowlist, b"nonce-1");
    assert!(!deal_access::check_policy_for_testing(STRANGER, id, &allowlist));

    deal_access::destroy_for_testing(allowlist);
    scenario.end();
}

#[test]
fun a_party_is_denied_an_id_without_the_policy_prefix() {
    // Stops a whitelisted user fetching keys for content encrypted under a
    // different policy.
    let mut scenario = test_scenario::begin(CLIENT_OWNER);
    let allowlist = deal_access::new_for_testing(
        dummy_deal_id(scenario.ctx()),
        vector[CLIENT_OWNER, SPECIALIST_OWNER],
        scenario.ctx(),
    );

    // An id that does not start with the allowlist's object id.
    let id = b"some-unrelated-key-id-bytes";
    assert!(!deal_access::check_policy_for_testing(CLIENT_OWNER, id, &allowlist));

    deal_access::destroy_for_testing(allowlist);
    scenario.end();
}

#[test]
fun a_shorter_id_than_the_prefix_is_denied() {
    let mut scenario = test_scenario::begin(CLIENT_OWNER);
    let allowlist = deal_access::new_for_testing(
        dummy_deal_id(scenario.ctx()),
        vector[CLIENT_OWNER, SPECIALIST_OWNER],
        scenario.ctx(),
    );

    // Empty id is shorter than the 32-byte prefix.
    assert!(!deal_access::check_policy_for_testing(CLIENT_OWNER, vector[], &allowlist));

    deal_access::destroy_for_testing(allowlist);
    scenario.end();
}

#[test, expected_failure(abort_code = deal_access::ENoAccess, location = deal_access)]
fun seal_approve_aborts_for_a_stranger() {
    let mut scenario = test_scenario::begin(STRANGER);
    let allowlist = deal_access::new_for_testing(
        dummy_deal_id(scenario.ctx()),
        vector[CLIENT_OWNER, SPECIALIST_OWNER],
        scenario.ctx(),
    );

    let id = prefixed_id(&allowlist, b"nonce-1");
    deal_access::seal_approve_for_testing(id, &allowlist, scenario.ctx());

    deal_access::destroy_for_testing(allowlist);
    scenario.end();
}

#[test]
fun the_allowlist_records_the_deal_and_both_parties() {
    let mut scenario = test_scenario::begin(CLIENT_OWNER);
    let deal_id = dummy_deal_id(scenario.ctx());
    let allowlist = deal_access::new_for_testing(
        deal_id,
        vector[CLIENT_OWNER, SPECIALIST_OWNER],
        scenario.ctx(),
    );

    assert_eq!(allowlist.deal_id(), deal_id);
    let addrs = allowlist.addresses();
    assert!(addrs.contains(&CLIENT_OWNER));
    assert!(addrs.contains(&SPECIALIST_OWNER));
    assert_eq!(addrs.length(), 2);

    deal_access::destroy_for_testing(allowlist);
    scenario.end();
}
