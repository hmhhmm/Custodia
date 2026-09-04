// Drives a multi-agent chain forward once a leg's real on-chain delivery
// proof exists — see types.ts's ChainInfo and orchestrator.ts's
// createDealChain for the rest of the story. Two responsibilities, always
// exercised together from the same "a proof now exists" observation:
//
//   1. Summarize that leg's REAL decrypted proof content back to the user
//      in chat (summarizeAndPostProof) — never fabricated, degrades
//      honestly to the raw notes if Gemini is unreachable.
//   2. If the chain isn't done yet, escrow the NEXT leg (tryAdvanceChain).
//
// Gating is always a fresh on-chain read (findProofForDeal), never
// trusted in-memory state — same "always re-derive from chain" principle
// reconstructPendingRelease and ChatPanel.tsx's DealProgress self-heal
// already established this session, so a mid-chain page refresh can
// never strand the chain.

import { dAppKit } from "../sui/dapp-kit";
import { envoyKeypair } from "../sui/envoy-signer";
import { findProofForDeal } from "../sui/deal-queries";
import { readBlob } from "../verification/walrus";
import { decryptDealContent } from "../verification/seal";
import { summarizeProofContent } from "../agent/llm";
import { createDealAndEscrow } from "./orchestrator";
import type { OnboardingResult } from "./Onboarding";
import type { ChainInfo, ConversationTurn, PendingRelease, StatusStep } from "./types";

/** Decrypts a leg's real delivery proof with Envoy's own signer (no
 * connected-wallet click needed — envoyKeypair is an Ed25519Keypair and
 * satisfies the Signer interface directly, same object already used for
 * every other client-side signed call in this app) and asks Gemini for a
 * plain-language summary, posted back into the chain's own thread.
 *
 * Never silently drops the update: if decryption itself fails, still
 * returns a turn — a plain factual sentence rather than a fabricated
 * summary, per this codebase's rule against presenting a degraded result
 * as indistinguishable from a real one. */
export async function summarizeAndPostProof(
  pending: PendingRelease,
  legDescription: string,
  threadId: string,
): Promise<ConversationTurn> {
  const proof = await findProofForDeal(pending.dealId);
  if (!proof) {
    // Should not happen — callers only invoke this once findProofForDeal
    // has already confirmed a proof exists — but stay honest if it does.
    return {
      kind: "text",
      role: "assistant",
      text: `Delivery proof for "${legDescription}" was expected but could not be found on-chain.`,
      threadId,
    };
  }

  try {
    const encrypted = await readBlob(proof.storageId);
    const decrypted = await decryptDealContent(encrypted, dAppKit.getClient(), pending.allowlistId, proof.seedId, envoyKeypair);
    const deliverableText = new TextDecoder().decode(decrypted);
    const summary = await summarizeProofContent(deliverableText, legDescription);
    return { kind: "text", role: "assistant", text: summary, threadId };
  } catch (err) {
    return {
      kind: "text",
      role: "assistant",
      text: `Delivery proof exists on-chain (Walrus blob ${proof.storageId}) but could not be decrypted for a summary: ${err instanceof Error ? err.message : String(err)}`,
      threadId,
    };
  }
}

/** Gates and creates the next leg of a chain once the CURRENT latest
 * leg's proof exists. No-ops (does nothing, returns without calling
 * `onTurnsChange`) when there's no proof yet.
 *
 * Takes exactly the fields it needs from the latest leg's turn — `task`
 * (for the summary prompt's context), `threadId`, `pending`, and `chain`
 * — rather than a full ConversationTurn, since the caller (ChatPanel.tsx's
 * DealProgress) has no real turn `id`/`steps`/`receipt` to hand over at
 * the point it polls this.
 *
 * Pushes updates through `onTurnsChange` live as they happen (appending
 * the summary turn, then the new leg turn, then updating that leg turn's
 * steps/pending as escrow progresses) rather than buffering everything
 * until this whole async call resolves — createDealAndEscrow's own
 * onStepsChange/onEscrowed handlers already fire multiple times over a
 * period of seconds for the live step-by-step feed, and buffering them
 * would silently throw that live progress away for a chain's later legs,
 * an inconsistency with how leg 0 (started directly from ChatPanel's
 * handleSubmit) already renders. */
export async function tryAdvanceChain(
  latestLeg: { task: string; threadId: string; pending: PendingRelease; chain: ChainInfo },
  connectedAddress: string | undefined,
  onboarding: OnboardingResult,
  onTurnsChange: (update: (prev: ConversationTurn[]) => ConversationTurn[]) => void,
): Promise<void> {
  const { chain, pending, task, threadId } = latestLeg;

  const proof = await findProofForDeal(pending.dealId);
  if (!proof) return;

  const summaryTurn = await summarizeAndPostProof(pending, task, threadId);
  onTurnsChange((prev) => [...prev, summaryTurn]);

  if (chain.remainingLegs.length === 0) return;

  const [nextLeg, ...restLegs] = chain.remainingLegs;
  const nextLegId = crypto.randomUUID();
  const nextChain: ChainInfo = {
    chainId: chain.chainId,
    legIndex: chain.legIndex + 1,
    legTotal: chain.legTotal,
    remainingLegs: restLegs,
  };

  onTurnsChange((prev) => [
    ...prev,
    {
      kind: "deal",
      id: nextLegId,
      task: nextLeg.taskDescription,
      steps: [],
      receipt: null,
      pending: null,
      threadId,
      chain: nextChain,
    },
  ]);

  await createDealAndEscrow(nextLeg.taskDescription, connectedAddress, onboarding, {
    onStepsChange: (steps: StatusStep[]) => {
      onTurnsChange((prev) => prev.map((t) => (t.kind === "deal" && t.id === nextLegId ? { ...t, steps } : t)));
    },
    onEscrowed: (legPending: PendingRelease) => {
      onTurnsChange((prev) => prev.map((t) => (t.kind === "deal" && t.id === nextLegId ? { ...t, pending: legPending } : t)));
    },
  });
}
