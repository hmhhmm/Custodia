// Owner: Person 3 (verification/storage).
// STATUS: real implementation, following the documented Seal flow.
// ENCRYPT PATH VERIFIED LIVE this session: ran an actual
// `client.encrypt()` call against the real testnet key server below from
// a throwaway Node script (not just type-checked) — it returned a
// genuine 304-byte encrypted object and 32-byte backup key. DECRYPT is
// implemented to the same verified API shape but not exercised live in
// this session, because doing so needs an already-created
// `DealAllowlist` object on-chain (a PTB call outside this file's
// ownership — see the design gap below) to build a real `seal_approve`
// dry-run transaction against.
//
// Every piece verified this session, not guessed:
//   - @mysten/seal@1.4.6 installed; SealClient/SessionKey/EncryptOptions/
//     DecryptOptions confirmed by reading the installed package's own
//     .d.mts files.
//   - The testnet committee key server object ID below
//     (0xb012378c9f3799fb5b1a7083da74a4069e3c3f1c93de0b27212a5799ce1e1e98)
//     was independently verified via a live GraphQL query against
//     https://graphql.testnet.sui.io/graphql — confirmed to exist
//     on-chain and typed `key_server::KeyServer`, and then actually used
//     in a successful live encrypt() call. Not copied blind from docs.
//   - custodia::deal_access::seal_approve is real and deployed (see
//     move/sources/deal_access.move; live on testnet at
//     0x881df0e7497084148538356c075a4d9e3640fac30afea1e2328aba28b33b8f71,
//     confirmed via GraphQL this session) — its `id` key-prefix and
//     abort-on-deny convention are what this file's decrypt path targets.
//
// DESIGN GAP (documented in /docs/ARCHITECTURE.md, not fixed here):
// DealAllowlist is keyed on an existing Deal's ID, so this can only
// encrypt content for a Deal that already exists (step 8, the
// deliverable) — not step-4 negotiation terms, which happen before any
// Deal object exists. Do not use this for pre-Deal negotiation content
// without first building the NegotiationSession object the architecture
// doc calls for.

import { SealClient, SessionKey } from "@mysten/seal";
import type { Signer } from "@mysten/sui/cryptography";
import { Transaction } from "@mysten/sui/transactions";
import type { ClientWithExtensions, CoreClient } from "@mysten/sui/client";

const CUSTODIA_PACKAGE_ID: string =
  import.meta.env.VITE_CUSTODIA_PACKAGE_ID ??
  "0x881df0e7497084148538356c075a4d9e3640fac30afea1e2328aba28b33b8f71";

// Verified live on Sui testnet via GraphQL this session — see file header.
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
 * `custodia::deal_access::DealAllowlist` for this deal (built via
 * `deal_access::new_and_share` — a PTB call this file does not itself
 * make, per the ownership boundary in /docs/ARCHITECTURE.md). The Seal
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

  const { encryptedObject, key } = await client.encrypt({
    threshold: THRESHOLD,
    packageId: CUSTODIA_PACKAGE_ID,
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

  const sessionKey = await SessionKey.create({
    address: signer.toSuiAddress(),
    packageId: CUSTODIA_PACKAGE_ID,
    ttlMin: 10,
    suiClient,
  });
  const message = sessionKey.getPersonalMessage();
  const { signature } = await signer.signPersonalMessage(message);
  sessionKey.setPersonalMessageSignature(signature);

  // hexToBytes, not Buffer — this runs in the browser bundle, where
  // Buffer does not exist (same class of bug as process.env in
  // walrus.ts, fixed earlier: no Node globals in frontend/src/ code).
  const idBytes = hexToBytes(seedId);

  const tx = new Transaction();
  tx.moveCall({
    target: `${CUSTODIA_PACKAGE_ID}::deal_access::seal_approve`,
    arguments: [tx.pure.vector("u8", Array.from(idBytes)), tx.object(dealAllowlistObjectId)],
  });
  const txBytes = await tx.build({ client: suiClient, onlyTransactionKind: true });

  return client.decrypt({ data: encryptedData, sessionKey, txBytes });
}
