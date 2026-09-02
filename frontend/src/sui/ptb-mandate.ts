// Creates and funds a Mandate — targets custodia::mandate::create_funded_and_share.
//
// A Mandate cannot delegate to its own owner (see mandate.move's `new()`
// assertion) — the caller must pass a DIFFERENT address as `delegate` than
// the signer.

import { Transaction } from "@mysten/sui/transactions";
import type { DAppKitCompatibleClient } from "@mysten/dapp-kit-core";
import type { SuiClientTypes } from "@mysten/sui/client";
import { PACKAGE_ID } from "./config";
import { findEvent, fetchTransactionEvents } from "./events";

export function buildCreateFundedMandateTx(params: {
  delegate: string; // must differ from the signer's own address
  maxSpend: bigint; // in MIST
  allowedCategories: string[]; // exact-match, case-sensitive against Deal categories
  expiresAtMs: bigint;
  fundingAmount: bigint; // in MIST — split from gas coin
}): Transaction {
  const tx = new Transaction();

  const [funding] = tx.splitCoins(tx.gas, [tx.pure.u64(params.fundingAmount)]);

  tx.moveCall({
    target: `${PACKAGE_ID}::mandate::create_funded_and_share`,
    arguments: [
      tx.pure.address(params.delegate),
      tx.pure.u64(params.maxSpend),
      tx.pure.vector("string", params.allowedCategories),
      tx.pure.u64(params.expiresAtMs),
      funding,
    ],
  });

  return tx;
}

/**
 * Reads mandate_id off MandateCreated. Events aren't present on the
 * signAndExecuteTransaction result itself — this waits for the fullnode to
 * index the transaction first (see events.ts).
 */
export async function extractMandateIdFromResult(
  client: DAppKitCompatibleClient,
  result: SuiClientTypes.TransactionResult,
): Promise<string | null> {
  const withEvents = await fetchTransactionEvents(client, result);
  const parsed = findEvent<{ mandate_id?: string }>(withEvents, "::mandate::MandateCreated");
  return parsed?.mandate_id ?? null;
}
