// Reads the live on-chain AgentRegistry via Sui GraphQL. discoverAgents()
// returns an empty array when the registry has no matching agents — that
// is a genuine result, not a broken query; call
// `agent_identity::register_and_keep` (see Onboarding.tsx) to register one.

import { SuiGraphQLClient } from "@mysten/sui/graphql";
import { graphql } from "@mysten/sui/graphql/schema";
import { AGENT_REGISTRY_ID } from "../sui/config";

const GRAPHQL_URL = "https://graphql.testnet.sui.io/graphql";

const client = new SuiGraphQLClient({ url: GRAPHQL_URL, network: "testnet" });

const GetRegistryQuery = graphql(`
  query GetAgentRegistry($registryId: SuiAddress!) {
    object(address: $registryId) {
      asMoveObject {
        contents {
          json
        }
      }
    }
  }
`);

const MultiGetReputationsQuery = graphql(`
  query MultiGetReputations($keys: [ObjectKey!]!) {
    multiGetObjects(keys: $keys) {
      address
      asMoveObject {
        contents {
          json
        }
      }
    }
  }
`);

/** Mirrors custodia::agent_identity::AgentSummary — field names match the
 * Move struct exactly, since GraphQL's `contents.json` serializes struct
 * fields verbatim. */
interface AgentSummaryJson {
  agent_id: string;
  owner: string;
  suins_name: string;
  capabilities: string[];
  reputation_id: string;
  /** Always false today — see agent_identity.move's own comment on why
   * this must render an "unverified" badge, not be treated as a real
   * ownership proof. */
  name_verified: boolean;
}

export interface DiscoveredAgent {
  agentId: string;
  owner: string;
  reputationId: string;
  suinsName: string;
  nameVerified: boolean;
  capabilities: string[];
  reputationScore: number;
}

/**
 * Reads the live on-chain AgentRegistry and ranks candidates by
 * reputation score, optionally filtered by capability. Returns an empty
 * array (not an error, not fake data) if no agents are registered or
 * none match — see file header for why the registry is empty today.
 */
export async function discoverAgents(params: {
  capability?: string;
  minReputationScore?: number;
}): Promise<DiscoveredAgent[]> {
  const registryResult = await client.query({
    query: GetRegistryQuery,
    variables: { registryId: AGENT_REGISTRY_ID },
  });

  if (registryResult.errors?.length) {
    throw new Error(`AgentRegistry query failed: ${JSON.stringify(registryResult.errors)}`);
  }

  const registryJson = registryResult.data?.object?.asMoveObject?.contents?.json as
    | { agents: AgentSummaryJson[] }
    | undefined;

  const agents = registryJson?.agents ?? [];
  if (agents.length === 0) {
    return [];
  }

  const filtered = params.capability
    ? agents.filter((a) => a.capabilities.includes(params.capability!))
    : agents;

  if (filtered.length === 0) {
    return [];
  }

  const reputationResult = await client.query({
    query: MultiGetReputationsQuery,
    variables: { keys: filtered.map((a) => ({ address: a.reputation_id })) },
  });

  if (reputationResult.errors?.length) {
    throw new Error(`Reputation batch query failed: ${JSON.stringify(reputationResult.errors)}`);
  }

  const scoreByObjectAddress = new Map<string, number>();
  for (const obj of reputationResult.data?.multiGetObjects ?? []) {
    const json = obj?.asMoveObject?.contents?.json as { score?: number } | undefined;
    if (obj?.address && typeof json?.score === "number") {
      scoreByObjectAddress.set(obj.address, json.score);
    }
  }

  const candidates: DiscoveredAgent[] = filtered.map((a) => ({
    agentId: a.agent_id,
    owner: a.owner,
    reputationId: a.reputation_id,
    suinsName: a.suins_name,
    nameVerified: a.name_verified,
    capabilities: a.capabilities,
    reputationScore: scoreByObjectAddress.get(a.reputation_id) ?? 0,
  }));

  const aboveThreshold =
    params.minReputationScore !== undefined
      ? candidates.filter((c) => c.reputationScore >= params.minReputationScore!)
      : candidates;

  return aboveThreshold.sort((a, b) => b.reputationScore - a.reputationScore);
}
