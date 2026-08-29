// Owner: Person 3 (verification/storage).
// STATUS: real implementation, following the documented Seal flow — but
// UNTESTED against a live Seal key server, and depends on
// warrant::deal_access::seal_approve (see /move/sources/deal_access.move,
// itself a stub) actually being deployed. Do not treat this as working
// until both sides are built and exercised together.
//
// Verified this session against https://docs.sui.io/sui-stack/seal/using-seal
// (encrypt/decrypt call shapes) and the Seal whitelist reference pattern
// at https://github.com/MystenLabs/seal/blob/main/move/patterns/sources/whitelist.move.
// Package name @mysten/seal confirmed via docs.sui.io — VERIFY the exact
// current version on npm before installing (not confirmed this session).

// VERIFY: exact import paths/types once @mysten/seal is installed — the
// docs describe a SealClient with .encrypt()/.decrypt(), and a SessionKey
// helper, but this file has not been checked against installed type
// definitions.
//
// import { SealClient, SessionKey } from "@mysten/seal";
// import { Transaction } from "@mysten/sui/transactions";
// import { fromHEX } from "@mysten/sui/utils";

/**
 * Encrypts negotiation terms (or any Deal-scoped sensitive payload) so
 * that only addresses on the Deal's on-chain allowlist can decrypt it.
 *
 * `dealId` is used to derive the Seal identity `id` — VERIFY the exact
 * identity/id-prefix convention against warrant::deal_access's
 * `check_policy` once that module is implemented; the two must agree
 * byte-for-byte or decryption will always fail the on-chain policy check.
 *
 * TODO: implement using SealClient.encrypt({ threshold, packageId, id, data })
 * per the documented shape:
 *   const { encryptedObject, key: backupKey } = await client.encrypt({
 *     threshold: 2,       // PROPOSED t-of-n — confirm with team, 2 assumes
 *                          // at least 2 key servers configured
 *     packageId,          // warrant package ID once deployed — TBD, see
 *                          // /docs/ARCHITECTURE.md
 *     id,                 // derived from dealId per the allowlist's ID
 *                          // prefix convention
 *     data,
 *   });
 * Store `backupKey` securely if a break-glass recovery path is wanted —
 * PROPOSED, confirm with team whether this hackathon demo needs it at all.
 */
export async function encryptNegotiationTerms(
  data: Uint8Array,
  allowedAddresses: string[],
): Promise<Uint8Array> {
  throw new Error(
    "encryptNegotiationTerms: not implemented — VERIFY @mysten/seal API against installed types before implementing (see file header)",
  );
}

/**
 * Decrypts a Deal-scoped payload. Requires a SessionKey (signed by the
 * caller's wallet) and a built (not executed) transaction targeting
 * warrant::deal_access::seal_approve for the given dealId — the Seal key
 * servers dry-run this transaction to decide whether to release key
 * shares.
 *
 * TODO: implement following the documented three-step flow:
 *   1. const sessionKey = await SessionKey.create({ address, packageId, ttlMin, suiClient });
 *      const message = sessionKey.getPersonalMessage();
 *      const { signature } = await keypair.signPersonalMessage(message);
 *      sessionKey.setPersonalMessageSignature(signature);
 *   2. const tx = new Transaction();
 *      tx.moveCall({
 *        target: `${packageId}::deal_access::seal_approve`,
 *        arguments: [tx.pure.vector("u8", fromHEX(id)), allowlistObjectArg],
 *      });
 *      const txBytes = tx.build({ client: suiClient, onlyTransactionKind: true });
 *   3. return client.decrypt({ data: encryptedData, sessionKey, txBytes });
 * VERIFY the exact seal_approve argument list once deal_access.move's
 * TODOs are filled in — do not guess the argument order.
 */
export async function decryptNegotiationTerms(
  encryptedData: Uint8Array,
  dealId: string,
): Promise<Uint8Array> {
  throw new Error(
    "decryptNegotiationTerms: not implemented — VERIFY @mysten/seal API and warrant::deal_access::seal_approve argument order before implementing (see file header)",
  );
}
