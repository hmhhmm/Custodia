// Writes a Deal's real task brief on-chain — Seal-encrypted, stored on
// Walrus, referenced by a real DealBrief object (see
// move/sources/deal_brief.move). Client-signed (Envoy), built right after
// escrow locks and the DealAllowlist exists — see orchestrator.ts.
//
// Single moveCall, same shape as ptb-checkpoint.ts: custodia::deal_brief::
// new_and_share both creates and shares the object in one entry function.

import { Transaction } from "@mysten/sui/transactions";
import { PACKAGE_ID } from "./config";

export function buildCreateDealBriefTx(params: {
  dealId: string;
  clientAgentIdentityId: string;
  storageId: string;
  seedId: string;
}): Transaction {
  const tx = new Transaction();

  tx.moveCall({
    target: `${PACKAGE_ID}::deal_brief::new_and_share`,
    arguments: [
      tx.object(params.dealId),
      tx.object(params.clientAgentIdentityId),
      tx.pure.string(params.storageId),
      tx.pure.string(params.seedId),
    ],
  });

  return tx;
}
