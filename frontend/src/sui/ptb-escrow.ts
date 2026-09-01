// PTB #1: verify mandate, lock escrow, create the Deal — targets
// custodia::deal::create_and_share.

import { Transaction } from "@mysten/sui/transactions";
import { PACKAGE_ID, AGENT_REGISTRY_ID } from "./config";
import { findEvent, type TxResultWithEvents } from "./events";

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

export function extractDealIdFromResult(result: TxResultWithEvents): string | null {
  const parsed = findEvent<{ deal_id?: string }>(result, "::deal::DealCreated");
  return parsed?.deal_id ?? null;
}
