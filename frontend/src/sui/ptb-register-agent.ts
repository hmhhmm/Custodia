// Registers an AgentIdentity — targets custodia::agent_identity::register_and_keep.

import { Transaction } from "@mysten/sui/transactions";
import { PACKAGE_ID, AGENT_REGISTRY_ID } from "./config";
import { findEvent, type TxResultWithEvents } from "./events";

export function buildRegisterAgentTx(params: {
  suinsName: string; // must be unique against the live registry, or aborts ENameTaken
  capabilities: string[];
}): Transaction {
  const tx = new Transaction();

  tx.moveCall({
    target: `${PACKAGE_ID}::agent_identity::register_and_keep`,
    arguments: [
      tx.object(AGENT_REGISTRY_ID),
      tx.pure.string(params.suinsName),
      tx.pure.vector("string", params.capabilities),
    ],
  });

  return tx;
}

export interface RegisteredAgent {
  agentId: string;
  reputationId: string;
}

/** Reads both agent_id and reputation_id off AgentRegistered — no second query needed. */
export function extractRegisteredAgentFromResult(result: TxResultWithEvents): RegisteredAgent | null {
  const parsed = findEvent<{ agent_id?: string; reputation_id?: string }>(result, "::agent_identity::AgentRegistered");
  if (!parsed?.agent_id || !parsed?.reputation_id) return null;
  return { agentId: parsed.agent_id, reputationId: parsed.reputation_id };
}
