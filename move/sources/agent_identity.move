// Owner: Person 1 (Move/contracts).
//
// AgentIdentity represents an on-chain identity for an AI agent participating
// in Escrow. See /docs/ARCHITECTURE.md for the full object model and how this
// ties into Reputation.
//
// AgentIdentity itself is `key, store` and owned by the agent's controller.
// AgentRegistry is a shared object that indexes every registered agent so
// Person 4's `discoverAgents()` (frontend/src/agent/discovery.ts) can find
// candidates by capability and reputation in a single object read.
module escrow::agent_identity;

use std::string::String;
use sui::address;
use sui::event;
use escrow::reputation::{Self, Reputation};

#[error]
const ENotOwner: vector<u8> = b"Only the agent owner can perform this action";

#[error]
const ENameTaken: vector<u8> = b"An agent is already registered under this SuiNS name";

#[error]
const ERegistryFull: vector<u8> = b"Agent registry is at capacity";

#[error]
const ENameTooLong: vector<u8> = b"SuiNS name exceeds the permitted length";

#[error]
const ETooManyCapabilities: vector<u8> = b"Too many capabilities, or a capability is too long";

/// Hard cap on registered agents. `agents` is an unbounded vector inside a
/// shared object, and Sui caps objects at 256 KB. Without a cap, registration
/// is permissionless and there is no removal function, so a spammer could push
/// the registry past the object limit — at which point EVERY transaction
/// touching it aborts, `register_and_keep` and `update_capabilities` alike,
/// permanently and with no way to shrink it back.
///
/// The cap converts that from an irreversible brick into a clean, legible
/// abort. It does not fix the underlying design; the roadmap answer is still to
/// consume `AgentRegistered` events off-chain and drop the vector entirely.
const MAX_REGISTRY_AGENTS: u64 = 256;

/// Byte caps on everything a caller writes into the shared registry.
///
/// The agent cap alone bounds the wrong dimension. `AgentSummary` carries an
/// unbounded `String` and an unbounded `vector<String>`, and
/// `update_capabilities` lets an already-registered agent grow its entry after
/// the fact with no limit at all — so the registry could be pushed past the
/// object-size ceiling at far fewer than 256 agents, permanently killing
/// onboarding. Bounding bytes is what actually holds the invariant; bounding
/// count only looked like it did.
const MAX_NAME_BYTES: u64 = 64;
const MAX_CAPABILITIES: u64 = 16;
const MAX_CAPABILITY_BYTES: u64 = 48;

public struct AgentIdentity has key, store {
    id: UID,
    owner: address,
    suins_name: String,
    capabilities: vector<String>,
    reputation_id: ID,
}

/// A flattened copy of an AgentIdentity, held in the registry so discovery can
/// read every agent's capabilities and reputation pointer without fetching
/// each AgentIdentity object individually.
public struct AgentSummary has store, copy, drop {
    agent_id: ID,
    owner: address,
    suins_name: String,
    capabilities: vector<String>,
    reputation_id: ID,
    /// Always `false` today, and deliberately so.
    ///
    /// `suins_name` is a first-come-unique, SELF-ASSERTED label. Nothing here
    /// proves the registrant controls that SuiNS name. Uniqueness blocks the
    /// cheapest impersonation — registering a known agent's exact name and
    /// being indistinguishable in discovery — but it is not ownership, and it
    /// cuts the other way too: first-come-first-served with no deregistration
    /// means a squatter holds a name irrecoverably.
    ///
    /// Person 4's discovery MUST render an "unverified" badge while this is
    /// false, so the UI never presents a self-asserted label as an identity
    /// claim. The field exists now because struct fields freeze at publish and
    /// adding it later would cost another breaking republish.
    ///
    /// VERIFY before writing any code that sets this true: no installed skill
    /// covers SuiNS, so the registration NFT's exact type, module path, and
    /// domain accessor are all unverified. Do not guess them.
    /// See https://docs.sui.io/standards/suins
    name_verified: bool,
}

/// Shared registry of all agents. Created and shared once, in `init`.
///
/// DEMO-SCALE DECISION, stated plainly: `agents` is a plain vector, and the
/// `sui-move-project` skill explicitly warns "avoid ever-growing vectors
/// inside objects" (objects cap at 256 KB). It is used anyway because it lets
/// Person 4 read every agent in one call with no indexer, and the demo has
/// 2-3 agents. This does NOT survive real scale — the roadmap answer is to
/// consume the `AgentRegistered` events below via an off-chain indexer and
/// drop the vector. Do not present this as a production registry.
public struct AgentRegistry has key {
    id: UID,
    agents: vector<AgentSummary>,
}

public struct AgentRegistered has copy, drop {
    agent_id: ID,
    owner: address,
    suins_name: String,
    capabilities: vector<String>,
    reputation_id: ID,
}

public struct CapabilitiesUpdated has copy, drop {
    agent_id: ID,
    capabilities: vector<String>,
}

fun init(ctx: &mut TxContext) {
    transfer::share_object(AgentRegistry {
        id: object::new(ctx),
        agents: vector[],
    });
}

/// Registers a new agent, creates its Reputation, and indexes it in the shared
/// registry.
///
/// The Reputation is created HERE rather than passed in because the two
/// objects reference each other: `Reputation.agent_id` needs the identity's ID
/// and `AgentIdentity.reputation_id` needs the reputation's. Minting the UID
/// first breaks that cycle — neither object can be built standalone.
///
/// Returns both objects rather than transferring or sharing them, so the pair
/// stays composable in a PTB. `AgentIdentity` has `store` so a PTB can
/// `transferObjects` it; the `Reputation` must be consumed by the now-public
/// `reputation::share`. Use `register_and_keep` for the convenience path.
///
/// `suins_name` is checked for uniqueness against the registry, but NOT for
/// SuiNS ownership — nothing here proves the registrant controls that name.
/// Uniqueness alone stops the cheapest impersonation (registering the exact
/// name of a known agent and being indistinguishable in discovery); proving
/// ownership needs a real SuiNS lookup, which is Person 2's surface.
public fun register(
    registry: &mut AgentRegistry,
    suins_name: String,
    capabilities: vector<String>,
    ctx: &mut TxContext,
): (AgentIdentity, Reputation) {
    assert!(registry.agents.length() < MAX_REGISTRY_AGENTS, ERegistryFull);
    assert!(!registry.is_name_taken(suins_name), ENameTaken);
    assert_name_within_limits(&suins_name);
    assert_capabilities_within_limits(&capabilities);

    let id = object::new(ctx);
    let agent_id = id.to_inner();

    let reputation = reputation::new(agent_id, ctx);
    let reputation_id = object::id(&reputation);

    let identity = AgentIdentity {
        id,
        owner: ctx.sender(),
        suins_name,
        capabilities,
        reputation_id,
    };

    registry.agents.push_back(AgentSummary {
        agent_id,
        owner: identity.owner,
        suins_name: identity.suins_name,
        capabilities: identity.capabilities,
        reputation_id,
        name_verified: false,
    });

    event::emit(AgentRegistered {
        agent_id,
        owner: identity.owner,
        suins_name: identity.suins_name,
        capabilities: identity.capabilities,
        reputation_id,
    });

    (identity, reputation)
}

/// Convenience path: registers the agent, keeps the identity with the sender,
/// and shares the Reputation so counterparties' PTBs can update it.
entry fun register_and_keep(
    registry: &mut AgentRegistry,
    suins_name: String,
    capabilities: vector<String>,
    ctx: &mut TxContext,
) {
    let (identity, reputation) = register(registry, suins_name, capabilities, ctx);
    transfer::transfer(identity, ctx.sender());
    reputation.share();
}

/// Owner-only. Hands the identity to `new_owner` and updates BOTH the `owner`
/// field and the registry summary in the same call.
///
/// `AgentIdentity` has `store`, so a holder can already move it with
/// `public_transfer`. Doing that without this function permanently soft-bricks
/// the identity: `owner` is written once at registration and never updated, so
/// afterwards the new holder fails every `identity.owner() == ctx.sender()`
/// check while the old owner no longer holds the object. Neither can act, and
/// any deal the agent is a party to strands.
///
/// Note the tradeoff this preserves rather than resolves: because `store` makes
/// the identity transferable and `Reputation` is bound to the identity object
/// rather than to an address, a track record can be sold along with the
/// identity. Removing `store` would make the identity soulbound and match the
/// reasoning behind `Reputation` withholding it — but abilities cannot be
/// changed after publish, so raise it with the team before the package ships.
public fun transfer_ownership(
    identity: AgentIdentity,
    registry: &mut AgentRegistry,
    new_owner: address,
    ctx: &TxContext,
) {
    assert!(ctx.sender() == identity.owner, ENotOwner);

    let agent_id = object::id(&identity);
    let mut identity = identity;
    identity.owner = new_owner;

    registry.agents.do_mut!(|summary| {
        if (summary.agent_id == agent_id) {
            summary.owner = new_owner;
        }
    });

    transfer::transfer(identity, new_owner);
}

/// Owner-only. Updates the identity and its registry summary together, so
/// discovery never reads a stale capability list.
public fun update_capabilities(
    identity: &mut AgentIdentity,
    registry: &mut AgentRegistry,
    capabilities: vector<String>,
    ctx: &TxContext,
) {
    assert!(ctx.sender() == identity.owner, ENotOwner);
    // Without this, an already-registered agent could grow its registry entry
    // without limit and brick the shared object even under the agent cap.
    assert_capabilities_within_limits(&capabilities);

    identity.capabilities = capabilities;
    let agent_id = object::id(identity);

    registry.agents.do_mut!(|summary| {
        if (summary.agent_id == agent_id) {
            summary.capabilities = capabilities;
        }
    });

    event::emit(CapabilitiesUpdated { agent_id, capabilities });
}

public fun owner(identity: &AgentIdentity): address {
    identity.owner
}

public fun suins_name(identity: &AgentIdentity): String {
    identity.suins_name
}

public fun capabilities(identity: &AgentIdentity): vector<String> {
    identity.capabilities
}

public fun reputation_id(identity: &AgentIdentity): ID {
    identity.reputation_id
}

/// Every registered agent. Person 4's discovery filters this client-side by
/// capability, then ranks by each agent's Reputation score.
public fun agents(registry: &AgentRegistry): vector<AgentSummary> {
    registry.agents
}

public fun agent_count(registry: &AgentRegistry): u64 {
    registry.agents.length()
}

/// True if `agent_id` belongs to an agent registered here.
///
/// `deal::create_and_lock_escrow` uses this to reject a specialist ID that
/// names no real agent. Without the check, a deal can be created against a
/// fabricated ID that nobody owns, which makes `mark_delivered` unreachable
/// forever and strands the escrow with no actor able to move it.
public fun is_registered(registry: &AgentRegistry, agent_id: ID): bool {
    registry.agents.any!(|summary| summary.agent_id == agent_id)
}

/// True if any registered agent already claims `suins_name`.
public fun is_name_taken(registry: &AgentRegistry, suins_name: String): bool {
    registry.agents.any!(|summary| summary.suins_name == suins_name)
}

/// The registry's summary for `agent_id`, or none.
///
/// Returns `Option` rather than aborting so callers keep their own, more
/// precise error codes. `escrow::deal` uses this for three things it cannot
/// otherwise know: the specialist's payout ADDRESS (the module must pin the
/// payee — a client-signed release that returns the coin lets the client route
/// it back to itself), the specialist's CANONICAL reputation id, and the
/// specialist's owner for the distinct-owner check.
public fun summary_of(registry: &AgentRegistry, agent_id: ID): Option<AgentSummary> {
    let mut found = option::none();
    registry.agents.do_ref!(|summary| {
        if (summary.agent_id == agent_id) {
            found = option::some(*summary);
        }
    });
    found
}

/// Current owner address of a registered agent, or none.
///
/// The registry summary is authoritative because `transfer_ownership` updates
/// the identity and the summary in the same call — which is what makes payouts
/// follow an identity to its new owner rather than paying a stale address.
public fun owner_of(registry: &AgentRegistry, agent_id: ID): Option<address> {
    let summary = registry.summary_of(agent_id);
    if (summary.is_some()) option::some(summary.destroy_some().owner)
    else option::none()
}

public fun summary_name_verified(summary: &AgentSummary): bool {
    summary.name_verified
}

fun assert_name_within_limits(suins_name: &String) {
    assert!(suins_name.length() <= MAX_NAME_BYTES, ENameTooLong);
}

fun assert_capabilities_within_limits(capabilities: &vector<String>) {
    assert!(capabilities.length() <= MAX_CAPABILITIES, ETooManyCapabilities);
    capabilities.do_ref!(|c| {
        assert!(c.length() <= MAX_CAPABILITY_BYTES, ETooManyCapabilities);
    });
}

public fun summary_agent_id(summary: &AgentSummary): ID {
    summary.agent_id
}

public fun summary_owner(summary: &AgentSummary): address {
    summary.owner
}

public fun summary_suins_name(summary: &AgentSummary): String {
    summary.suins_name
}

public fun summary_capabilities(summary: &AgentSummary): vector<String> {
    summary.capabilities
}

public fun summary_reputation_id(summary: &AgentSummary): ID {
    summary.reputation_id
}

#[test_only]
public fun init_for_testing(ctx: &mut TxContext) {
    init(ctx);
}

#[test_only]
/// Fills the registry with `n` synthetic agents. Names are derived from fresh
/// object addresses so they are unique without needing u64-to-String.
public fun fill_registry_for_testing(registry: &mut AgentRegistry, n: u64, ctx: &mut TxContext) {
    n.do!(|_| {
        let name = ctx.fresh_object_address().to_string();
        let (identity, reputation) = register(registry, name, vector[], ctx);
        transfer::transfer(identity, ctx.sender());
        reputation.share();
    });
}
