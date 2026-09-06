// Seal encryption for Deal-scoped content, gated by an on-chain
// `custodia::deal_access::DealAllowlist` — only the client and specialist
// named on a Deal's allowlist can decrypt.
//
// DESIGN GAP (documented in /docs/ARCHITECTURE.md, not fixed here):
// DealAllowlist is keyed on an existing Deal's ID, so this can only
// encrypt content for a Deal that already exists (step 8, the
// deliverable) — not step-4 negotiation terms, which happen before any
// Deal object exists.

import { SealClient, SessionKey } from "@mysten/seal";
import type { Signer } from "@mysten/sui/cryptography";
import { Transaction } from "@mysten/sui/transactions";
import type { ClientWithExtensions, CoreClient } from "@mysten/sui/client";
import { PACKAGE_ID, ORIGINAL_PACKAGE_ID } from "../sui/config";

// Single-entry committee config, matching the official documented example
// for testnet (docs.sui.io/sui-stack/seal/using-seal) rather than the
// multi-server independent list, since a committee config only needs one
// aggregator-backed entry.
const TESTNET_KEY_SERVERS = [
  {
    objectId: "0xb012378c9f3799fb5b1a7083da74a4069e3c3f1c93de0b27212a5799ce1e1e98",
    aggregatorUrl: "https://seal-aggregator-testnet.mystenlabs.com",
    weight: 1,
  },
];

// Docs recommend starting with a threshold of 2 for independent-server
// configs; a single-entry committee config only has one share to satisfy.
const THRESHOLD = 1;

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(clean.substring(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function createSealClient(suiClient: ClientWithExtensions<{ core: CoreClient }>): SealClient {
  return new SealClient({
    suiClient,
    serverConfigs: TESTNET_KEY_SERVERS,
    verifyKeyServers: false,
  });
}

/**
 * Encrypts a Deal-scoped payload (the deliverable content referenced by
 * `Deal.proof_ref`, per the design-gap note above — NOT negotiation
 * terms) so that only the client and specialist named in that Deal's
 * on-chain `DealAllowlist` can decrypt it.
 *
 * `dealAllowlistObjectId` must be the object ID of an already-created
 * `custodia::deal_access::DealAllowlist` for this deal (see
 * sui/ptb-deal-access.ts's `buildCreateDealAllowlistTx`). The Seal
 * identity `id` is namespaced under that allowlist's own object ID, per
 * `check_policy`'s prefix check in deal_access.move.
 */
export async function encryptDealContent(
  data: Uint8Array,
  suiClient: ClientWithExtensions<{ core: CoreClient }>,
  dealAllowlistObjectId: string,
): Promise<{ encryptedObject: Uint8Array; backupKey: Uint8Array; seedId: string }> {
  const client = createSealClient(suiClient);

  // Seal identity = [allowlist object id bytes][nonce], matching
  // check_policy's prefix assertion in deal_access.move. A random nonce
  // per encryption (rather than a fixed suffix) means a revoked address's
  // already-fetched key cannot be reused to decrypt future ciphertexts
  // encrypted under a new nonce, per deal_access.move's own revocation
  // note (ported from the Seal whitelist reference pattern).
  //
  // `id` (returned as `seedId`) MUST be kept by the caller and passed back
  // into decryptDealContent unchanged — it is not derivable from the
  // allowlist id alone since the nonce is random per encryption. Losing it
  // makes the ciphertext permanently undecryptable (the whole point of the
  // nonce is that it is not guessable/reused).
  const allowlistIdHex = dealAllowlistObjectId.startsWith("0x")
    ? dealAllowlistObjectId.slice(2)
    : dealAllowlistObjectId;
  const nonce = crypto.getRandomValues(new Uint8Array(5));
  const nonceHex = Array.from(nonce)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  const id = allowlistIdHex + nonceHex;

  // Seal's SDK REQUIRES this to be the package's original (version 1)
  // id — @mysten/seal's SessionKey.create hard-asserts
  // `packageObj.object.version === "1"` and throws InvalidPackageError
  // otherwise (confirmed directly in node_modules/@mysten/seal/dist/
  // session-key.mjs; not a Custodia-side check). This is deliberate on
  // Seal's part: an encrypted object's access-control identity is meant
  // to stay stable across package upgrades, anchored to the package's
  // unchanging original id — never the latest upgraded id. Using
  // PACKAGE_ID here worked only by coincidence before this package's
  // first-ever upgrade (when PACKAGE_ID and ORIGINAL_PACKAGE_ID were
  // still the same value) and broke the moment a real upgrade shipped.
  const { encryptedObject, key } = await client.encrypt({
    threshold: THRESHOLD,
    packageId: ORIGINAL_PACKAGE_ID,
    id,
    data,
  });

  return { encryptedObject, backupKey: key, seedId: id };
}

/**
 * Decrypts a Deal-scoped payload. Requires a SessionKey signed by the
 * caller's wallet, and a built (not executed) transaction targeting
 * `custodia::deal_access::seal_approve` for the given allowlist — the
 * Seal key servers dry-run this transaction to decide whether to release
 * key shares.
 */
export async function decryptDealContent(
  encryptedData: Uint8Array,
  suiClient: ClientWithExtensions<{ core: CoreClient }>,
  dealAllowlistObjectId: string,
  seedId: string,
  signer: Signer,
): Promise<Uint8Array> {
  const client = createSealClient(suiClient);

  // Must be ORIGINAL_PACKAGE_ID, matching encryptDealContent's packageId
  // exactly — Seal's own fetchKeys builds the key-server request id as
  // createFullId(sessionKey.getPackageId(), id) (see node_modules/@mysten/
  // seal/dist/client.mjs), NOT from anything read out of the ciphertext
  // itself, so a mismatch here silently asks the key server for the WRONG
  // identity rather than throwing. SessionKey.create also independently
  // hard-requires a version-1 package (same InvalidPackageError as
  // encrypt) — PACKAGE_ID (the latest upgraded id) fails both of these.
  const sessionKey = await SessionKey.create({
    address: signer.toSuiAddress(),
    packageId: ORIGINAL_PACKAGE_ID,
    ttlMin: 10,
    suiClient,
  });
  const message = sessionKey.getPersonalMessage();
  const { signature } = await signer.signPersonalMessage(message);
  sessionKey.setPersonalMessageSignature(signature);

  // hexToBytes, not Buffer — this runs in the browser bundle, where
  // Buffer does not exist.
  const idBytes = hexToBytes(seedId);

  // Unlike packageId above, THIS must stay on PACKAGE_ID (the latest) —
  // it's a real moveCall the key servers dry-run against actually
  // deployed bytecode, not part of Seal's identity namespace. deal_access
  // itself hasn't changed since the original publish, so PACKAGE_ID and
  // ORIGINAL_PACKAGE_ID currently resolve the same call either way, but
  // PACKAGE_ID is the semantically correct one for a function call.
  const tx = new Transaction();
  tx.moveCall({
    target: `${PACKAGE_ID}::deal_access::seal_approve`,
    arguments: [tx.pure.vector("u8", Array.from(idBytes)), tx.object(dealAllowlistObjectId)],
  });
  const txBytes = await tx.build({ client: suiClient, onlyTransactionKind: true });

  return client.decrypt({ data: encryptedData, sessionKey, txBytes });
}
