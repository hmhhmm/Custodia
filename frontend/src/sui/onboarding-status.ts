// Re-derives onboarding status (client AgentIdentity, funded Mandate) from
// what's actually on-chain for the connected address — App.tsx's screen
// state is otherwise lost on every reload, which makes a wallet that has
// already completed onboarding look broken.

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
  query GetOwnedAgentIdentities($owner: SuiAddress!, $type: String!, $after: String) {
    address(address: $owner) {
      objects(filter: { type: $type }, after: $after) {
        nodes {
          address
          contents {
            json
          }
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
  }
`);

// Mandate is a SHARED object (mandate.move's share() calls
// transfer::share_object) — it has no AddressOwned owner at the Sui object
// layer, so address(address:).objects(...) (used above for AgentIdentity)
// can never find it, no matter how many Mandates exist for that owner.
// Query all SHARED objects of this type globally instead, and filter
// client-side by the Move struct's own `owner` field (mandate.owner, set
// once at creation — a plain address value, unrelated to Sui-level object
// ownership).
// Note: the top-level Query.objects yields plain Object nodes (needs
// asMoveObject), unlike Address.objects above which yields MoveObject
// directly — same distinction discovery.ts already deals with.
const GetSharedMandatesQuery = graphql(`
  query GetSharedMandates($type: String!, $after: String) {
    objects(filter: { type: $type, ownerKind: SHARED }, after: $after) {
      nodes {
        address
        asMoveObject {
          contents {
            json
          }
        }
      }
      pageInfo {
        hasNextPage
        endCursor
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
 * `id`, not needed here).
 * VERIFY: `Balance<SUI>` and `vector<String>`'s exact JSON shape aren't
 * confirmed against official GraphQL RPC docs this session — `funds` is
 * read defensively (see readMistValue below) and `allowed_categories` is
 * assumed to serialize as a plain string array, matching how
 * `capabilities: vector<String>` already reads elsewhere in this file. */
interface MandateJson {
  owner: string;
  delegate: string;
  max_spend: string | number;
  spent_so_far: string | number;
  allowed_categories: string[];
  expires_at: string | number;
  revoked: boolean;
  funds: unknown;
}

export interface MandateDetails {
  mandateId: string;
  delegate: string;
  maxSpendMist: bigint;
  spentSoFarMist: bigint;
  fundsMist: bigint;
  allowedCategories: string[];
  expiresAtMs: number;
  revoked: boolean;
}

/** `Balance<SUI>` reads as either a bare numeric string/number, or as
 * `{ value: ... }` depending on GraphQL RPC's exact serialization (not
 * confirmed against official docs this session — see the VERIFY note on
 * MandateJson). Handles both shapes rather than guessing one. */
function readMistValue(raw: unknown): bigint {
  if (typeof raw === "string" || typeof raw === "number") return BigInt(raw);
  if (raw && typeof raw === "object" && "value" in raw) {
    const value = (raw as { value: unknown }).value;
    if (typeof value === "string" || typeof value === "number") return BigInt(value);
  }
  return 0n;
}

/** Finds every AgentIdentity owned by `owner` — there is no registry index
 * by owner, so this scans the (small, per-wallet) set of AgentIdentity
 * objects directly. */
type OwnedAgentIdentityPage = {
  nodes: { address?: string | null; contents?: { json?: unknown } | null }[];
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
};

async function fetchOwnedAgentIdentitiesPage(owner: string, after: string | null): Promise<OwnedAgentIdentityPage | undefined> {
  const result = await client.query({
    query: GetOwnedAgentIdentitiesQuery,
    variables: { owner, type: `${PACKAGE_ID}::agent_identity::AgentIdentity`, after },
  });
  if (result.errors?.length) {
    throw new Error(`Owned AgentIdentity query failed: ${JSON.stringify(result.errors)}`);
  }
  return result.data?.address?.objects ?? undefined;
}

export async function findOwnedAgentIdentities(owner: string): Promise<(RegisteredAgent & { capabilities: string[] })[]> {
  const found: (RegisteredAgent & { capabilities: string[] })[] = [];
  let hasNextPage = true;
  let after: string | null = null;
  while (hasNextPage) {
    const page = await fetchOwnedAgentIdentitiesPage(owner, after);
    for (const node of page?.nodes ?? []) {
      const json = node?.contents?.json as AgentIdentityJson | undefined;
      if (node?.address && json) {
        found.push({ agentId: node.address, reputationId: json.reputation_id, capabilities: json.capabilities });
      }
    }
    hasNextPage = page?.pageInfo?.hasNextPage ?? false;
    after = page?.pageInfo?.endCursor ?? null;
  }
  return found;
}

// Same multiGetObjects + Reputation.score batch-read pattern already
// verified live in agent/discovery.ts's MultiGetReputationsQuery — kept
// as a separate query here rather than importing that one, since
// discovery.ts is scoped to ranking DISCOVERED candidates and this is
// scoped to a wallet's OWN identities (a different call site, same
// shared Reputation object type and read shape).
const MultiGetReputationsQuery = graphql(`
  query MultiGetOwnReputations($keys: [ObjectKey!]!) {
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

export interface ReputationInfo {
  score: number;
  completedDeals: number;
  disputedDeals: number;
}

/** Batch-reads real on-chain Reputation.score/completed_deals/disputed_deals
 * for a set of Reputation object ids — Reputation is a SHARED object
 * (agent_identity::register_and_keep calls reputation.share()), so these
 * are read directly by id, not scanned/filtered like an owned-object
 * query. Returns a Map keyed by reputationId; ids with no match (e.g. a
 * transient query hiccup) are simply absent, not zero-filled, so a
 * caller can tell "not loaded yet" apart from "genuinely zero". */
export async function findReputationScores(reputationIds: string[]): Promise<Map<string, ReputationInfo>> {
  const map = new Map<string, ReputationInfo>();
  if (reputationIds.length === 0) return map;

  const result = await client.query({
    query: MultiGetReputationsQuery,
    variables: { keys: reputationIds.map((id) => ({ address: id })) },
  });
  if (result.errors?.length) {
    throw new Error(`Reputation batch query failed: ${JSON.stringify(result.errors)}`);
  }

  for (const obj of result.data?.multiGetObjects ?? []) {
    const json = obj?.asMoveObject?.contents?.json as
      | { score?: number; completed_deals?: number; disputed_deals?: number }
      | undefined;
    if (obj?.address && typeof json?.score === "number") {
      map.set(obj.address, {
        score: json.score,
        completedDeals: json.completed_deals ?? 0,
        disputedDeals: json.disputed_deals ?? 0,
      });
    }
  }
  return map;
}

/** Finds an AgentIdentity owned by `owner` with the given capability tag
 * (e.g. "client" or "legal-review"). Returns the first match, or null if
 * none exists yet. */
export async function findOwnedAgentIdentity(
  owner: string,
  capability: string,
): Promise<RegisteredAgent | null> {
  const all = await findOwnedAgentIdentities(owner);
  return all.find((a) => a.capabilities.includes(capability)) ?? null;
}

/** Finds the on-chain state of every non-revoked Mandate whose Move-level
 * `owner` field is `owner` and whose `delegate` is `delegate` (Envoy's
 * fixed demo address) — a wallet can have several (e.g. after using the
 * Mandate tab's "Fund a new Mandate" once the original ran low).
 *
 * Scans every shared Mandate on the package, not just this owner's — there
 * is no owner-indexed query for shared objects (see GetSharedMandatesQuery
 * above). Fine at hackathon scale; would need a real indexer (see the
 * accessing-data skill) if the Mandate count ever grows large. */
type SharedMandatePage = {
  nodes: { address?: string | null; asMoveObject?: { contents?: { json?: unknown } | null } | null }[];
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
};

async function fetchSharedMandatesPage(type: string, after: string | null): Promise<SharedMandatePage | undefined> {
  const result = await client.query({ query: GetSharedMandatesQuery, variables: { type, after } });
  if (result.errors?.length) {
    throw new Error(`Shared Mandate query failed: ${JSON.stringify(result.errors)}`);
  }
  return result.data?.objects ?? undefined;
}

export async function findAllMandateDetails(owner: string, delegate: string): Promise<MandateDetails[]> {
  const matches: MandateDetails[] = [];
  let hasNextPage = true;
  let after: string | null = null;
  while (hasNextPage) {
    const page = await fetchSharedMandatesPage(`${PACKAGE_ID}::mandate::Mandate`, after);
    for (const node of page?.nodes ?? []) {
      const json = node?.asMoveObject?.contents?.json as MandateJson | undefined;
      if (node?.address && json && !json.revoked && json.owner === owner && json.delegate === delegate) {
        matches.push({
          mandateId: node.address,
          delegate: json.delegate,
          maxSpendMist: BigInt(json.max_spend),
          spentSoFarMist: BigInt(json.spent_so_far),
          fundsMist: readMistValue(json.funds),
          allowedCategories: json.allowed_categories,
          expiresAtMs: Number(json.expires_at),
          revoked: json.revoked,
        });
      }
    }
    hasNextPage = page?.pageInfo?.hasNextPage ?? false;
    after = page?.pageInfo?.endCursor ?? null;
  }
  return matches;
}

/** The single Mandate to actually use — whichever of `owner`'s Mandates
 * has the most real spendable room (min(max_spend - spent_so_far, funds)),
 * not just "the first one found". Without this, a wallet with several
 * Mandates (one drained, one freshly funded) could keep resolving to the
 * drained one depending on query result order. Returns null if none
 * exists yet. */
export async function findMandateDetails(owner: string, delegate: string): Promise<MandateDetails | null> {
  const all = await findAllMandateDetails(owner, delegate);
  if (all.length === 0) return null;
  return all.reduce((best, current) => {
    const bestSpendable = best.maxSpendMist - best.spentSoFarMist < best.fundsMist ? best.maxSpendMist - best.spentSoFarMist : best.fundsMist;
    const currentSpendable = current.maxSpendMist - current.spentSoFarMist < current.fundsMist ? current.maxSpendMist - current.spentSoFarMist : current.fundsMist;
    return currentSpendable > bestSpendable ? current : best;
  });
}

/** Finds a non-revoked Mandate owned by `owner` delegating to `delegate`
 * (Envoy's fixed demo address). Returns its object ID, or null if none
 * exists yet. */
export async function findOwnedMandate(owner: string, delegate: string): Promise<string | null> {
  const details = await findMandateDetails(owner, delegate);
  return details?.mandateId ?? null;
}
