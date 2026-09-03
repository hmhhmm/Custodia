// PTB step: specialist marks the Deal delivered — chains three Move calls
// in one PTB: mint a DealProof, pass it by reference into mark_delivered
// (a freshly-created object result can be used directly in a later moveCall
// without sharing it first), then share the proof object (DealProof is
// key-only, so a PTB cannot end with it dangling as an unused value).
//
// Specialist-signed: mark_delivered requires the specialist's AgentIdentity
// owner as sender.

import { Transaction } from "@mysten/sui/transactions";
import { PACKAGE_ID } from "./config";

/** Schema for DealProof.extra — proof.move's field is a free-form
 * vector<u8>, documented there as "anything not yet designed goes HERE".
 * This project's own convention (not an external API, so no VERIFY
 * needed): JSON-encoded so the client's release screen can recover BOTH
 * the Seal decryption seed and an optional attached file's blob id, not
 * just the seed alone (which is all the previous plain-UTF-8 convention
 * carried). Bump the version if the shape changes — see the format-version
 * warning above DealProof's own PROOF_FORMAT_VERSION const in proof.move. */
export interface DeliveryExtra {
  v: 1;
  sealSeedId: string;
  /** Set only when the specialist attached a file — its own Walrus blob
   * id and Seal seed, separate from the deliverable text's own blob/seed
   * since they're two independent encrypted objects. */
  file?: { blobId: string; seedId: string; name: string; mimeType: string };
}

export function buildMarkDeliveredTx(params: {
  dealId: string;
  specialistAgentIdentityId: string;
  storageId: string; // Walrus blob ID, from verification/walrus.ts storeBlob()
  attestationId: string; // from verification/nautilus.mock.ts mockNautilusAttest()
  /** Written into DealProof.extra as JSON (see DeliveryExtra) so the
   * client can read back everything needed to decrypt later, without a
   * separate off-chain handoff. */
  extra: DeliveryExtra;
}): Transaction {
  const tx = new Transaction();

  const proof = tx.moveCall({
    target: `${PACKAGE_ID}::proof::new_simulated`,
    arguments: [
      tx.pure.id(params.dealId),
      tx.pure.string("walrus/testnet"),
      tx.pure.string(params.storageId),
      tx.pure.string(params.attestationId),
      tx.pure.string("nautilus.mock.ts"),
      tx.pure.vector("u8", Array.from(new TextEncoder().encode(JSON.stringify(params.extra)))),
      tx.object.clock(),
    ],
  });

  tx.moveCall({
    target: `${PACKAGE_ID}::deal::mark_delivered`,
    arguments: [tx.object(params.dealId), tx.object(params.specialistAgentIdentityId), proof, tx.object.clock()],
  });

  tx.moveCall({
    target: `${PACKAGE_ID}::proof::share_proof`,
    arguments: [proof],
  });

  return tx;
}
