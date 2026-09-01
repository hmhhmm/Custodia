// Creates and shares a Deal's Seal DealAllowlist — targets
// custodia::deal_access::new_and_share.
//
// new_and_share emits no event carrying the new DealAllowlist's object id
// (deal_access.move has no DealCreated-style event), and adding one would
// require rebuilding and republishing the Move package. Instead, the id is
// read off the transaction's effects: new_and_share creates exactly one
// object and shares it in the same call, so the single `changedObjects`
// entry with `idOperation: 'Created'` and `outputOwner.$kind === 'Shared'`
// is unambiguously the new DealAllowlist.

import { Transaction } from "@mysten/sui/transactions";
import type { SuiClientTypes } from "@mysten/sui/client";
import { PACKAGE_ID, AGENT_REGISTRY_ID } from "./config";

export function buildCreateDealAllowlistTx(params: { dealId: string }): Transaction {
  const tx = new Transaction();

  tx.moveCall({
    target: `${PACKAGE_ID}::deal_access::new_and_share`,
    arguments: [tx.object(params.dealId), tx.object(AGENT_REGISTRY_ID)],
  });

  return tx;
}

export function extractAllowlistIdFromEffects(effects: SuiClientTypes.TransactionEffects): string | null {
  const created = effects.changedObjects.find(
    (obj: SuiClientTypes.ChangedObject) => obj.idOperation === "Created" && obj.outputOwner?.$kind === "Shared",
  );
  return created?.objectId ?? null;
}
