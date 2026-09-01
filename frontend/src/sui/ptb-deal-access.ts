// Owner: Person 2 (transaction layer).
// STATUS: implemented against custodia::deal_access::new_and_share
// (deployed 2026-08-31, see move/sources/deal_access.move). Added
// 2026-09-01 alongside wiring real Seal encryption into the orchestrator
// — flagging per CLAUDE.md rule 4.
//
// new_and_share does not emit an event carrying the new DealAllowlist's
// object id (confirmed by reading deal_access.move — only DealCreated-style
// events exist elsewhere in the package, this module has none). Adding one
// would require rebuilding and republishing the Move package, which this
// environment cannot do (no `sui` CLI installed here — VERIFY this is
// still true in whichever environment runs this next, and if a CLI is
// available, prefer adding a DealAllowlistCreated event and simplifying
// this to an event read, matching every other extract*FromResult in this
// codebase).
//
// Until then: the allowlist id is read off the transaction's effects
// instead. `new_and_share` creates exactly one object and shares it in the
// same call, so the single `changedObjects` entry with
// `idOperation: 'Created'` and `outputOwner.$kind === 'Shared'` is
// unambiguously the new DealAllowlist — verified against the real
// TransactionEffects/ChangedObject/SharedOwner shapes in the installed
// @mysten/sui package's own .d.mts files, not assumed.

import { Transaction } from '@mysten/sui/transactions';
import type { SuiClientTypes } from '@mysten/sui/client';

const PACKAGE_ID = import.meta.env.VITE_CUSTODIA_PACKAGE_ID;
const AGENT_REGISTRY_ID = import.meta.env.VITE_AGENT_REGISTRY_ID;

export function buildCreateDealAllowlistTx(params: { dealId: string }): Transaction {
  const tx = new Transaction();

  tx.moveCall({
    target: `${PACKAGE_ID}::deal_access::new_and_share`,
    arguments: [tx.object(params.dealId), tx.object(AGENT_REGISTRY_ID)],
  });

  return tx;
}

export function extractAllowlistIdFromEffects(effects: SuiClientTypes.TransactionEffects): string | null {
  const created = effects.changedObjects.find(
    (obj: SuiClientTypes.ChangedObject) => obj.idOperation === 'Created' && obj.outputOwner?.$kind === 'Shared',
  );
  return created?.objectId ?? null;
}
