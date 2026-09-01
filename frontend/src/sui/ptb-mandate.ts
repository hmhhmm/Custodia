// Creates and funds a Mandate — targets custodia::mandate::create_funded_and_share.
//
// A Mandate cannot delegate to its own owner (see mandate.move's `new()`
// assertion) — the caller must pass a DIFFERENT address as `delegate` than
// the signer.

import { Transaction } from "@mysten/sui/transactions";
import { PACKAGE_ID } from "./config";

export function buildCreateFundedMandateTx(params: {
  delegate: string; // must differ from the signer's own address
  maxSpend: bigint; // in MIST
  allowedCategories: string[]; // exact-match, case-sensitive against Deal categories
  expiresAtMs: bigint;
  fundingAmount: bigint; // in MIST — split from gas coin
}): Transaction {
  const tx = new Transaction();

  const [funding] = tx.splitCoins(tx.gas, [tx.pure.u64(params.fundingAmount)]);

  tx.moveCall({
    target: `${PACKAGE_ID}::mandate::create_funded_and_share`,
    arguments: [
      tx.pure.address(params.delegate),
      tx.pure.u64(params.maxSpend),
      tx.pure.vector("string", params.allowedCategories),
      tx.pure.u64(params.expiresAtMs),
      funding,
    ],
  });

  return tx;
}
