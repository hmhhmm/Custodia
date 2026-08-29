// Owner: Person 3 (verification/storage).
// STATUS: real implementation via the Walrus HTTP API (publisher/aggregator).
//
// Verified against the installed `accessing-data` Sui skill
// (.claude/skills/accessing-data/walrus.md, sourced from docs.wal.app),
// since docs.wal.app itself returned 403 to direct fetches this session.
// These are the current PUBLIC TESTNET endpoints — community-run, subject
// to change and to a ~10 MiB per-request rate limit. Re-verify against
// https://docs.wal.app/docs/network-reference before switching to mainnet
// or before relying on this for anything beyond a hackathon demo.

// This runs in the Vite-built frontend, not Node — env vars must go
// through import.meta.env and be prefixed VITE_ to be exposed to client
// code (see vite.config.ts / README's env var section). `process.env`
// does not exist in the browser and would throw at runtime.
const WALRUS_PUBLISHER_URL: string =
  import.meta.env.VITE_WALRUS_PUBLISHER_URL ?? "https://publisher.walrus-testnet.walrus.space";
const WALRUS_AGGREGATOR_URL: string =
  import.meta.env.VITE_WALRUS_AGGREGATOR_URL ?? "https://aggregator.walrus-testnet.walrus.space";

interface WalrusPutResponse {
  newlyCreated?: { blobObject?: { blobId: string } };
  alreadyCertified?: { blobId: string };
}

/**
 * Stores a blob via the Walrus publisher HTTP API and returns its blob ID.
 * Used to persist delivered-work artifacts (or references to them) whose
 * blob ID becomes part of Deal.proof_ref material.
 */
export async function storeBlob(data: string | Uint8Array): Promise<{ blobId: string }> {
  // Copy into a plain ArrayBuffer-backed Uint8Array: `fetch`'s BodyInit
  // type (and newer @types/node-influenced DOM libs) rejects a
  // Uint8Array typed over ArrayBufferLike/SharedArrayBuffer, which is
  // what TextEncoder().encode() and some Uint8Array sources produce.
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  const body = new Uint8Array(bytes);

  const response = await fetch(`${WALRUS_PUBLISHER_URL}/v1/blobs`, {
    method: "PUT",
    headers: { "Content-Type": "application/octet-stream" },
    body,
  });

  if (!response.ok) {
    throw new Error(`Walrus publisher returned ${response.status}: ${await response.text()}`);
  }

  const result: WalrusPutResponse = await response.json();
  const blobId = result.newlyCreated?.blobObject?.blobId ?? result.alreadyCertified?.blobId;

  if (!blobId) {
    throw new Error("Walrus publisher response did not contain a blobId — response shape may have changed, re-check docs.wal.app");
  }

  return { blobId };
}

/**
 * Reads a blob via the Walrus aggregator HTTP API.
 *
 * A blob that was just certified can briefly 404 on the aggregator before
 * it has propagated — retry with backoff rather than failing immediately.
 */
export async function readBlob(
  blobId: string,
  opts: { retries?: number; retryDelayMs?: number } = {},
): Promise<Uint8Array> {
  const retries = opts.retries ?? 3;
  const retryDelayMs = opts.retryDelayMs ?? 1000;

  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetch(`${WALRUS_AGGREGATOR_URL}/v1/blobs/${blobId}`);
      if (response.ok) {
        return new Uint8Array(await response.arrayBuffer());
      }
      lastError = new Error(`Walrus aggregator returned ${response.status} for blobId ${blobId}`);
    } catch (err) {
      lastError = err;
    }

    if (attempt < retries) {
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs * (attempt + 1)));
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

// NOTE: if a standalone Node service turns out cleaner for these calls
// than running them in the browser (e.g. to keep publisher credentials
// server-side — not currently needed since testnet publishers are
// unauthenticated), propose moving this to a new /services/verification
// package and update pnpm-workspace.yaml + /docs/ARCHITECTURE.md
// accordingly — flag this decision to the team rather than doing it
// silently.
