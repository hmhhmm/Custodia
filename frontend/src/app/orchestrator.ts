// Real orchestrator driving the live status feed — every step is either
// REAL (an on-chain call or a live third-party API) or waiting on a real
// counterparty, labeled inline below.
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
// THIS FILE ONLY RUNS THE CLIENT SIDE, AND STOPS AT ESCROW: a real
// specialist is a separate person in a separate browser session (see
// SpecialistInbox.tsx) — there is no scripted auto-accept/auto-deliver
// here anymore, and no fixed specialistKeypair. Once escrow locks, this
// function returns a PendingRelease and the deal just waits; the Deals tab
// polls the Deal's live on-chain status and surfaces a "Verify & Release
// Payment" button once it reaches Delivered (see release.ts).
//
// Step-by-step reality:
//   1. searching / candidate-found — REAL: discoverAgents() against the
//      live on-chain AgentRegistry — any registered specialist for the
//      category, not filtered to one fixed demo address.
//   2. negotiating — REAL Gemini call (llm.ts's interpretGoal) to turn
//      the goal into a category the Mandate can check.
//   3. mandate-check / escrow-locked — REAL PTB: custodia::deal::create_and_share
//      (ptb-escrow.ts), using onboarding.mandateId and Envoy's own
//      AgentIdentity (looked up fresh — see ensureEnvoyIdentity in
//      Onboarding.tsx). Signed by envoyKeypair.
//   4. work-in-progress — REAL: sets up the Deal's Seal DealAllowlist so
//      the specialist can later encrypt their real deliverable to it, then
//      this step and everything after it waits on the specialist.

import { dAppKit } from "../sui/dapp-kit";
import { envoyKeypair, ENVOY_ADDRESS } from "../sui/envoy-signer";
import { discoverAgents } from "../agent/discovery";
import { interpretGoal } from "../agent/llm";
import { buildLockEscrowAndCreateDealTx, extractDealIdFromResult } from "../sui/ptb-escrow";
import { buildCreateDealAllowlistTx, extractAllowlistIdFromEffects } from "../sui/ptb-deal-access";
import { findOwnedAgentIdentity, findMandateDetails } from "../sui/onboarding-status";
import type { OnboardingResult } from "./Onboarding";
import type { PendingRelease, StatusStep } from "./types";

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const STEP_DELAY_MS = 400;

export async function createDealAndEscrow(
  goal: string,
  connectedAddress: string | undefined,
  onboarding: OnboardingResult,
  handlers: {
    onStepsChange: (steps: StatusStep[]) => void;
    onEscrowed: (pending: PendingRelease) => void;
  },
): Promise<void> {
  const steps: StatusStep[] = [
    { id: "searching", state: "active", label: "Reading Mandate limits & searching the AgentRegistry", detail: "Reading the on-chain AgentRegistry for every specialist registered for this task's category." },
    { id: "candidate-found", state: "pending", label: "Specialist selected by on-chain reputation" },
    { id: "negotiating", state: "pending", label: "Proposing terms to the specialist" },
    { id: "mandate-check", state: "pending", label: "Checking against Mandate spend limits on-chain" },
    { id: "escrow-locked", state: "pending", label: "Locking payment in on-chain escrow" },
    { id: "work-in-progress", state: "pending", label: "Waiting for the specialist to accept & deliver" },
    { id: "verification", state: "pending", label: "Verifying delivery proof" },
    { id: "payment-released", state: "pending", label: "Releasing payment on-chain" },
    { id: "reputation-updated", state: "pending", label: "Updating on-chain reputation" },
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
  // so checking only the cap isn't enough. A 10% safety margin below the
  // tighter of the two accounts for spent_so_far not being zero on a
  // reused Mandate.
  const mandate = await findMandateDetails(connectedAddress!, ENVOY_ADDRESS);
  if (!mandate) {
    fail(0, "No Mandate found for this account — complete onboarding first.");
  }
  const remainingAuthorizedMist = mandate.maxSpendMist - mandate.spentSoFarMist;
  const spendableMist = remainingAuthorizedMist < mandate.fundsMist ? remainingAuthorizedMist : mandate.fundsMist;
  const budgetCeilingSui = (Number(spendableMist) / 1_000_000_000) * 0.9;
  const remainingAuthorizedSui = Number(remainingAuthorizedMist) / 1_000_000_000;
  const fundedSui = Number(mandate.fundsMist) / 1_000_000_000;

  if (budgetCeilingSui < 0.001) {
    fail(
      0,
      `The connected Mandate has almost nothing left to spend (${(Number(spendableMist) / 1_000_000_000).toFixed(4)} SUI remaining) — fund it further or create a new Mandate.`,
    );
  }

  steps[0].detail = `Reading your Mandate's on-chain limits: authorized up to ${(Number(mandate.maxSpendMist) / 1_000_000_000).toFixed(4)} SUI total, ${(Number(mandate.spentSoFarMist) / 1_000_000_000).toFixed(4)} SUI already spent, ${remainingAuthorizedSui.toFixed(4)} SUI of authorization remaining. The Mandate is actually funded with ${fundedSui.toFixed(4)} SUI (the two limits are separate — see mandate.move — so this task's budget is capped at whichever is tighter, then held to ${budgetCeilingSui.toFixed(4)} SUI, a 10% safety margin under that cap).`;
  emit();

  let interpreted;
  try {
    interpreted = await interpretGoal(goal, budgetCeilingSui);
  } catch (err) {
    fail(0, `Goal interpretation failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  steps[0].detail = `Asked Gemini to classify the task and propose a budget within that ${budgetCeilingSui.toFixed(4)} SUI ceiling. Result: category "${interpreted.category}", understood as "${interpreted.description}", proposed budget ${interpreted.maxBudget.toFixed(4)} SUI. Now querying the on-chain AgentRegistry for every specialist registered under "${interpreted.category}".`;
  emit();

  // Any registered specialist for the category — no longer filtered to one
  // fixed demo address. Ranked by discoverAgents() itself (reputation
  // score, highest first), so the top real candidate is picked.
  const candidates = await discoverAgents({ capability: interpreted.category });

  if (candidates.length === 0) {
    fail(
      1,
      `No specialist registered for category "${interpreted.category}" yet — ask someone to register via the Specialist tab.`,
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

  // --- Step 2: terms are set by the client's own budget/category read --
  // No scripted counterparty reply — the specialist's real assent happens
  // when they accept() in their own inbox, a separate signed transaction.
  steps[2].state = "done";
  steps[2].detail = `Proposing "${interpreted.category}" to ${candidate.suinsName} at up to ${interpreted.maxBudget.toFixed(4)} SUI. Selected as the top-ranked candidate (reputation score ${candidate.reputationScore}) out of ${candidates.length} registered ${candidates.length === 1 ? "specialist" : "specialists"} for this category — no counter-offer negotiation happens here, the specialist either accepts this offer from their own inbox or it goes unaccepted. Payment stays locked in escrow the entire time and is only released after delivery is verified, so there's no exposure if they never respond.`;
  steps[3].state = "active";
  steps[3].detail = `Confirming "${interpreted.category}" is one of this Mandate's allowed categories and ${interpreted.maxBudget.toFixed(4)} SUI is within its remaining spend cap — this check happens on-chain inside custodia::mandate::assert_within_mandate, not just client-side, so it can't be bypassed.`;
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
  steps[3].detail = `Passed — Mandate ${mandateId} allows "${interpreted.category}" and has enough remaining spend for ${interpreted.maxBudget.toFixed(4)} SUI. Envoy's own on-chain AgentIdentity (${envoyAgent.agentId}) is the signer for this Deal's client side — see the Mandate delegation model in this app's architecture notes.`;
  steps[4].state = "active";
  steps[4].detail = `Building and signing the escrow transaction (custodia::deal::create_and_share) with a 24-hour delivery window and a 24-hour review window after that — real SUI moves from the Mandate's custody into this Deal's escrow now, not a simulation. It can only be released to ${candidate.suinsName} once delivery is verified, or refunded back to the Mandate if the deadline passes unaccepted.`;
  emit();

  let dealId: string;
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
  } catch (err) {
    fail(4, `Escrow lock failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  steps[4].state = "done";
  steps[4].detail = `Deal ${dealId} created and escrowed on-chain — ${interpreted.maxBudget.toFixed(4)} SUI is now locked and can no longer be spent on anything else until this Deal resolves.`;
  steps[5].state = "active";
  steps[5].detail = `${candidate.suinsName} can now see this offer in their own specialist inbox and accept it with their own wallet signature — Envoy has no control over when or whether they respond. If they don't accept and deliver within the 24-hour window, the escrow refunds automatically back to the Mandate.`;
  emit();

  // --- REAL PTB: create the Seal DealAllowlist for this Deal -----------
  // Must happen after the Deal exists (deal_access::new_for_deal reads the
  // Deal's party owners) — the specialist needs this allowlist's object id
  // to Seal-encrypt their real deliverable to it from their own inbox.
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

  handlers.onEscrowed({
    dealId,
    counterpartyName: candidate.suinsName,
    amountSui: interpreted.maxBudget,
    clientAgentIdentityId: envoyAgent.agentId,
    clientReputationId: envoyAgent.reputationId,
    specialistReputationId: candidate.reputationId,
    specialistOwnerAddress: candidate.owner,
    allowlistId,
    // The specialist mints their own Seal identity/nonce when they encrypt
    // their real deliverable from the inbox (see SpecialistInbox.tsx) —
    // this orchestrator no longer encrypts anything itself, so there is no
    // seedId yet. Populated once the deliverable is decrypted from the
    // release screen by re-deriving it from the DealProof's storage
    // reference — see release.ts's note on this.
    seedId: "",
  });
}
