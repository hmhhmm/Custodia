// Owner: Person 4 (frontend + orchestration).
//
// Real orchestrator driving the live status feed. Replaces
// demoStatusSequence.ts's fully-scripted version. Every step below is
// documented as REAL or SCRIPTED, honestly — do not read "connected to
// the frontend" as "produces a successful demo end-to-end without a
// funded wallet," because it does not: PTB steps require the connected
// wallet to actually hold SUI and a Mandate to draw from, which is
// infrastructure outside what a frontend can fabricate.
//
// Step-by-step reality:
//   1. searching / candidate-found — REAL: calls discovery.ts's
//      discoverAgents() against the live on-chain AgentRegistry. Today
//      that registry has ZERO registered agents (verified live via
//      GraphQL this session), so this will legitimately return nothing
//      until an agent is registered — see the empty-registry handling
//      below, which surfaces that honestly instead of faking a result.
//   2. negotiating — REAL Gemini call (llm.ts's interpretGoal) to turn
//      the goal into a category the Mandate can check, plus a scripted
//      specialist reply (specialist-stand-ins.ts) — there is no real
//      autonomous counterparty agent to negotiate with.
//   3. mandate-check / escrow-locked — REAL PTB: builds and submits
//      custodia::deal::create_and_share via the connected wallet
//      (ptb-escrow.ts). Requires: a real Mandate object owned by the
//      connected account, with enough custodied `funds` and an
//      `allowed_categories` entry matching step 2's category exactly
//      (case-sensitive — see llm.ts's comment on why this matters). The
//      client's AgentIdentity/Reputation IDs come from the `onboarding`
//      param (Onboarding.tsx), not the connected address — an address is
//      not an object ID, and an earlier version of this file conflated
//      the two (confirmed live bug, fixed alongside Onboarding.tsx).
//      There is currently no UI to create a Mandate other than the
//      Onboarding screen, so this step will genuinely fail for any
//      account that skipped it — surfaced as a real error, not swallowed.
//   4. work-in-progress — REAL: Walrus storeBlob() (unchanged from
//      demoStatusSequence.ts, already verified live).
//   5. verification — REAL: Nautilus mockNautilusAttest() (unchanged,
//      already verified live, honestly labeled mocked).
//   6. payment-released / reputation-updated — REAL PTBs: accept
//      (ptb-accept.ts), mark_delivered (ptb-deliver.ts), then
//      verify_and_release (ptb-release.ts, using onboarding.clientAgent's
//      IDs and the discovered candidate's real reputationId — see
//      discovery.ts). Same funded-wallet requirement as step 3.

import { dAppKit } from "../sui/dapp-kit";
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
  let interpreted;
  try {
    interpreted = await interpretGoal(goal);
  } catch (err) {
    fail(0, `Goal interpretation failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  const candidates = await discoverAgents({ capability: interpreted.category });

  if (candidates.length === 0) {
    fail(
      1,
      `No agents registered on-chain for category "${interpreted.category}" — the AgentRegistry is genuinely empty right now. Register a demo agent via custodia::agent_identity::register_and_keep before this can find a real candidate.`,
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
  // Requires a real Mandate owned by connectedAddress. There is no UI
  // yet to create one, so this will genuinely throw for any account
  // without a pre-existing Mandate — that is correct behavior, not a bug
  // to paper over.
  const mandateId = import.meta.env.VITE_DEMO_MANDATE_ID;
  if (!mandateId) {
    fail(
      3,
      "No Mandate configured (VITE_DEMO_MANDATE_ID is unset) — a real Mandate object must exist and be owned by the connected wallet before PTB #1 can run. There is no UI to create one yet.",
    );
  }

  steps[3].state = "done";
  steps[3].detail = `Checking against Mandate ${mandateId}`;
  steps[4].state = "active";
  emit();

  let dealId: string;
  try {
    const tx = buildLockEscrowAndCreateDealTx({
      mandateId,
      clientAgentIdentityId: onboarding.clientAgent.agentId,
      specialistAgentId: candidate.agentId,
      category: interpreted.category,
      amount: BigInt(Math.round(interpreted.maxBudget * 1_000_000_000)),
      deliveryWindowMs: BigInt(24 * 60 * 60 * 1000),
      reviewWindowMs: BigInt(24 * 60 * 60 * 1000),
    });
    const result = await dAppKit.signAndExecuteTransaction({ transaction: tx });
    if (result.FailedTransaction) {
      throw new Error(result.FailedTransaction.status.error?.message ?? "PTB #1 failed");
    }
    const extracted = extractDealIdFromResult(result.Transaction ?? {});
    if (!extracted) {
      throw new Error("create_and_share succeeded but no DealCreated event was found in the result.");
    }
    dealId = extracted;
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
  // needs the allowlist's object id as the Seal identity namespace) — see
  // seal.ts's file header for the full design-gap note this resolves for
  // the deliverable (step 8), as opposed to pre-Deal negotiation content.
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
      deliveryDeadlineMs: BigInt(Date.now() + 24 * 60 * 60 * 1000),
      amount: BigInt(Math.round(interpreted.maxBudget * 1_000_000_000)),
    });
    await dAppKit.signAndExecuteTransaction({ transaction: acceptTx });

    const deliverTx = buildMarkDeliveredTx({
      dealId,
      specialistAgentIdentityId: candidate.agentId,
      storageId: blobId,
      attestationId: attestation.attestationId,
    });
    await dAppKit.signAndExecuteTransaction({ transaction: deliverTx });

    const releaseTx = buildVerifyAndReleaseTx({
      dealId,
      clientAgentIdentityId: onboarding.clientAgent.agentId,
      clientReputationId: onboarding.clientAgent.reputationId,
      specialistReputationId: candidate.reputationId,
    });
    const releaseResult = await dAppKit.signAndExecuteTransaction({ transaction: releaseTx });
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
