// Shared helper for reading a typed event emitted by a signed transaction.
// dAppKit.signAndExecuteTransaction's result never carries events — the
// wallet only returns effects/transaction/bcs bytes — so callers must
// separately wait for the fullnode to index the transaction with
// `include: { events: true }` before an event can be read at all (the
// alternative, parsing effects.changedObjects, is only usable when no event
// exists — see ptb-deal-access.ts).

import type { DAppKitCompatibleClient } from "@mysten/dapp-kit-core";
import type { SuiClientTypes } from "@mysten/sui/client";

export interface TxResultWithEvents {
  events?: { eventType: string; json: Record<string, unknown> | null }[];
}

export function findEvent<T>(result: TxResultWithEvents, typeSuffix: string): T | null {
  const event = result.events?.find((e) => e.eventType.endsWith(typeSuffix));
  return (event?.json as T | undefined) ?? null;
}

/** Waits for the fullnode to index a just-signed transaction and returns its events. */
export async function fetchTransactionEvents(
  client: DAppKitCompatibleClient,
  result: SuiClientTypes.TransactionResult,
): Promise<TxResultWithEvents> {
  const indexed = await client.core.waitForTransaction({ result, include: { events: true } });
  return { events: indexed.Transaction?.events ?? indexed.FailedTransaction?.events };
}
