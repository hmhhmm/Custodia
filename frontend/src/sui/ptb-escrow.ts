// PTB #1: verify mandate, lock escrow, create the Deal — targets
// custodia::deal::create_and_share.

import { Transaction } from "@mysten/sui/transactions";
import type { DAppKitCompatibleClient } from "@mysten/dapp-kit-core";
import type { SuiClientTypes } from "@mysten/sui/client";
import { PACKAGE_ID, AGENT_REGISTRY_ID } from "./config";
import { findEvent, fetchTransactionEvents } from "./events";

export function buildLockEscrowAndCreateDealTx(params: {
  mandateId: string;
  clientAgentIdentityId: string;
  specialistAgentId: string; // an ID, not an owned object
  category: string;
  amount: bigint; // in MIST
  deliveryWindowMs: bigint;
  reviewWindowMs: bigint;
  arbiter?: string;
}): Transaction {
  const tx = new Transaction();

  tx.moveCall({
    target: `${PACKAGE_ID}::deal::create_and_share`,
    arguments: [
      tx.object(params.mandateId), // &mut Mandate
      tx.object(AGENT_REGISTRY_ID), // &AgentRegistry
      tx.object(params.clientAgentIdentityId), // &AgentIdentity (client)
      tx.pure.id(params.specialistAgentId),
      tx.pure.string(params.category),
      tx.pure.u64(params.amount),
      tx.pure.u64(params.deliveryWindowMs),
      tx.pure.u64(params.reviewWindowMs),
      tx.pure.option("address", params.arbiter ?? null),
      tx.object.clock(),
    ],
  });

  return tx;
}

export interface CreatedDeal {
  dealId: string;
  /** The ACTUAL on-chain deadline — deal.move computes this as
   * clock.timestamp_ms() + delivery_window_ms using the on-chain Clock,
   * not the client's local time. deal::accept() requires the caller to
   * pass this exact value back (ETermsMismatch aborts otherwise), so it
   * must be read from this event, never recomputed client-side from
   * Date.now() (which drifts from the chain's clock by however long the
   * PTB took to land, on top of ordinary clock skew). */
  stageDeadlineMs: bigint;
}

/**
 * Reads deal_id and stage_deadline_ms off DealCreated. Events aren't
 * present on the signAndExecuteTransaction result itself — this waits for
 * the fullnode to index the transaction first (see events.ts).
 */
export async function extractDealIdFromResult(
  client: DAppKitCompatibleClient,
  result: SuiClientTypes.TransactionResult,
): Promise<CreatedDeal | null> {
  const withEvents = await fetchTransactionEvents(client, result);
  const parsed = findEvent<{ deal_id?: string; stage_deadline_ms?: string | number }>(
    withEvents,
    "::deal::DealCreated",
  );
  if (!parsed?.deal_id || parsed.stage_deadline_ms === undefined) return null;
  return { dealId: parsed.deal_id, stageDeadlineMs: BigInt(parsed.stage_deadline_ms) };
}
