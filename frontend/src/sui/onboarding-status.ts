// Re-derives onboarding status (client AgentIdentity, specialist AgentIdentity,
// funded Mandate) from what's actually on-chain for the connected address —
// App.tsx's screen state is otherwise lost on every reload, which makes a
// wallet that has already completed onboarding look broken.

import { SuiGraphQLClient } from "@mysten/sui/graphql";
import { graphql } from "@mysten/sui/graphql/schema";
import { PACKAGE_ID } from "./config";
import type { RegisteredAgent } from "./ptb-register-agent";

const GRAPHQL_URL = "https://graphql.testnet.sui.io/graphql";

const client = new SuiGraphQLClient({ url: GRAPHQL_URL, network: "testnet" });

// VERIFY: whether Move's `UID` field (e.g. AgentIdentity.id, Mandate.id)
// serializes flatly as a string inside GraphQL's `contents.json`, or as a
// nested shape (e.g. { id: "0x..." }) — not confirmed against official
// GraphQL RPC docs this session. Sidestepped below by reading the object's
// own top-level `address` field instead of json.id, which is unambiguous
// regardless of how UID serializes.

// Note: MoveObjectConnection.nodes yields MoveObject directly — `contents`
// lives right on the node, there's no `asMoveObject` wrapper like the
// `object(address:)` single-entity query uses (see discovery.ts).
const GetOwnedAgentIdentitiesQuery = graphql(`
  query GetOwnedAgentIdentities($owner: SuiAddress!, $type: String!) {
    address(address: $owner) {
      objects(filter: { type: $type }) {
        nodes {
          address
          contents {
            json
          }
        }
      }
    }
  }
`);

const GetOwnedMandatesQuery = graphql(`
  query GetOwnedMandates($owner: SuiAddress!, $type: String!) {
    address(address: $owner) {
      objects(filter: { type: $type }) {
        nodes {
          address
          contents {
            json
          }
        }
      }
    }
  }
`);

/** Mirrors custodia::agent_identity::AgentIdentity's field names verbatim
 * (excluding `id`, read from the node's own `address` instead — see the
 * VERIFY note above). */
interface AgentIdentityJson {
  suins_name: string;
  capabilities: string[];
  reputation_id: string;
}

/** Mirrors custodia::mandate::Mandate's field names verbatim (excluding
 * `id`, not needed here). */
interface MandateJson {
  delegate: string;
  revoked: boolean;
}

/** Finds an AgentIdentity owned by `owner` with the given capability tag
 * (e.g. "client" or "legal-review") — there is no registry index by owner,
 * so this scans the (small, per-wallet) set of AgentIdentity objects
 * directly. Returns the first match, or null if none exists yet. */
export async function findOwnedAgentIdentity(
  owner: string,
  capability: string,
): Promise<RegisteredAgent | null> {
  const result = await client.query({
    query: GetOwnedAgentIdentitiesQuery,
    variables: { owner, type: `${PACKAGE_ID}::agent_identity::AgentIdentity` },
  });
  if (result.errors?.length) {
    throw new Error(`Owned AgentIdentity query failed: ${JSON.stringify(result.errors)}`);
  }
  const nodes = result.data?.address?.objects?.nodes ?? [];
  for (const node of nodes) {
    const json = node?.contents?.json as AgentIdentityJson | undefined;
    if (node?.address && json?.capabilities?.includes(capability)) {
      return { agentId: node.address, reputationId: json.reputation_id };
    }
  }
  return null;
}

/** True if `owner` already has a non-revoked Mandate delegating to `delegate`. */
export async function hasFundedMandate(owner: string, delegate: string): Promise<boolean> {
  const result = await client.query({
    query: GetOwnedMandatesQuery,
    variables: { owner, type: `${PACKAGE_ID}::mandate::Mandate` },
  });
  if (result.errors?.length) {
    throw new Error(`Owned Mandate query failed: ${JSON.stringify(result.errors)}`);
  }
  const nodes = result.data?.address?.objects?.nodes ?? [];
  return nodes.some((node) => {
    const json = node?.contents?.json as MandateJson | undefined;
    return json && !json.revoked && json.delegate === delegate;
  });
}
