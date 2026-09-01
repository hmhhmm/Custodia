// PTB step: specialist accepts the Deal — targets custodia::deal::accept.
// A deal cannot be delivered until it's accepted (see deal.move). This is
// specialist-signed: the caller must be the specialist's AgentIdentity owner.

import { Transaction } from "@mysten/sui/transactions";
import { PACKAGE_ID } from "./config";

export function buildAcceptDealTx(params: {
  dealId: string;
  specialistAgentIdentityId: string;
  arbiter?: string; // must match what create_and_share was given, or aborts ETermsMismatch
  deliveryDeadlineMs: bigint; // must match deal.stage_deadline_ms exactly
  amount: bigint; // must match deal.escrowed_amount.value() exactly
}): Transaction {
  const tx = new Transaction();

  tx.moveCall({
    target: `${PACKAGE_ID}::deal::accept`,
    arguments: [
      tx.object(params.dealId), // &mut Deal
      tx.object(params.specialistAgentIdentityId), // &AgentIdentity (specialist)
      tx.pure.option("address", params.arbiter ?? null),
      tx.pure.u64(params.deliveryDeadlineMs),
      tx.pure.u64(params.amount),
      tx.object.clock(),
    ],
  });

  return tx;
}
