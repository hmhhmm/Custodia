// Client-side release step — called once a Deal has reached Delivered (a
// real specialist accepted and delivered from their own inbox). Signs
// verify_and_release with envoyKeypair, same reasoning as orchestrator.ts:
// Envoy owns the client AgentIdentity used throughout the Deal, so it's the
// only signer that can call this. This is a separate, later action from
// escrow lock — not a continuation of the same synchronous call — because a
// real specialist isn't sitting there waiting to auto-sign.

import { dAppKit } from "../sui/dapp-kit";
import { envoyKeypair, ENVOY_ADDRESS } from "../sui/envoy-signer";
import { buildVerifyAndReleaseTx } from "../sui/ptb-release";
import { findDealById, findProofForDeal, findAllowlistForDeal } from "../sui/deal-queries";
import { findOwnedAgentIdentity } from "../sui/onboarding-status";
import { findAgentById } from "../agent/discovery";
import type { DealReceipt, PendingRelease } from "./types";

/** Rebuilds a PendingRelease from just a dealId — everything else
 * (client/specialist agent+reputation ids, specialist's owner address,
 * the Seal allowlist) is re-readable from chain via the AgentRegistry and
 * the Deal object itself. This is what lets the Deals tab recover a deal's
 * release button after a page refresh, when the in-memory
 * ConversationTurn that originally carried this info is long gone —
 * ChatPanel's turns are UI-only chat history, never the source of truth
 * for what's actually needed to call verify_and_release. */
export async function reconstructPendingRelease(dealId: string): Promise<PendingRelease | null> {
  const deal = await findDealById(dealId);
  if (!deal) return null;

  const envoyAgent = await findOwnedAgentIdentity(ENVOY_ADDRESS, "client");
  if (!envoyAgent) return null;

  const specialist = await findAgentById(deal.specialistAgent);
  if (!specialist) return null;

  const allowlistId = await findAllowlistForDeal(dealId);
  if (!allowlistId) return null;

  return {
    dealId,
    counterpartyName: specialist.suinsName,
    amountSui: Number(deal.escrowedAmountMist) / 1_000_000_000,
    clientAgentIdentityId: envoyAgent.agentId,
    clientReputationId: envoyAgent.reputationId,
    specialistReputationId: specialist.reputationId,
    specialistOwnerAddress: specialist.owner,
    allowlistId,
    seedId: "",
  };
}

/** Re-queries the specialist's live SUI balance around the release call so
 * the receipt can show a BEFORE/AFTER on-chain fact, not just trust that
 * DealReleased fired — proves payment actually landed, not merely that the
 * transaction didn't abort. */
async function fetchBalanceMist(owner: string): Promise<bigint> {
  const result = await dAppKit.getClient().core.getBalance({ owner, coinType: "0x2::sui::SUI" });
  return BigInt(result.balance.balance);
}

export type ReleaseProgressStage =
  | "checking-proof"
  | "reading-balance-before"
  | "signing"
  | "confirming"
  | "verifying-balance";

/** `onProgress`, when given, is called once per real stage below — no
 * stage here is an LLM call (this file never touches Gemini); every one
 * is a real on-chain read or the release transaction's own signing/
 * confirmation, so the wait a user sees on "Verify & Release Payment" is
 * blockchain confirmation time, never a hidden AI step. Surfacing that
 * distinction was explicit feedback: the button previously showed a bare
 * "Releasing…" for however long all four stages took combined. */
export async function releaseDeal(pending: PendingRelease, onProgress?: (stage: ReleaseProgressStage) => void): Promise<DealReceipt> {
  onProgress?.("checking-proof");
  const proof = await findProofForDeal(pending.dealId);
  if (!proof) {
    throw new Error("No delivery proof found for this deal yet — the specialist hasn't marked it delivered.");
  }

  onProgress?.("reading-balance-before");
  const balanceBefore = await fetchBalanceMist(pending.specialistOwnerAddress);

  const tx = buildVerifyAndReleaseTx({
    dealId: pending.dealId,
    clientAgentIdentityId: pending.clientAgentIdentityId,
    clientReputationId: pending.clientReputationId,
    specialistReputationId: pending.specialistReputationId,
  });
  onProgress?.("signing");
  const result = await envoyKeypair.signAndExecuteTransaction({ transaction: tx, client: dAppKit.getClient() });
  if (result.FailedTransaction) {
    throw new Error(result.FailedTransaction.status.error?.message ?? "verify_and_release() failed");
  }
  onProgress?.("confirming");
  await dAppKit.getClient().core.waitForTransaction({ result });

  // Real proof payment landed, not just "the tx didn't abort" — read the
  // specialist's balance again and require it to have actually increased.
  onProgress?.("verifying-balance");
  const balanceAfter = await fetchBalanceMist(pending.specialistOwnerAddress);
  if (balanceAfter <= balanceBefore) {
    throw new Error(
      `verify_and_release() succeeded on-chain, but the specialist's balance did not increase (before: ${balanceBefore}, after: ${balanceAfter} MIST) — investigate before trusting this release.`,
    );
  }

  return {
    dealId: pending.dealId,
    amount: pending.amountSui,
    counterpartyName: pending.counterpartyName,
    verification: { mocked: true, attestationId: proof.storageId },
    deliverable: { blobId: proof.storageId, allowlistId: pending.allowlistId, seedId: proof.seedId, file: proof.file },
  };
}
