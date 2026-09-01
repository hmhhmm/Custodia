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

export interface RegisteredAgent {
  agentId: string;
  reputationId: string;
}

/**
 * Reads BOTH IDs a caller needs after registering — not just agent_id.
 * FIXED: an earlier version of this file only returned agent_id, and the
 * caller (Onboarding.tsx) discarded even that, so nothing downstream
 * (orchestrator.ts) ever had a real AgentIdentity/Reputation ID to use —
 * confirmed as a live bug by a fresh audit this session. AgentRegistered
 * carries reputation_id too (see agent_identity.move's event struct), so
 * there is no reason to make a second query for it.
 */
export function extractRegisteredAgent(result: {
  events?: { type: string; parsedJson?: unknown }[];
}): RegisteredAgent | null {
  const event = result.events?.find((e) => e.type.endsWith('::agent_identity::AgentRegistered'));
  if (!event) return null;
  const parsed = event.parsedJson as { agent_id?: string; reputation_id?: string } | undefined;
  if (!parsed?.agent_id || !parsed?.reputation_id) return null;
  return { agentId: parsed.agent_id, reputationId: parsed.reputation_id };
}
