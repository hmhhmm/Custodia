// Owner: Person 2 (transaction layer).
// STATUS: implemented against custodia::mandate::create_funded_and_share
// (deployed 2026-08-31). Added alongside the Person 4 orchestration
// wiring, since no UI/PTB existed to create the Mandate that PTB #1
// requires — flagging per CLAUDE.md rule 4.
//
// IMPORTANT: a Mandate cannot delegate to its own owner (verified against
// docs/ARCHITECTURE.md's "A Mandate may no longer delegate to its own
// owner" note and mandate.move's `new()` assertion) — the caller must
// pass a DIFFERENT address as `delegate` than the signer.

import { Transaction } from '@mysten/sui/transactions';

const PACKAGE_ID = import.meta.env.VITE_CUSTODIA_PACKAGE_ID;

export function buildCreateFundedMandateTx(params: {
  delegate: string;              // must differ from the signer's own address
  maxSpend: bigint;              // in MIST
  allowedCategories: string[];   // exact-match, case-sensitive against Deal categories
  expiresAtMs: bigint;
  fundingAmount: bigint;         // in MIST — split from gas coin
}): Transaction {
  const tx = new Transaction();

  const [funding] = tx.splitCoins(tx.gas, [tx.pure.u64(params.fundingAmount)]);

  tx.moveCall({
    target: `${PACKAGE_ID}::mandate::create_funded_and_share`,
    arguments: [
      tx.pure.address(params.delegate),
      tx.pure.u64(params.maxSpend),
      tx.pure.vector('string', params.allowedCategories),
      tx.pure.u64(params.expiresAtMs),
      funding,
    ],
  });

  return tx;
}

export function extractMandateIdFromResult(result: {
  events?: { type: string; parsedJson?: unknown }[];
}): string | null {
  const event = result.events?.find((e) => e.type.endsWith('::mandate::MandateFunded'));
  // MandateFunded carries mandate_id but is emitted from `deposit`, called
  // internally by create_funded_and_share — VERIFY this event is actually
  // emitted in that call path (traced through mandate.move's
  // create_funded_and_share -> deposit -> event::emit(MandateFunded), so
  // it should be, but this has not been exercised against a live
  // transaction result in this session to confirm the event surfaces the
  // same way through the entry-function call path).
  if (!event) return null;
  const parsed = event.parsedJson as { mandate_id?: string } | undefined;
  return parsed?.mandate_id ?? null;
}
