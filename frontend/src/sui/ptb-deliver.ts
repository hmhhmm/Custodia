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

export function buildMarkDeliveredTx(params: {
  dealId: string;
  specialistAgentIdentityId: string;
  storageId: string; // Walrus blob ID, from verification/walrus.ts storeBlob()
  attestationId: string; // from verification/nautilus.mock.ts mockNautilusAttest()
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
      tx.pure.vector("u8", []),
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
