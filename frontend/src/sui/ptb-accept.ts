// Owner: Person 2 (transaction layer).
// STATUS: implemented against custodia::deal::accept (deployed 2026-08-31).
// Added alongside the Person 4 orchestration wiring, since the full chain
// (create -> accept -> deliver -> verify_and_release) needs this middle
// step and no builder for it existed yet — flagging per CLAUDE.md rule 4
// rather than adding it to Person 2's files silently.
//
// A deal cannot be delivered until the specialist accepts (see
// move/sources/deal.move's own comment: "A deal cannot be delivered until
// the specialist accepts"). This is specialist-signed — the caller must
// be the specialist's AgentIdentity owner.

import { Transaction } from '@mysten/sui/transactions';

export function buildAcceptDealTx(params: {
  dealId: string;
  specialistAgentIdentityId: string;
  arbiter?: string;          // must match what create_and_share was given, or aborts ETermsMismatch
  deliveryDeadlineMs: bigint; // must match deal.stage_deadline_ms exactly
  amount: bigint;             // must match deal.escrowed_amount.value() exactly
}): Transaction {
  const tx = new Transaction();

  tx.moveCall({
    target: `${import.meta.env.VITE_CUSTODIA_PACKAGE_ID}::deal::accept`,
    arguments: [
      tx.object(params.dealId),                              // &mut Deal
      tx.object(params.specialistAgentIdentityId),           // &AgentIdentity (specialist)
      tx.pure.option('address', params.arbiter ?? null),     // Option<address> expected_arbiter
      tx.pure.u64(params.deliveryDeadlineMs),                 // u64 expected_deadline_ms
      tx.pure.u64(params.amount),                             // u64 expected_amount
      tx.object.clock(),                                      // &Clock
    ],
  });

  return tx;
}
