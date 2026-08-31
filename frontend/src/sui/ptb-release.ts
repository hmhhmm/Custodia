// Owner: Person 2 (transaction layer).
// STATUS: implemented against custodia::deal::verify_and_release (deployed 2026-08-31).

import { Transaction } from '@mysten/sui/transactions';

const PACKAGE_ID = import.meta.env.VITE_CUSTODIA_PACKAGE_ID;
const AGENT_REGISTRY_ID = import.meta.env.VITE_AGENT_REGISTRY_ID;

// PTB #2 — verify-and-release-and-update-reputation.
// CLIENT-ONLY per move/sources/deal.move: the client's signature is the
// acceptance step. Returns nothing — verify_and_release pins the payee and
// pays the specialist directly (see deal.move header comment on why).
export function buildVerifyAndReleaseTx(params: {
  dealId: string;
  clientAgentIdentityId: string;
  clientReputationId: string;
  specialistReputationId: string;
}): Transaction {
  const tx = new Transaction();

  tx.moveCall({
    target: `${PACKAGE_ID}::deal::verify_and_release`,
    arguments: [
      tx.object(params.dealId),                  // &mut Deal
      tx.object(AGENT_REGISTRY_ID),               // &AgentRegistry
      tx.object(params.clientAgentIdentityId),    // &AgentIdentity (client)
      tx.object(params.clientReputationId),       // &mut Reputation (client)
      tx.object(params.specialistReputationId),   // &mut Reputation (specialist)
    ],
  });

  return tx;
}