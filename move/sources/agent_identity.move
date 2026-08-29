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
use sui::event;
use escrow::reputation::{Self, Reputation};

#[error]
const ENotOwner: vector<u8> = b"Only the agent owner can perform this action";

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
/// stays composable in a PTB. Use `register_and_keep` for the convenience path.
public fun register(
    registry: &mut AgentRegistry,
    suins_name: String,
    capabilities: vector<String>,
    ctx: &mut TxContext,
): (AgentIdentity, Reputation) {
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

/// Owner-only. Updates the identity and its registry summary together, so
/// discovery never reads a stale capability list.
public fun update_capabilities(
    identity: &mut AgentIdentity,
    registry: &mut AgentRegistry,
    capabilities: vector<String>,
    ctx: &TxContext,
) {
    assert!(ctx.sender() == identity.owner, ENotOwner);

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
