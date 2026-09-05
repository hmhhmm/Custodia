// Reads live Deal state for the specialist inbox — a real connected wallet
// needs to see Deals naming their own AgentIdentity as specialist_agent, so
// they can accept()/mark_delivered() with their own signature instead of
// orchestrator.ts's old fixed specialistKeypair.
//
// Deal is a SHARED object (deal.move's share() calls transfer::share_object)
// — same reasoning as Mandate in onboarding-status.ts: no AddressOwned
// owner, so this scans all shared Deals of the type and filters
// client-side by the Move struct's own specialist_agent field.

import { SuiGraphQLClient } from "@mysten/sui/graphql";
import { graphql } from "@mysten/sui/graphql/schema";
import { PACKAGE_ID, ORIGINAL_PACKAGE_ID } from "./config";
import { ENVOY_ADDRESS } from "./envoy-signer";

const GRAPHQL_URL = "https://graphql.testnet.sui.io/graphql";

const client = new SuiGraphQLClient({ url: GRAPHQL_URL, network: "testnet" });

const GetSharedDealsQuery = graphql(`
  query GetSharedDeals($type: String!, $after: String) {
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

// Same shared-object scan pattern as GetSharedDealsQuery — DealAllowlist
// and DealProof are both shared (deal_access::share_allowlist,
// proof::share_proof), keyed to their owning Deal via a plain `deal_id`
// field, not a Sui-level owner.
const GetSharedByTypeQuery = graphql(`
  query GetSharedByType($type: String!, $after: String) {
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

type SharedObjectNode = {
  address?: string | null;
  asMoveObject?: { contents?: { json?: unknown } | null } | null;
};

/** Walks every page of a GetSharedDealsQuery scan — the server applies its
 * own default page size when `first` is omitted, so a single unpaginated
 * call silently misses objects once a type has more shared instances
 * on-chain than fit in one page (this was a real bug: a freshly-created
 * Deal could fall outside the first page). */
type SharedObjectPage = {
  nodes: SharedObjectNode[];
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
};

async function fetchSharedDealsPage(type: string, after: string | null): Promise<SharedObjectPage | undefined> {
  const result = await client.query({ query: GetSharedDealsQuery, variables: { type, after } });
  if (result.errors?.length) {
    throw new Error(`Shared Deal query failed: ${JSON.stringify(result.errors)}`);
  }
  return result.data?.objects ?? undefined;
}

async function queryAllSharedDeals(type: string): Promise<SharedObjectNode[]> {
  const allNodes: SharedObjectNode[] = [];
  let hasNextPage = true;
  let after: string | null = null;
  while (hasNextPage) {
    const page = await fetchSharedDealsPage(type, after);
    allNodes.push(...(page?.nodes ?? []));
    hasNextPage = page?.pageInfo?.hasNextPage ?? false;
    after = page?.pageInfo?.endCursor ?? null;
  }
  return allNodes;
}

/** Same pagination fix as queryAllSharedDeals, for GetSharedByTypeQuery's
 * DealAllowlist/DealProof/DealCheckpoint/DealBrief scans — a freshly
 * created object of any of these types could otherwise fall outside the
 * first page and read back as "not found" even though it had already
 * landed on-chain (this was the exact cause of the specialist's
 * "No DealAllowlist found... escrow-lock may not have finished" error
 * appearing right after a client's escrow-lock step had genuinely
 * finished). */
async function fetchSharedByTypePage(type: string, after: string | null): Promise<SharedObjectPage | undefined> {
  const result = await client.query({ query: GetSharedByTypeQuery, variables: { type, after } });
  if (result.errors?.length) {
    throw new Error(`Shared object query failed for ${type}: ${JSON.stringify(result.errors)}`);
  }
  return result.data?.objects ?? undefined;
}

async function queryAllSharedByType(type: string): Promise<SharedObjectNode[]> {
  const allNodes: SharedObjectNode[] = [];
  let hasNextPage = true;
  let after: string | null = null;
  while (hasNextPage) {
    const page = await fetchSharedByTypePage(type, after);
    allNodes.push(...(page?.nodes ?? []));
    hasNextPage = page?.pageInfo?.hasNextPage ?? false;
    after = page?.pageInfo?.endCursor ?? null;
  }
  return allNodes;
}

/** Mirrors custodia::deal::Deal's field names verbatim (excluding `id`).
 * VERIFY: DealStatus enum's exact GraphQL JSON shape wasn't confirmed
 * against official docs — read defensively via readStatusVariant, matching
 * the `{"@variant": "..."}` shape already observed on this package's
 * DealStatus enum via a direct on-chain query earlier in this project. */
interface DealJson {
  client_agent: string;
  specialist_agent: string;
  escrowed_amount: unknown;
  status: { "@variant": string } | string;
  proof_ref: string | null;
  funding_mandate: string;
  arbiter: string | null;
  review_window_ms: string | number;
  stage_deadline_ms: string | number;
}

export type DealStatusName =
  | "Negotiating"
  | "Escrowed"
  | "Accepted"
  | "Delivered"
  | "Verified"
  | "Released"
  | "Disputed"
  | "Refunded"
  | "Settled";

export interface SpecialistDeal {
  dealId: string;
  clientAgent: string;
  specialistAgent: string;
  escrowedAmountMist: bigint;
  status: DealStatusName;
  stageDeadlineMs: number;
}

// deal.move's own comment: category is consumed by the mandate check and
// never stored on the Deal object itself — only readable from the
// DealCreated event at creation time (see deal.move's DealCreated struct
// doc comment). Deal itself also stores no creation timestamp (only a
// forward-looking stage_deadline_ms) — the event's own `timestamp` field
// (the checkpoint time it was emitted at) is the real creation time.
// Query.events(filter: {type, sender}) and Event.timestamp confirmed
// against this project's locally installed GraphQL schema types
// (node_modules/@mysten/sui/dist/graphql/generated/tada-env.d.mts) — real
// verified fields, not guessed.
const GetDealCreatedEventsQuery = graphql(`
  query GetDealCreatedEvents($type: String!, $sender: SuiAddress!) {
    events(filter: { type: $type, sender: $sender }) {
      nodes {
        timestamp
        contents {
          json
        }
      }
    }
  }
`);

interface DealCreatedJson {
  deal_id: string;
  category: string;
  amount: string | number;
}

export interface DealMetadata {
  category: string;
  /** Milliseconds since epoch — from the DealCreated event's own
   * checkpoint timestamp, the real creation time (see the query comment
   * above; the Deal object itself stores no such field). */
  createdAtMs: number | null;
  /** The ORIGINAL escrowed amount, in MIST, from the DealCreated event —
   * NOT the same as Deal.escrowed_amount, which is a live balance that
   * correctly drops to 0 once verify_and_release withdraws it all (see
   * deal.move's pay_specialist). Reading the live balance for a RELEASED
   * deal's "amount paid" display was a real bug: it showed 0 SUI for a
   * deal that had genuinely already paid out, because the escrow was
   * empty by design after paying, not because nothing was ever paid. */
  amountMist: bigint;
}

/** Maps dealId -> {category, createdAtMs}, by scanning every DealCreated
 * event Envoy has ever emitted (Envoy signs create_and_share for every
 * deal in this app — see orchestrator.ts). Cached per call site rather
 * than globally, since the Deals tab already re-fetches on mount and this
 * is cheap at hackathon scale. */
export async function findDealMetadata(): Promise<Map<string, DealMetadata>> {
  const result = await client.query({
    query: GetDealCreatedEventsQuery,
    variables: { type: `${ORIGINAL_PACKAGE_ID}::deal::DealCreated`, sender: ENVOY_ADDRESS },
  });
  if (result.errors?.length) {
    throw new Error(`DealCreated events query failed: ${JSON.stringify(result.errors)}`);
  }
  const nodes = result.data?.events?.nodes ?? [];
  const map = new Map<string, DealMetadata>();
  for (const node of nodes) {
    const json = node?.contents?.json as DealCreatedJson | undefined;
    if (json?.deal_id) {
      const createdAtMs = node?.timestamp ? new Date(node.timestamp).getTime() : null;
      map.set(json.deal_id, { category: json.category, createdAtMs, amountMist: BigInt(json.amount) });
    }
  }
  return map;
}

function readStatusVariant(raw: DealJson["status"]): DealStatusName {
  const name = typeof raw === "string" ? raw : raw["@variant"];
  return name as DealStatusName;
}

function readMistValue(raw: unknown): bigint {
  if (typeof raw === "string" || typeof raw === "number") return BigInt(raw);
  if (raw && typeof raw === "object" && "value" in raw) {
    const value = (raw as { value: unknown }).value;
    if (typeof value === "string" || typeof value === "number") return BigInt(value);
  }
  return 0n;
}

/** Finds every Deal naming `specialistAgentId` (an AgentIdentity object ID,
 * not a wallet address) as its specialist_agent — the specialist inbox's
 * data source. Scans every shared Deal on the package; fine at hackathon
 * scale, see the same note on findAllMandateDetails. */
export async function findDealsForSpecialist(specialistAgentId: string): Promise<SpecialistDeal[]> {
  const nodes = await queryAllSharedDeals(`${ORIGINAL_PACKAGE_ID}::deal::Deal`);
  const matches: SpecialistDeal[] = [];
  for (const node of nodes) {
    const json = node?.asMoveObject?.contents?.json as DealJson | undefined;
    if (node?.address && json && json.specialist_agent === specialistAgentId) {
      matches.push({
        dealId: node.address,
        clientAgent: json.client_agent,
        specialistAgent: json.specialist_agent,
        escrowedAmountMist: readMistValue(json.escrowed_amount),
        status: readStatusVariant(json.status),
        stageDeadlineMs: Number(json.stage_deadline_ms),
      });
    }
  }
  return matches.sort((a, b) => b.stageDeadlineMs - a.stageDeadlineMs);
}

/** Finds every Deal naming `clientAgentId` (Envoy's own AgentIdentity, see
 * envoy-signer.ts) as its client_agent — this IS the Deals tab's real data
 * source. Unlike ChatPanel's ConversationTurn state (which lives only in
 * React state and is lost on refresh), this is re-derived from chain every
 * time the Deals tab mounts, so a refresh can never lose track of a deal
 * that's still genuinely in progress on-chain. */
export async function findDealsForClient(clientAgentId: string): Promise<SpecialistDeal[]> {
  const nodes = await queryAllSharedDeals(`${ORIGINAL_PACKAGE_ID}::deal::Deal`);
  const matches: SpecialistDeal[] = [];
  for (const node of nodes) {
    const json = node?.asMoveObject?.contents?.json as DealJson | undefined;
    if (node?.address && json && json.client_agent === clientAgentId) {
      matches.push({
        dealId: node.address,
        clientAgent: json.client_agent,
        specialistAgent: json.specialist_agent,
        escrowedAmountMist: readMistValue(json.escrowed_amount),
        status: readStatusVariant(json.status),
        stageDeadlineMs: Number(json.stage_deadline_ms),
      });
    }
  }
  return matches.sort((a, b) => b.stageDeadlineMs - a.stageDeadlineMs);
}

/** Re-reads a single Deal's live status by id — used to poll a specific
 * deal from the client side (Dashboard/ProgressView) while waiting on the
 * specialist, and again once Delivered to enable the release button. */
export async function findDealById(dealId: string): Promise<SpecialistDeal | null> {
  const nodes = await queryAllSharedDeals(`${ORIGINAL_PACKAGE_ID}::deal::Deal`);
  for (const node of nodes) {
    if (node?.address !== dealId) continue;
    const json = node?.asMoveObject?.contents?.json as DealJson | undefined;
    if (!json) return null;
    return {
      dealId: node.address,
      clientAgent: json.client_agent,
      specialistAgent: json.specialist_agent,
      escrowedAmountMist: readMistValue(json.escrowed_amount),
      status: readStatusVariant(json.status),
      stageDeadlineMs: Number(json.stage_deadline_ms),
    };
  }
  return null;
}

// Unlike DealCreated (always emitted by Envoy — see GetDealCreatedEventsQuery
// above), DealAccepted/DealDelivered are signed by the specialist and
// DealReleased by Envoy (verify_and_release, see release.ts) — no single
// sender to filter by, so this scans by type only and matches deal_id
// client-side, same pattern as findAllowlistForDeal/findProofForDeal below.
const GetEventsByTypeQuery = graphql(`
  query GetEventsByType($type: String!) {
    events(filter: { type: $type }) {
      nodes {
        timestamp
        contents {
          json
        }
      }
    }
  }
`);

interface DealStageEventJson {
  deal_id: string;
}

export interface DealStageTimestamps {
  acceptedAtMs: number | null;
  deliveredAtMs: number | null;
  releasedAtMs: number | null;
}

/** Real per-stage timestamps for one deal's timeline — each pulled from the
 * checkpoint time (Event.timestamp) of the DealAccepted/DealDelivered/
 * DealReleased event that carries this exact deal_id. Deal itself stores no
 * per-stage history (only a forward-looking, overwritten stage_deadline_ms —
 * see deal.move's own doc comment on that field), so this is the only real
 * (non-fabricated) source for "when did this stage actually happen." */
export async function findDealStageTimestamps(dealId: string): Promise<DealStageTimestamps> {
  const [accepted, delivered, released] = await Promise.all([
    client.query({ query: GetEventsByTypeQuery, variables: { type: `${ORIGINAL_PACKAGE_ID}::deal::DealAccepted` } }),
    client.query({ query: GetEventsByTypeQuery, variables: { type: `${ORIGINAL_PACKAGE_ID}::deal::DealDelivered` } }),
    client.query({ query: GetEventsByTypeQuery, variables: { type: `${ORIGINAL_PACKAGE_ID}::deal::DealReleased` } }),
  ]);
  for (const result of [accepted, delivered, released]) {
    if (result.errors?.length) {
      throw new Error(`Deal stage events query failed: ${JSON.stringify(result.errors)}`);
    }
  }
  function findTimestamp(nodes: readonly { timestamp?: string | null; contents?: { json?: unknown } | null }[] | undefined): number | null {
    for (const node of nodes ?? []) {
      const json = node?.contents?.json as DealStageEventJson | undefined;
      if (json?.deal_id === dealId && node?.timestamp) {
        return new Date(node.timestamp).getTime();
      }
    }
    return null;
  }
  return {
    acceptedAtMs: findTimestamp(accepted.data?.events?.nodes),
    deliveredAtMs: findTimestamp(delivered.data?.events?.nodes),
    releasedAtMs: findTimestamp(released.data?.events?.nodes),
  };
}

interface DealAllowlistJson {
  deal_id: string;
}

/** Finds the DealAllowlist scoped to `dealId` — deal_access.move keys it
 * via a plain `deal_id` field, not Sui-level ownership (see
 * deal_access.move's DealAllowlist struct). */
export async function findAllowlistForDeal(dealId: string): Promise<string | null> {
  const nodes = await queryAllSharedByType(`${ORIGINAL_PACKAGE_ID}::deal_access::DealAllowlist`);
  for (const node of nodes) {
    const json = node?.asMoveObject?.contents?.json as DealAllowlistJson | undefined;
    if (node?.address && json?.deal_id === dealId) {
      return node.address;
    }
  }
  return null;
}

interface DealProofJson {
  deal_id: string;
  storage_id: string;
  extra: number[] | string;
}

export interface DealProofInfo {
  proofId: string;
  storageId: string;
  /** The Seal identity/seed used to encrypt the deliverable text, written
   * into DealProof.extra by mark_delivered's PTB (see ptb-deliver.ts) —
   * the client needs this exact value back to decrypt (it's a random
   * nonce, not derivable from the allowlist id alone). Empty if the proof
   * predates this convention or extra wasn't set. */
  seedId: string;
  /** Set only when the specialist attached a file (see ptb-deliver.ts's
   * DeliveryExtra) — its own Walrus blob id + Seal seed, independent of
   * the deliverable text's blob/seed. */
  file?: { blobId: string; seedId: string; name: string; mimeType: string };
}

/** Parses DealProof.extra — JSON per ptb-deliver.ts's DeliveryExtra
 * schema going forward. Falls back to treating it as a bare UTF-8 seed
 * string for proofs created before this project introduced the JSON
 * convention (this app's own earlier format, not an external API — no
 * VERIFY needed, just backward compatibility with data this same
 * codebase already wrote on testnet). */
function parseExtra(raw: number[] | string): { seedId: string; file?: DealProofInfo["file"] } {
  const text = typeof raw === "string" ? raw : new TextDecoder().decode(new Uint8Array(raw));
  if (!text) return { seedId: "" };
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === "object" && parsed.v === 1 && typeof parsed.sealSeedId === "string") {
      return { seedId: parsed.sealSeedId, file: parsed.file };
    }
  } catch {
    // Not JSON — must be the old plain-seed convention.
  }
  return { seedId: text };
}

/** Finds the DealProof scoped to `dealId`, if delivery has happened yet —
 * the client's release screen reads this to recover the exact Seal seedId
 * the specialist used, and to show the Walrus storage id. */
export async function findProofForDeal(dealId: string): Promise<DealProofInfo | null> {
  const nodes = await queryAllSharedByType(`${ORIGINAL_PACKAGE_ID}::proof::DealProof`);
  for (const node of nodes) {
    const json = node?.asMoveObject?.contents?.json as DealProofJson | undefined;
    if (node?.address && json?.deal_id === dealId) {
      const { seedId, file } = parseExtra(json.extra ?? []);
      return { proofId: node.address, storageId: json.storage_id, seedId, file };
    }
  }
  return null;
}

interface DealCheckpointJson {
  deal_id: string;
  label: string;
  note: string;
  photo_storage_id: string;
  photo_seed_id: string;
  created_by: string;
  created_at_ms: string | number;
}

export interface DealCheckpointInfo {
  checkpointId: string;
  label: string;
  note: string;
  /** Empty string when the specialist attached no photo to this
   * checkpoint. Seal-encrypted against the deal's existing DealAllowlist
   * — same decrypt path as a DealProof file attachment, just referencing
   * this checkpoint's own blobId/seedId instead. */
  photo: { blobId: string; seedId: string } | null;
  createdByAddress: string;
  createdAtMs: number;
}

/** Finds every DealCheckpoint scoped to `dealId`, oldest first — the real
 * granular status trail a specialist pushes (see move/sources/checkpoint.move),
 * additive alongside Deal's own coarse status. checkpoint::DealCheckpoint
 * is a type introduced BY the package upgrade that added checkpoint.move,
 * so — unlike every other query in this file — this one correctly uses
 * PACKAGE_ID (the latest/upgraded id), not ORIGINAL_PACKAGE_ID; see
 * config.ts's header comment on why the two constants exist and diverge
 * after an upgrade. */
export async function findCheckpointsForDeal(dealId: string): Promise<DealCheckpointInfo[]> {
  const nodes = await queryAllSharedByType(`${PACKAGE_ID}::checkpoint::DealCheckpoint`);
  const matches: DealCheckpointInfo[] = [];
  for (const node of nodes) {
    const json = node?.asMoveObject?.contents?.json as DealCheckpointJson | undefined;
    if (node?.address && json?.deal_id === dealId) {
      matches.push({
        checkpointId: node.address,
        label: json.label,
        note: json.note,
        photo: json.photo_storage_id ? { blobId: json.photo_storage_id, seedId: json.photo_seed_id } : null,
        createdByAddress: json.created_by,
        createdAtMs: Number(json.created_at_ms),
      });
    }
  }
  return matches.sort((a, b) => a.createdAtMs - b.createdAtMs);
}

interface DealBriefJson {
  deal_id: string;
  storage_id: string;
  seed_id: string;
}

export interface DealBriefInfo {
  briefId: string;
  storageId: string;
  seedId: string;
}

/** Finds the DealBrief scoped to `dealId`, if the client has written one
 * — the real task brief (what the item is, where to collect/deliver it,
 * contact details) a specialist needs to actually do the work, which
 * nothing in deal.move's own fields ever carried (only category and
 * amount). See move/sources/deal_brief.move's header for why this needed
 * its own object rather than reusing DealCheckpoint or DealProof.
 * deal_brief::DealBrief is a type introduced BY the package upgrade that
 * added deal_brief.move, so — like checkpoint::DealCheckpoint — this
 * correctly uses PACKAGE_ID, not ORIGINAL_PACKAGE_ID. */
export async function findBriefForDeal(dealId: string): Promise<DealBriefInfo | null> {
  const nodes = await queryAllSharedByType(`${PACKAGE_ID}::deal_brief::DealBrief`);
  for (const node of nodes) {
    const json = node?.asMoveObject?.contents?.json as DealBriefJson | undefined;
    if (node?.address && json?.deal_id === dealId) {
      return { briefId: node.address, storageId: json.storage_id, seedId: json.seed_id };
    }
  }
  return null;
}
