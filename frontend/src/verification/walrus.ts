// Walrus HTTP API (publisher/aggregator). These are the current PUBLIC
// TESTNET endpoints — community-run, subject to change and to a ~10 MiB
// per-request rate limit. Re-verify against
// https://docs.wal.app/docs/network-reference before switching to mainnet.

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

// NOTE: testnet publishers are unauthenticated, so these calls run
// directly from the browser. A publisher requiring credentials would need
// a server-side proxy instead.
