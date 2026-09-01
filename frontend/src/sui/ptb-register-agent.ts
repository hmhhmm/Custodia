// Owner: Person 2 (transaction layer).
// STATUS: implemented against custodia::agent_identity::register_and_keep
// (deployed 2026-08-31). Added alongside the Person 4 orchestration
// wiring — no UI/PTB existed to register the CLIENT's own AgentIdentity
// (only the specialist side was ever discussed), and PTB #1's
// `client_agent_identity` argument requires one. Flagging per CLAUDE.md
// rule 4.

import { Transaction } from '@mysten/sui/transactions';

const PACKAGE_ID = import.meta.env.VITE_CUSTODIA_PACKAGE_ID;
const AGENT_REGISTRY_ID = import.meta.env.VITE_AGENT_REGISTRY_ID;

export function buildRegisterAgentTx(params: {
  suinsName: string;   // must be unique against the live registry, or aborts ENameTaken
  capabilities: string[];
}): Transaction {
  const tx = new Transaction();

  tx.moveCall({
    target: `${PACKAGE_ID}::agent_identity::register_and_keep`,
    arguments: [
      tx.object(AGENT_REGISTRY_ID),
      tx.pure.string(params.suinsName),
      tx.pure.vector('string', params.capabilities),
    ],
  });

  return tx;
}

export function extractAgentIdFromResult(result: {
  events?: { type: string; parsedJson?: unknown }[];
}): string | null {
  const event = result.events?.find((e) => e.type.endsWith('::agent_identity::AgentRegistered'));
  if (!event) return null;
  const parsed = event.parsedJson as { agent_id?: string } | undefined;
  return parsed?.agent_id ?? null;
}
