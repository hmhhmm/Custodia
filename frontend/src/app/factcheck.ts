// Custodia Verify — repoints Custodia's real escrow/Mandate/Reputation
// contracts at fact-checking instead of task delivery. This is a
// SEPARATE feature/pitch from the main product (see the "AI for
// Society" / Gonka Router track), not a modification of the main deal
// flow — createDealAndEscrow (orchestrator.ts) is completely untouched.
//
// The mechanism, concretely:
//   1. Envoy escrows a small amount from the connected wallet's real
//      Mandate, exactly like any other deal — mandate::assert_within_mandate
//      is the same on-chain check, unmodified.
//   2. The "specialist" on this Deal is a real on-chain AgentIdentity
//      representing Custodia's own automated Gonka-backed verification
//      service (see sui/verifier-signer.ts's header for exactly why one
//      address can legitimately sign both sides here, and why that must
//      always be presented plainly, never disguised as a peer match).
//   3. The actual "work" is a real Gonka Router call — cross-verifying
//      the claim across multiple independent models (agent/gonka.ts).
//      This is the one MANDATORY piece per the track brief: all
//      reasoning/verification runs through Gonka, nothing else.
//   4. The Truth Score + reasoning trace + Gonka Request IDs are
//      Seal-encrypted and stored on Walrus — the exact same
//      encrypt-then-store path orchestrator.ts already uses for a
//      specialist's deliverable, not a new storage mechanism.
//   5. verify_and_release fires for real: pays the tiny inference-cost
//      fee to the Verifier identity and updates BOTH Reputation objects
//      atomically — record_completed()/record_disputed() are the
//      IDENTICAL Move calls a real specialist deal already uses. Here,
//      the Verifier's own Reputation is what should be read as "how
//      often has this verification service's output held up" — this
//      demo always calls it a success (there's no dispute mechanism for
//      a claim wired up yet), so the score only ever grows; treat it as
//      a demonstration of the REAL mechanism, not a claim that dispute
//      handling for verifier accuracy is fully built.
//
// No new Move module, no new category added to Mandate's allowed
// list — this reuses the existing "research" category (the closest
// existing fit: inspect/diagnose/assess, same as it already covers
// hands-on physical diagnostic work in the main product) rather than
// touching MANDATE_CATEGORIES, which every existing Mandate's on-chain
// allowed_categories was already fixed against at creation time.

import { dAppKit } from "../sui/dapp-kit";
import { envoyKeypair, ENVOY_ADDRESS } from "../sui/envoy-signer";
import { verifierKeypair, VERIFIER_ADDRESS } from "../sui/verifier-signer";
import { verifyClaimOnGonka, type ConsensusResult } from "../agent/gonka";
import { buildLockEscrowAndCreateDealTx, extractDealIdFromResult } from "../sui/ptb-escrow";
import { buildAcceptDealTx } from "../sui/ptb-accept";
import { buildMarkDeliveredTx } from "../sui/ptb-deliver";
import { buildVerifyAndReleaseTx } from "../sui/ptb-release";
import { buildCreateDealAllowlistTx, extractAllowlistIdFromEffects } from "../sui/ptb-deal-access";
import { buildRegisterAgentTx, extractRegisteredAgentFromResult, type RegisteredAgent } from "../sui/ptb-register-agent";
import { encryptDealContent } from "../verification/seal";
import { storeBlob } from "../verification/walrus";
import { mockNautilusAttest } from "../verification/nautilus.mock";
import { findOwnedAgentIdentity, findMandateDetails } from "../sui/onboarding-status";

export type FactCheckStepId =
  | "reading-mandate"
  | "escrow-locked"
  | "verifier-ready"
  | "querying-gonka"
  | "storing-result"
  | "releasing-payment";

export interface FactCheckStep {
  id: FactCheckStepId;
  state: "pending" | "active" | "done" | "failed";
  label: string;
  detail?: string;
}

export interface FactCheckResult {
  dealId: string;
  claim: string;
  consensus: ConsensusResult;
  /** Real Walrus blob id the encrypted Truth Score + reasoning + Gonka
   * Request IDs were written to — provenance-anchored, not just
   * displayed and discarded. */
  storageId: string;
  verifierReputationId: string;
}

const FACT_CHECK_CATEGORY = "research";
// A verification job costs almost nothing to escrow — this is paying
// for Gonka inference, not a specialist's labor. Kept intentionally
// tiny (see llm.ts's own "keep budgets small" fix earlier this
// session) rather than scaling with whatever the Mandate's cap happens
// to allow.
const FACT_CHECK_ESCROW_SUI = 0.001;

function suiToMist(sui: number): bigint {
  return BigInt(Math.round(sui * 1_000_000_000));
}

/** Finds the Verifier's own AgentIdentity, registering one on first use.
 * Reused across every fact-check after the first — this identity IS
 * "Custodia Verify" on-chain, not re-created per claim. */
async function ensureVerifierIdentity(): Promise<RegisteredAgent> {
  const existing = await findOwnedAgentIdentity(VERIFIER_ADDRESS, FACT_CHECK_CATEGORY);
  if (existing) return existing;

  const tx = buildRegisterAgentTx({
    suinsName: "custodia-verify.sui",
    capabilities: [FACT_CHECK_CATEGORY],
  });
  const result = await verifierKeypair.signAndExecuteTransaction({ transaction: tx, client: dAppKit.getClient() });
  if (result.FailedTransaction) {
    throw new Error(result.FailedTransaction.status.error?.message ?? "Verifier registration failed");
  }
  const registered = await extractRegisteredAgentFromResult(dAppKit.getClient(), result);
  if (!registered) {
    throw new Error("Verifier registered, but no AgentRegistered event was found to read its ID from.");
  }
  return registered;
}

/** Runs one fact-check end to end through Custodia's real contracts.
 * `onStepsChange` mirrors orchestrator.ts's own live-step-feed pattern
 * so a UI can render identical honest progress, not a spinner hiding
 * what's actually happening. */
export async function runFactCheck(
  claim: string,
  connectedAddress: string,
  onStepsChange: (steps: FactCheckStep[]) => void,
): Promise<FactCheckResult> {
  const steps: FactCheckStep[] = [
    { id: "reading-mandate", state: "active", label: "Reading Mandate limits" },
    { id: "escrow-locked", state: "pending", label: "Locking a small escrow for the inference cost" },
    { id: "verifier-ready", state: "pending", label: "Confirming Custodia Verify's on-chain identity" },
    { id: "querying-gonka", state: "pending", label: "Cross-verifying the claim on Gonka Router" },
    { id: "storing-result", state: "pending", label: "Encrypting and storing the verdict on Walrus" },
    { id: "releasing-payment", state: "pending", label: "Releasing payment and updating on-chain reputation" },
  ];
  function emit() {
    onStepsChange([...steps]);
  }
  function fail(index: number, message: string): never {
    steps[index].state = "failed";
    steps[index].detail = message;
    emit();
    throw new Error(message);
  }

  const mandate = await findMandateDetails(connectedAddress, ENVOY_ADDRESS);
  if (!mandate) {
    fail(0, "No Mandate found — complete onboarding first.");
  }
  if (!mandate.allowedCategories.includes(FACT_CHECK_CATEGORY)) {
    fail(0, `This Mandate does not allow the "${FACT_CHECK_CATEGORY}" category, which Custodia Verify currently reuses — fund a Mandate that includes it.`);
  }
  const remainingAuthorizedMist = mandate.maxSpendMist - mandate.spentSoFarMist;
  const spendableMist = remainingAuthorizedMist < mandate.fundsMist ? remainingAuthorizedMist : mandate.fundsMist;
  if (spendableMist < suiToMist(FACT_CHECK_ESCROW_SUI)) {
    fail(0, `Mandate has less than ${FACT_CHECK_ESCROW_SUI} SUI spendable — fund it further.`);
  }
  steps[0].state = "done";
  steps[0].detail = `Mandate ${mandate.mandateId} has ${(Number(spendableMist) / 1_000_000_000).toFixed(4)} SUI spendable.`;
  steps[1].state = "active";
  emit();

  const envoyAgent = await findOwnedAgentIdentity(ENVOY_ADDRESS, "client");
  if (!envoyAgent) fail(1, "Envoy has no registered client AgentIdentity yet.");

  const verifier = await ensureVerifierIdentity();
  steps[2].detail = `Verifier identity ${verifier.agentId} ready.`;

  let dealId: string;
  try {
    const tx = buildLockEscrowAndCreateDealTx({
      mandateId: mandate.mandateId,
      clientAgentIdentityId: envoyAgent.agentId,
      specialistAgentId: verifier.agentId,
      category: FACT_CHECK_CATEGORY,
      amount: suiToMist(FACT_CHECK_ESCROW_SUI),
      deliveryWindowMs: BigInt(60 * 60 * 1000),
      reviewWindowMs: BigInt(60 * 60 * 1000),
    });
    const result = await envoyKeypair.signAndExecuteTransaction({ transaction: tx, client: dAppKit.getClient() });
    if (result.FailedTransaction) {
      throw new Error(result.FailedTransaction.status.error?.message ?? "Escrow lock failed");
    }
    const extracted = await extractDealIdFromResult(dAppKit.getClient(), result);
    if (!extracted) throw new Error("create_and_share succeeded but no DealCreated event was found.");
    dealId = extracted.dealId;
  } catch (err) {
    fail(1, `Escrow lock failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  steps[1].state = "done";
  steps[1].detail = `Deal ${dealId} escrowed — ${FACT_CHECK_ESCROW_SUI} SUI locked for this verification.`;
  steps[2].state = "done";
  emit();

  // Verifier accepts its own offer (see verifier-signer.ts's header for
  // why one address legitimately signs both sides here).
  try {
    const acceptTx = buildAcceptDealTx({
      dealId,
      specialistAgentIdentityId: verifier.agentId,
      deliveryDeadlineMs: BigInt(Date.now() + 60 * 60 * 1000),
      amount: suiToMist(FACT_CHECK_ESCROW_SUI),
    });
    const acceptResult = await verifierKeypair.signAndExecuteTransaction({ transaction: acceptTx, client: dAppKit.getClient() });
    if (acceptResult.FailedTransaction) {
      throw new Error(acceptResult.FailedTransaction.status.error?.message ?? "accept() failed");
    }
  } catch (err) {
    fail(2, `Verifier could not accept the deal: ${err instanceof Error ? err.message : String(err)}`);
  }

  let allowlistId: string;
  try {
    const allowlistTx = buildCreateDealAllowlistTx({ dealId });
    const allowlistResult = await envoyKeypair.signAndExecuteTransaction({ transaction: allowlistTx, client: dAppKit.getClient() });
    if (allowlistResult.FailedTransaction) {
      throw new Error(allowlistResult.FailedTransaction.status.error?.message ?? "DealAllowlist creation failed");
    }
    const extracted = extractAllowlistIdFromEffects(allowlistResult.Transaction!.effects);
    if (!extracted) throw new Error("new_and_share succeeded but no shared DealAllowlist was found in the effects.");
    allowlistId = extracted;
  } catch (err) {
    fail(2, `DealAllowlist setup failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  steps[3].state = "active";
  emit();

  // --- THE MANDATORY PART: real Gonka Router call, multi-model cross-
  // verification, nothing routed through Gemini or any other provider.
  let consensus: ConsensusResult;
  try {
    consensus = await verifyClaimOnGonka(claim);
  } catch (err) {
    fail(3, `Gonka Router verification failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  steps[3].state = "done";
  steps[3].detail = `Consensus Truth Score: ${consensus.consensusTruthScore}% across ${consensus.perModel.filter((m) => m.verdict).length} model(s).${consensus.modelsDisagree ? " Models disagreed by more than 25 points." : ""}`;
  steps[4].state = "active";
  emit();

  const verdictRecord = {
    v: 1,
    claim,
    consensusTruthScore: consensus.consensusTruthScore,
    modelsDisagree: consensus.modelsDisagree,
    perModel: consensus.perModel.map((m) => ({
      model: m.model,
      gonkaRequestId: m.requestId,
      truthScore: m.verdict?.truthScore ?? null,
      reasoning: m.verdict?.reasoning ?? null,
      error: m.error ?? null,
    })),
  };

  let storageId: string;
  try {
    const bytes = new TextEncoder().encode(JSON.stringify(verdictRecord));
    const encrypted = await encryptDealContent(bytes, dAppKit.getClient(), allowlistId);
    const stored = await storeBlob(encrypted.encryptedObject);
    storageId = stored.blobId;

    const attestation = await mockNautilusAttest(dealId, bytes);
    const deliverTx = buildMarkDeliveredTx({
      dealId,
      specialistAgentIdentityId: verifier.agentId,
      storageId: stored.blobId,
      attestationId: attestation.attestationId,
      extra: { v: 1, sealSeedId: encrypted.seedId },
    });
    const deliverResult = await verifierKeypair.signAndExecuteTransaction({ transaction: deliverTx, client: dAppKit.getClient() });
    if (deliverResult.FailedTransaction) {
      throw new Error(deliverResult.FailedTransaction.status.error?.message ?? "mark_delivered() failed");
    }
  } catch (err) {
    fail(4, `Storing the verdict failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  steps[4].state = "done";
  steps[4].detail = `Verdict stored on Walrus (blob ${storageId}), Seal-encrypted against this Deal's allowlist.`;
  steps[5].state = "active";
  emit();

  try {
    const releaseTx = buildVerifyAndReleaseTx({
      dealId,
      clientAgentIdentityId: envoyAgent.agentId,
      clientReputationId: envoyAgent.reputationId,
      specialistReputationId: verifier.reputationId,
    });
    const releaseResult = await envoyKeypair.signAndExecuteTransaction({ transaction: releaseTx, client: dAppKit.getClient() });
    if (releaseResult.FailedTransaction) {
      throw new Error(releaseResult.FailedTransaction.status.error?.message ?? "verify_and_release() failed");
    }
  } catch (err) {
    fail(5, `Release failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  steps[5].state = "done";
  steps[5].detail = `Payment released — Custodia Verify's on-chain Reputation (${verifier.reputationId}) updated for real, the identical record_completed() call a specialist's delivery already uses.`;
  emit();

  return { dealId, claim, consensus, storageId, verifierReputationId: verifier.reputationId };
}
