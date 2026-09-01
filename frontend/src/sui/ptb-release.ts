// PTB #2: verify delivery, release escrow, update reputation — targets
// custodia::deal::verify_and_release.
//
// Client-signed: the client's signature is the acceptance step. Returns
// nothing — verify_and_release pins the payee and pays the specialist
// directly (see deal.move).

import { Transaction } from "@mysten/sui/transactions";
import { PACKAGE_ID, AGENT_REGISTRY_ID } from "./config";

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
      tx.object(params.dealId), // &mut Deal
      tx.object(AGENT_REGISTRY_ID), // &AgentRegistry
      tx.object(params.clientAgentIdentityId), // &AgentIdentity (client)
      tx.object(params.clientReputationId), // &mut Reputation (client)
      tx.object(params.specialistReputationId), // &mut Reputation (specialist)
    ],
  });

  return tx;
}
