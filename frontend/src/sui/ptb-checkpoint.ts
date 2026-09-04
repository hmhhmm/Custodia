// PTB step: specialist pushes a granular status checkpoint against a Deal
// — e.g. "Picked up", "En route" — additive alongside deal::mark_delivered,
// never a replacement for it (see move/sources/checkpoint.move's header).
//
// Single moveCall, unlike ptb-deliver.ts's three-call chain: checkpoint::
// new_and_share both creates and shares the object in one entry function,
// so there's no intermediate object to pass into a second call here.
//
// Specialist-signed: checkpoint::new_checkpoint requires the specialist's
// AgentIdentity owner as sender, same check as mark_delivered.

import { Transaction } from "@mysten/sui/transactions";
import { PACKAGE_ID } from "./config";

export function buildPushCheckpointTx(params: {
  dealId: string;
  specialistAgentIdentityId: string;
  label: string;
  note: string;
  /** Empty strings when this checkpoint carries no photo — mirrors
   * checkpoint.move's own "empty string means no photo" convention. */
  photoStorageId: string;
  photoSeedId: string;
}): Transaction {
  const tx = new Transaction();

  tx.moveCall({
    target: `${PACKAGE_ID}::checkpoint::new_and_share`,
    arguments: [
      tx.object(params.dealId),
      tx.object(params.specialistAgentIdentityId),
      tx.pure.string(params.label),
      tx.pure.string(params.note),
      tx.pure.string(params.photoStorageId),
      tx.pure.string(params.photoSeedId),
      tx.object.clock(),
    ],
  });

  return tx;
}
