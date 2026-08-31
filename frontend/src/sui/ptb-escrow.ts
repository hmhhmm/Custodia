// Owner: Person 2 (transaction layer).
// STATUS: implemented against custodia::deal::create_and_share (deployed 2026-08-31).

import { Transaction } from '@mysten/sui/transactions';

// From frontend/.env — see README "Deployed addresses"
const PACKAGE_ID = import.meta.env.VITE_CUSTODIA_PACKAGE_ID;
const AGENT_REGISTRY_ID = import.meta.env.VITE_AGENT_REGISTRY_ID;

export function buildLockEscrowAndCreateDealTx(params: {
  mandateId: string;
  clientAgentIdentityId: string;
  specialistAgentId: string;   // this is an ID, not an owned object
  category: string;
  amount: bigint;              // in MIST
  deliveryWindowMs: bigint;
  reviewWindowMs: bigint;
  arbiter?: string;            // optional address
}): Transaction {
  const tx = new Transaction();

  tx.moveCall({
    target: `${PACKAGE_ID}::deal::create_and_share`,
    arguments: [
      tx.object(params.mandateId),                 // &mut Mandate
      tx.object(AGENT_REGISTRY_ID),                 // &AgentRegistry
      tx.object(params.clientAgentIdentityId),       // &AgentIdentity (client)
      tx.pure.id(params.specialistAgentId),          // ID (specialist_agent)
      tx.pure.string(params.category),               // String
      tx.pure.u64(params.amount),                    // u64 amount
      tx.pure.u64(params.deliveryWindowMs),          // u64 delivery_window_ms
      tx.pure.u64(params.reviewWindowMs),            // u64 review_window_ms
      // VERIFY: exact Option<address> construction against current
      // @mysten/sui docs before relying on this — not confirmed this session.
      tx.pure.option('address', params.arbiter ?? null), // Option<address>
      tx.object.clock(),                             // &Clock (built-in helper)
    ],
  });

  return tx;
}

export function extractDealIdFromResult(result: {
  events?: { type: string; parsedJson?: unknown }[];
}): string | null {
  const event = result.events?.find((e) => e.type.endsWith('::deal::DealCreated'));
  if (!event) return null;
  const parsed = event.parsedJson as { deal_id?: string } | undefined;
  return parsed?.deal_id ?? null;
}