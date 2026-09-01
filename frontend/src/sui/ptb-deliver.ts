// Owner: Person 2 (transaction layer).
// STATUS: implemented against custodia::proof::new_simulated +
// custodia::deal::mark_delivered + custodia::proof::share_proof (all
// deployed 2026-08-31). Added alongside the Person 4 orchestration
// wiring — flagging per CLAUDE.md rule 4.
//
// Chains three Move calls in one PTB: mint a DealProof, pass it by
// reference into mark_delivered (verified real command-chaining pattern,
// per the installed ptbs skill's "equip_sword" example — a freshly
// created object result can be passed directly into a later moveCall
// without sharing it first), then share the proof object so it exists
// as a real fetchable object afterward (DealProof is key-only, so a PTB
// cannot end with it dangling as an unused value).
//
// Specialist-signed: mark_delivered requires the specialist's
// AgentIdentity owner as sender.

import { Transaction } from '@mysten/sui/transactions';

const PACKAGE_ID = import.meta.env.VITE_CUSTODIA_PACKAGE_ID;

export function buildMarkDeliveredTx(params: {
  dealId: string;
  specialistAgentIdentityId: string;
  storageId: string;        // Walrus blob ID, from verification/walrus.ts storeBlob()
  attestationId: string;    // from verification/nautilus.mock.ts mockNautilusAttest()
}): Transaction {
  const tx = new Transaction();

  const proof = tx.moveCall({
    target: `${PACKAGE_ID}::proof::new_simulated`,
    arguments: [
      tx.pure.id(params.dealId),
      tx.pure.string('walrus/testnet'),
      tx.pure.string(params.storageId),
      tx.pure.string(params.attestationId),
      tx.pure.string('nautilus.mock.ts'),
      tx.pure.vector('u8', []),
      tx.object.clock(),
    ],
  });

  tx.moveCall({
    target: `${PACKAGE_ID}::deal::mark_delivered`,
    arguments: [
      tx.object(params.dealId),
      tx.object(params.specialistAgentIdentityId),
      proof,
      tx.object.clock(),
    ],
  });

  tx.moveCall({
    target: `${PACKAGE_ID}::proof::share_proof`,
    arguments: [proof],
  });

  return tx;
}
