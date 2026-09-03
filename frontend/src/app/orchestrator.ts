// Real orchestrator driving the live status feed — every step is either
// REAL (an on-chain call or a live third-party API) or SCRIPTED (no real
// counterparty exists yet), labeled inline below.
//
// Signer model (see Onboarding.tsx's header for the full why): the "client"
// AgentIdentity on every Deal is Envoy's OWN identity, not the connected
// human wallet's. Sui only lets an owned object's owner pass it as a tx
// input, and mandate.move forbids a Mandate delegating to its own owner —
// so the only signer that can satisfy both "owns the client AgentIdentity"
// and "is the Mandate's delegate" is Envoy itself. That means every PTB
// touching the client side of a Deal (create, verify+release) is signed by
// envoyKeypair, never the connected wallet. The human wallet's only
// on-chain role is the Mandate it created once during onboarding — funding
// and capping what Envoy can spend, never signing a deal directly.
//
// Step-by-step reality:
//   1. searching / candidate-found — REAL: discoverAgents() against the
//      live on-chain AgentRegistry.
//   2. negotiating — REAL Gemini call (llm.ts's interpretGoal) to turn
//      the goal into a category the Mandate can check, plus a scripted
//      specialist reply (specialist-stand-ins.ts) — there is no real
//      autonomous counterparty agent to negotiate with.
//   3. mandate-check / escrow-locked — REAL PTB: custodia::deal::create_and_share
//      (ptb-escrow.ts), using onboarding.mandateId and Envoy's own
//      AgentIdentity (looked up fresh — see ensureEnvoyIdentity in
//      Onboarding.tsx). Signed by envoyKeypair.
//   4. work-in-progress — REAL: Seal-encrypts the deliverable, then
//      uploads the ciphertext via Walrus storeBlob().
//   5. verification — REAL call to the honestly-labeled Nautilus mock
//      (mockNautilusAttest()).
//   6. payment-released / reputation-updated — REAL PTBs: accept
//      (ptb-accept.ts), mark_delivered (ptb-deliver.ts) — both signed by
//      specialistKeypair, since deal.move requires the specialist
//      AgentIdentity's actual owner to sign, and the scripted specialist is
//      still not a real counterparty agent — then verify_and_release
//      (ptb-release.ts), signed by envoyKeypair since it owns the client
//      AgentIdentity used throughout this Deal.

import { dAppKit } from "../sui/dapp-kit";
import { envoyKeypair, ENVOY_ADDRESS } from "../sui/envoy-signer";
import { specialistKeypair, SPECIALIST_ADDRESS } from "../sui/specialist-signer";
import { discoverAgents } from "../agent/discovery";
import { interpretGoal } from "../agent/llm";
import { scriptedSpecialistReply, scriptedDeliverable } from "../agent/specialist-stand-ins";
import { storeBlob } from "../verification/walrus";
import { encryptDealContent } from "../verification/seal";
import { mockNautilusAttest } from "../verification/nautilus.mock";
import { buildLockEscrowAndCreateDealTx, extractDealIdFromResult } from "../sui/ptb-escrow";
import { buildCreateDealAllowlistTx, extractAllowlistIdFromEffects } from "../sui/ptb-deal-access";
import { buildAcceptDealTx } from "../sui/ptb-accept";
import { buildMarkDeliveredTx } from "../sui/ptb-deliver";
import { buildVerifyAndReleaseTx } from "../sui/ptb-release";
import { findOwnedAgentIdentity, findMandateDetails } from "../sui/onboarding-status";
import type { OnboardingResult } from "./Onboarding";
import type { DealReceipt, StatusStep } from "./types";

const STEP_DELAY_MS = 400;

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runOrchestratedDeal(
  goal: string,
  connectedAddress: string | undefined,
  onboarding: OnboardingResult,
  handlers: {
    onStepsChange: (steps: StatusStep[]) => void;
    onComplete: (receipt: DealReceipt) => void;
  },
): Promise<void> {
  const steps: StatusStep[] = [
    { id: "searching", state: "active", label: "Searching for candidates" },
    { id: "candidate-found", state: "pending", label: "Candidate found" },
    { id: "negotiating", state: "pending", label: "Negotiating terms" },
    { id: "mandate-check", state: "pending", label: "Checking mandate" },
    { id: "escrow-locked", state: "pending", label: "Escrow locked" },
    { id: "work-in-progress", state: "pending", label: "Work in progress" },
    { id: "verification", state: "pending", label: "Verifying delivery" },
    { id: "payment-released", state: "pending", label: "Payment released" },
    { id: "reputation-updated", state: "pending", label: "Reputation updated" },
  ];

  function emit() {
    handlers.onStepsChange([...steps]);
  }

  function fail(index: number, message: string): never {
    steps[index].state = "failed";
    steps[index].detail = message;
    emit();
    throw new Error(message);
  }

  emit();

  if (!connectedAddress) {
    fail(0, "No wallet connected — connect a Sui testnet wallet from the landing page first.");
  }

  // --- Step 1: real on-chain discovery ---------------------------------
  // The LLM's budget guess must respect the connected wallet's ACTUAL
  // on-chain Mandate limits, or mandate::assert_within_mandate aborts on
  // almost any real task (Gemini has no way to know the limits otherwise,
  // and guesses a real-world-realistic fee — see llm.ts's interpretGoal).
  // Two independent limits, per mandate.move's own doc comment
  // ("spendable() = min(remaining, funds)"): the authorization cap
  // (max_spend - spent_so_far) AND the actual custodied balance (funds) —
  // a Mandate can be authorized for more than it's actually funded with,
  // so checking only the cap isn't enough (that's exactly what produced
  // EInsufficientMandateFunds here: max_spend allowed 0.2 SUI but funds
  // only held 0.1 SUI). A 10% safety margin below the tighter of the two
  // accounts for spent_so_far not being zero on a reused Mandate.
  const mandate = await findMandateDetails(connectedAddress!, ENVOY_ADDRESS);
  if (!mandate) {
    fail(0, "No Mandate found for this account — complete onboarding first.");
  }
  const remainingAuthorizedMist = mandate.maxSpendMist - mandate.spentSoFarMist;
  const spendableMist = remainingAuthorizedMist < mandate.fundsMist ? remainingAuthorizedMist : mandate.fundsMist;
  // NOTE: no Math.max floor here — a floor would (and, in an earlier
  // version of this code, did) raise the ceiling back ABOVE what's
  // actually spendable once the Mandate ran low on funds, defeating the
  // whole point of this clamp and reproducing EInsufficientMandateFunds.
  // If there's truly nothing left to spend, fail with a clear message
  // instead of silently permitting an over-budget amount.
  const budgetCeilingSui = (Number(spendableMist) / 1_000_000_000) * 0.9;

  if (budgetCeilingSui < 0.001) {
    fail(
      0,
      `The connected Mandate has almost nothing left to spend (${(Number(spendableMist) / 1_000_000_000).toFixed(4)} SUI remaining) — fund it further or create a new Mandate.`,
    );
  }

  let interpreted;
  try {
    interpreted = await interpretGoal(goal, budgetCeilingSui);
  } catch (err) {
    fail(0, `Goal interpretation failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Filtered to SPECIALIST_ADDRESS: deal.move requires the specialist
  // AgentIdentity's actual owner to sign accept()/mark_delivered(), and
  // specialistKeypair is the only specialist identity this demo can
  // actually sign as (see scripts/seed-specialist.mjs). A real discovery
  // flow would pick the best-ranked candidate regardless of owner and hand
  // signing off to that agent's own service — not buildable here since
  // there's no real counterparty agent yet.
  const allCandidates = await discoverAgents({ capability: interpreted.category });
  const candidates = allCandidates.filter((c) => c.owner === SPECIALIST_ADDRESS);

  if (candidates.length === 0) {
    fail(
      1,
      `No signable demo specialist registered for category "${interpreted.category}" — run scripts/seed-specialist.mjs first.`,
    );
  }

  steps[0].state = "done";
  const candidate = candidates[0];
  steps[1].state = "done";
  steps[1].detail = {
    agentId: candidate.agentId,
    suinsName: candidate.suinsName,
    reputationScore: candidate.reputationScore,
  };
  steps[2].state = "active";
  emit();

  // --- Step 2: scripted negotiation (no real counterparty agent) -------
  const reply = scriptedSpecialistReply(goal, interpreted.category);
  steps[2].state = "done";
  steps[2].detail = `${reply.message} (scripted specialist reply — no real counterparty agent)`;
  steps[3].state = "active";
  emit();
  await wait(STEP_DELAY_MS);

  // --- Steps 3-4: REAL PTB #1 -------------------------------------------
  // onboarding.mandateId was created once during Onboarding.tsx, delegating
  // to Envoy. Signed by envoyKeypair, not the connected wallet — see the
  // file header. Envoy's own AgentIdentity was registered once during
  // onboarding too (ensureEnvoyIdentity) — look it up fresh rather than
  // threading it through OnboardingResult, since it's Envoy's, not tied to
  // any particular user session.
  const mandateId = onboarding.mandateId;
  const envoyAgent = await findOwnedAgentIdentity(ENVOY_ADDRESS, "client");
  if (!envoyAgent) {
    fail(3, "Envoy has no registered AgentIdentity yet — this should have been created during onboarding.");
  }

  steps[3].state = "done";
  steps[3].detail = `Checking against Mandate ${mandateId}`;
  steps[4].state = "active";
  emit();

  let dealId: string;
  let stageDeadlineMs: bigint;
  try {
    const tx = buildLockEscrowAndCreateDealTx({
      mandateId,
      clientAgentIdentityId: envoyAgent.agentId,
      specialistAgentId: candidate.agentId,
      category: interpreted.category,
      amount: BigInt(Math.round(interpreted.maxBudget * 1_000_000_000)),
      deliveryWindowMs: BigInt(24 * 60 * 60 * 1000),
      reviewWindowMs: BigInt(24 * 60 * 60 * 1000),
    });
    const result = await envoyKeypair.signAndExecuteTransaction({ transaction: tx, client: dAppKit.getClient() });
    if (result.FailedTransaction) {
      throw new Error(result.FailedTransaction.status.error?.message ?? "PTB #1 failed");
    }
    const extracted = await extractDealIdFromResult(dAppKit.getClient(), result);
    if (!extracted) {
      throw new Error("create_and_share succeeded but no DealCreated event was found in the result.");
    }
    dealId = extracted.dealId;
    stageDeadlineMs = extracted.stageDeadlineMs;
  } catch (err) {
    fail(4, `Escrow lock failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  steps[4].state = "done";
  steps[4].detail = `Deal ${dealId} created and escrowed on-chain`;
  steps[5].state = "active";
  steps[5].detail = "Setting up Seal access control for the deliverable…";
  emit();

  // --- REAL PTB: create the Seal DealAllowlist for this Deal -----------
  // Must happen after the Deal exists (deal_access::new_for_deal reads the
  // Deal's party owners) and before encrypting the deliverable (encryption
  // needs the allowlist's object id as the Seal identity namespace).
  let allowlistId: string;
  try {
    const allowlistTx = buildCreateDealAllowlistTx({ dealId });
    const allowlistResult = await dAppKit.signAndExecuteTransaction({ transaction: allowlistTx });
    if (allowlistResult.FailedTransaction) {
      throw new Error(allowlistResult.FailedTransaction.status.error?.message ?? "Allowlist creation failed");
    }
    const extracted = extractAllowlistIdFromEffects(allowlistResult.Transaction.effects);
    if (!extracted) {
      throw new Error("new_and_share succeeded but no newly-created shared object was found in its effects.");
    }
    allowlistId = extracted;
  } catch (err) {
    fail(5, `Seal allowlist setup failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  steps[5].state = "active";
  steps[5].detail = "Encrypting deliverable with Seal, then uploading to Walrus testnet…";
  emit();

  // --- Step 5: REAL Seal encryption + Walrus storage --------------------
  // Genuinely encrypted, not stored in the clear: only the client and
  // specialist owner addresses on this Deal's DealAllowlist can ever
  // decrypt this blob (see verification/seal.ts).
  const deliverable = scriptedDeliverable(goal, interpreted.category);
  let blobId: string;
  let seedId: string;
  try {
    const encrypted = await encryptDealContent(
      new TextEncoder().encode(deliverable.content),
      dAppKit.getClient(),
      allowlistId,
    );
    seedId = encrypted.seedId;
    const stored = await storeBlob(encrypted.encryptedObject);
    blobId = stored.blobId;
  } catch (err) {
    fail(5, `Seal encryption / Walrus storage failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  steps[5].state = "done";
  steps[5].detail = `Encrypted with Seal · stored on Walrus · blob ${blobId}`;
  steps[6].state = "active";
  emit();

  // --- Step 6: REAL Nautilus mock attestation ---------------------------
  const attestation = await mockNautilusAttest(dealId, new TextEncoder().encode(deliverable.content));

  steps[6].state = "done";
  steps[6].detail = { mocked: attestation.mocked, attestationId: attestation.attestationId };
  steps[7].state = "active";
  emit();

  // --- Steps 7-8: REAL PTBs — deliver, then verify+release --------------
  try {
    const acceptTx = buildAcceptDealTx({
      dealId,
      specialistAgentIdentityId: candidate.agentId,
      // The REAL on-chain deadline from DealCreated, not a fresh
      // Date.now()-based guess — deal::accept requires an exact match
      // (ETermsMismatch aborts otherwise) against deal.stage_deadline_ms,
      // which was computed with the on-chain Clock at creation time.
      deliveryDeadlineMs: stageDeadlineMs,
      amount: BigInt(Math.round(interpreted.maxBudget * 1_000_000_000)),
    });
    const acceptResult = await specialistKeypair.signAndExecuteTransaction({
      transaction: acceptTx,
      client: dAppKit.getClient(),
    });
    // signAndExecuteTransaction never throws on a Move abort — it returns
    // a FailedTransaction result instead (same discriminated union as
    // releaseResult below). This was silently ignored before: a failed
    // accept() left the deal at Escrowed, and mark_delivered then aborted
    // with an unrelated-looking EInvalidTransition (Escrowed -> Delivered
    // isn't a legal edge), masking the real accept() failure entirely.
    if (acceptResult.FailedTransaction) {
      throw new Error(acceptResult.FailedTransaction.status.error?.message ?? "accept() failed");
    }
    // The next PTB re-fetches the Deal's current object/status to build
    // mark_delivered — accept()'s executeTransaction resolving does not
    // guarantee that read sees accept()'s effects yet (testnet's fullnode
    // gateway fronts multiple nodes with no cross-request read-your-writes
    // guarantee). Without this wait, mark_delivered could be built against a
    // node that still reports the pre-accept "Escrowed" status, so
    // assert_transition(Escrowed -> Delivered) aborts with EInvalidTransition
    // even though accept() genuinely succeeded — this was confirmed on-chain
    // (deal stuck at Accepted, mark_delivered aborting every time).
    await dAppKit.getClient().core.waitForTransaction({ result: acceptResult });

    const deliverTx = buildMarkDeliveredTx({
      dealId,
      specialistAgentIdentityId: candidate.agentId,
      storageId: blobId,
      attestationId: attestation.attestationId,
    });
    const deliverResult = await specialistKeypair.signAndExecuteTransaction({
      transaction: deliverTx,
      client: dAppKit.getClient(),
    });
    if (deliverResult.FailedTransaction) {
      throw new Error(deliverResult.FailedTransaction.status.error?.message ?? "mark_delivered() failed");
    }
    // Same cross-request read-after-write gap as above, between
    // mark_delivered and verify_and_release.
    await dAppKit.getClient().core.waitForTransaction({ result: deliverResult });

    const releaseTx = buildVerifyAndReleaseTx({
      dealId,
      clientAgentIdentityId: envoyAgent.agentId,
      clientReputationId: envoyAgent.reputationId,
      specialistReputationId: candidate.reputationId,
    });
    const releaseResult = await envoyKeypair.signAndExecuteTransaction({
      transaction: releaseTx,
      client: dAppKit.getClient(),
    });
    if (releaseResult.FailedTransaction) {
      throw new Error(releaseResult.FailedTransaction.status.error?.message ?? "PTB #2 failed");
    }
  } catch (err) {
    fail(7, `Delivery/release failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  steps[7].state = "done";
  steps[8].state = "active";
  emit();
  await wait(STEP_DELAY_MS);

  steps[8].state = "done";
  emit();

  handlers.onComplete({
    dealId,
    amount: interpreted.maxBudget,
    counterpartyName: candidate.suinsName,
    verification: { mocked: attestation.mocked, attestationId: attestation.attestationId },
    deliverable: { blobId, allowlistId, seedId },
  });
}
