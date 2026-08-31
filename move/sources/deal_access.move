// Owner: Person 3 (verification/storage) — added to Person 1's /move/
// package rather than a separate Move package, since it must be published
// alongside `custodia::deal` for the package ID used in Seal's
// `seal_approve` moveCall target to be meaningful. Coordinate with
// Person 1 before renaming/moving this module.
//
// Seal access-control policy for a Deal's encrypted content: an allowlist of
// exactly the two parties' owner addresses, modeled on the Seal "whitelist"
// reference pattern
// (https://github.com/MystenLabs/seal/blob/main/move/patterns/sources/whitelist.move).
// The simplest viable policy — do not add a more complex access model without
// flagging it, per /docs/ARCHITECTURE.md's scope rules.
//
// IMPLEMENTED 2026-08-31 by Person 1 at Person 3's/the team's explicit
// request (rule 4 boundary crossed with authorization, not silently). The
// Seal convention below was VERIFIED against the whitelist.move source this
// session, per /CLAUDE.md rule 1 — not assumed:
//   - `entry fun seal_approve(id: vector<u8>, <policy>, ctx)` aborts (does not
//     return) when access is denied; the key server evaluates it via
//     dry_run_transaction_block.
//   - key-id format is `[pkg id][policy object id][nonce]`, so `check_policy`
//     asserts `id` is prefixed by this object's own id bytes.
//   - membership is a plain containment check.
//
// DESIGN GAP still owned by Person 3, unchanged by this implementation: a
// DealAllowlist is keyed to a Deal, which does not exist until PTB #1 (step 6),
// while negotiation content is encrypted at step 4. So this policy fits the
// DELIVERABLE (step 8, after the Deal exists), not step-4 negotiation. A
// pre-Deal `NegotiationSession` object would be needed for step 4 — flagged,
// not built.
module custodia::deal_access;

use custodia::agent_identity::AgentRegistry;
use custodia::deal::{Self, Deal};

/// Aborts from `seal_approve` when the caller is not on the allowlist or the
/// id is not covered by this policy. Numeric to match the Seal reference
/// pattern's convention (its key server does not read #[error] messages).
const ENoAccess: u64 = 1;

const EWrongVersion: u64 = 5;

const VERSION: u64 = 1;

/// An allowlist scoped to one Deal, holding exactly the two parties' owner
/// addresses. A separate shared object rather than a field on Deal, so
/// access-control changes never touch the hot Deal object.
public struct DealAllowlist has key {
    id: UID,
    version: u64,
    deal_id: ID,
    /// Exactly the client owner and specialist owner. A vector, not a Table:
    /// it always holds two entries, so containment is trivial and there is no
    /// per-entry storage object to manage.
    addresses: vector<address>,
}

/// Derives the allowlist from the Deal itself via `deal::party_owners`, so the
/// two addresses cannot drift out of sync with the Deal after an ownership
/// transfer. This is why it takes the `&Deal` and `&AgentRegistry` rather than
/// two loose addresses the caller could get wrong.
///
/// Returns the object; consume it with `share_allowlist` (it is `key`-only, so
/// a PTB cannot dispose of it any other way).
public fun new_for_deal(
    deal: &Deal,
    registry: &AgentRegistry,
    ctx: &mut TxContext,
): DealAllowlist {
    let (client_owner, specialist_owner) = deal.party_owners(registry);
    DealAllowlist {
        id: object::new(ctx),
        version: VERSION,
        deal_id: object::id(deal),
        addresses: vector[client_owner, specialist_owner],
    }
}

public fun share_allowlist(allowlist: DealAllowlist) {
    transfer::share_object(allowlist);
}

entry fun new_and_share(deal: &Deal, registry: &AgentRegistry, ctx: &mut TxContext) {
    share_allowlist(new_for_deal(deal, registry, ctx));
}

/// The Seal access check. `id` is the key-id the key server was asked about;
/// it must be prefixed by this allowlist's object id, and `caller` must be one
/// of the two parties. Byte-for-byte port of the verified whitelist pattern.
fun check_policy(caller: address, id: vector<u8>, allowlist: &DealAllowlist): bool {
    assert!(allowlist.version == VERSION, EWrongVersion);

    // id must carry this policy object's id as its prefix.
    let prefix = allowlist.id.to_bytes();
    if (prefix.length() > id.length()) {
        return false
    };
    let mut i = 0;
    while (i < prefix.length()) {
        if (prefix[i] != id[i]) {
            return false
        };
        i = i + 1;
    };

    allowlist.addresses.contains(&caller)
}

/// Non-public `entry` per the Seal convention: the key server calls it through
/// `dry_run_transaction_block` and only cares whether it aborts. It must NOT
/// return a bool. First parameter must be named `id`.
entry fun seal_approve(id: vector<u8>, allowlist: &DealAllowlist, ctx: &TxContext) {
    assert!(check_policy(ctx.sender(), id, allowlist), ENoAccess);
}

public fun deal_id(allowlist: &DealAllowlist): ID {
    allowlist.deal_id
}

public fun addresses(allowlist: &DealAllowlist): vector<address> {
    allowlist.addresses
}

#[test_only]
public fun check_policy_for_testing(
    caller: address,
    id: vector<u8>,
    allowlist: &DealAllowlist,
): bool {
    check_policy(caller, id, allowlist)
}

#[test_only]
/// Builds an allowlist from raw addresses, so the Seal policy can be tested
/// without standing up a full Deal + registry + mandate.
public fun new_for_testing(
    deal_id: ID,
    addresses: vector<address>,
    ctx: &mut TxContext,
): DealAllowlist {
    DealAllowlist { id: object::new(ctx), version: VERSION, deal_id, addresses }
}

#[test_only]
public fun id_bytes(allowlist: &DealAllowlist): vector<u8> {
    allowlist.id.to_bytes()
}

#[test_only]
public fun seal_approve_for_testing(
    id: vector<u8>,
    allowlist: &DealAllowlist,
    ctx: &TxContext,
) {
    seal_approve(id, allowlist, ctx)
}

#[test_only]
public fun destroy_for_testing(allowlist: DealAllowlist) {
    let DealAllowlist { id, version: _, deal_id: _, addresses: _ } = allowlist;
    object::delete(id);
}
