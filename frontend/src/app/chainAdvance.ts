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
      id: crypto.randomUUID(),
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
    return { kind: "text", id: crypto.randomUUID(), role: "assistant", text: summary, threadId };
  } catch (err) {
    return {
      kind: "text",
      id: crypto.randomUUID(),
      role: "assistant",
      text: `Delivery proof exists on-chain (Walrus blob ${proof.storageId}) but could not be decrypted for a summary: ${err instanceof Error ? err.message : String(err)}`,
      threadId,
    };
  }
}

// Module-level, not component state: every mounted DealProgress instance
// for every leg of every chain shares this ONE set, in this one browser
// tab. This is the real fix for a bug this session hit twice — first
// overlapping poll ticks within a single component racing itself, then
// (after a narrower per-turn fix) multiple STALE component instances
// (leftover leg-1 renders, e.g. duplicated saved-history turns, or
// simply React not having unmounted an old instance yet) each
// independently deciding "no real next leg exists yet, I should create
// one" and every one of them doing so — the repair specialist getting 3
// separate real escrow offers for one chain. A boolean derived from
// `turns` (however carefully computed) can never be a reliable lock,
// because it's recomputed independently by every instance on every
// render with no shared "someone is already doing this" signal between
// them. A lock actually is that signal: only the FIRST caller for a
// given chainId proceeds; every other caller — no matter which stale
// component instance it came from — returns immediately.
const chainsCurrentlyAdvancing = new Set<string>();

// A THIRD real bug this exact lock did NOT prevent: once a leg's proof
// exists but advancing genuinely fails for a real, non-transient reason
// (confirmed live this session: "The connected Mandate has almost
// nothing left to spend"), the lock is released in `finally` so the
// NEXT poll tick (4s later) just tries again — and again, forever, since
// nothing here distinguishes "worth retrying" from "will never succeed
// until the user does something about it" (funding the Mandate). Every
// one of those retries also re-posted a duplicate proof summary AND
// created a fresh, separately-failed "next leg" turn, producing the
// pile of duplicate cards and repeated chat messages actually observed.
// Track failures per dealId (the CURRENT leg whose proof triggered the
// advance attempt) so a real failure is surfaced once, not retried
// silently in an infinite loop.
const dealsWithFailedAdvance = new Map<string, string>(); // dealId -> error message

// Summary posting is idempotent per dealId — once a leg's proof has been
// summarized and posted to chat, it must never be posted again, even if
// the advance that follows it keeps failing and retrying.
const dealsWithPostedSummary = new Set<string>();

/** Gates and creates the next leg of a chain once the CURRENT latest
 * leg's proof exists. No-ops (does nothing, returns without calling
 * `onTurnsChange`) when there's no proof yet, or when this chainId is
 * already mid-advance from another call (see chainsCurrentlyAdvancing
 * above).
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

  // A real, persisted stop — see ChainInfo.ended's own comment. Checked
  // first, before anything else, so an ended chain never even reads
  // chain state again.
  if (chain.ended) return;

  // A previous attempt for THIS leg already failed for a real,
  // non-transient reason (e.g. the Mandate ran out of funds) — do not
  // retry silently forever. The user needs to act (fund the Mandate,
  // etc.) and re-trigger, not watch duplicate failed cards pile up every
  // 4 seconds. See the module-level comment on dealsWithFailedAdvance.
  if (dealsWithFailedAdvance.has(pending.dealId)) return;

  if (chainsCurrentlyAdvancing.has(chain.chainId)) return;

  const proof = await findProofForDeal(pending.dealId);
  if (!proof) return;

  // Lock acquired only once we know there's real work to do (a proof
  // exists) — held for the ENTIRE remainder of this call, including the
  // full escrow transaction for the next leg, not just the synchronous
  // part.
  chainsCurrentlyAdvancing.add(chain.chainId);
  try {
    // Idempotent per dealId — without this check, every failed-and-
    // retried advance attempt re-posted an identical proof summary to
    // chat, which is what produced the repeated "Delivery proof exists
    // on-chain... could not be decrypted" messages actually observed.
    if (!dealsWithPostedSummary.has(pending.dealId)) {
      dealsWithPostedSummary.add(pending.dealId);
      const summaryTurn = await summarizeAndPostProof(pending, task, threadId);
      onTurnsChange((prev) => [...prev, summaryTurn]);
    }

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

    try {
      await createDealAndEscrow(
        nextLeg.taskDescription,
        connectedAddress,
        onboarding,
        {
          onStepsChange: (steps: StatusStep[]) => {
            onTurnsChange((prev) => prev.map((t) => (t.kind === "deal" && t.id === nextLegId ? { ...t, steps } : t)));
          },
          onEscrowed: (legPending: PendingRelease) => {
            onTurnsChange((prev) => prev.map((t) => (t.kind === "deal" && t.id === nextLegId ? { ...t, pending: legPending } : t)));
          },
        },
        // Category is already decided — start_deal_chain (chat.ts) chose it
        // for every leg up front. Without forcing it here, Gemini
        // independently re-classifying this leg's taskDescription could (and
        // did, in this session) land on a DIFFERENT category than the one
        // the chain actually planned, matching the wrong specialist type.
        nextLeg.category,
      );
    } catch (err) {
      // Remember this failure against the CURRENT leg's dealId (not the
      // new leg's — the new leg's own turn already shows its own failed
      // step via onStepsChange/orchestrator.ts's fail()) so the next
      // poll tick stops retrying instead of creating yet another dead
      // "next leg" turn every 4 seconds. Re-thrown so the caller's own
      // catch (ChatPanel.tsx's poll()) still logs it once, same as before.
      dealsWithFailedAdvance.set(pending.dealId, err instanceof Error ? err.message : String(err));
      throw err;
    }
  } finally {
    chainsCurrentlyAdvancing.delete(chain.chainId);
  }
}
