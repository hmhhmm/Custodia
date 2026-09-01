// Owner: Person 4 (frontend + orchestration).
//
// Status sequence driving the live status feed. Steps 1–5 (searching
// through escrow-locked) are still scripted on placeholder data — they
// depend on Person 1's on-chain discovery/Mandate reads and Person 2's
// PTB #1, neither of which exist yet. Steps 6–7 (work-in-progress,
// verification) now call the REAL verification-layer functions:
//   - storeBlob() from verification/walrus.ts — a genuine HTTP PUT to the
//     public Walrus testnet publisher, not simulated in the UI.
//   - mockNautilusAttest() from verification/nautilus.mock.ts — the
//     real (mocked-by-design) attestation function, not a hardcoded
//     `{ mocked: true }` literal in this file.
// This means the `mocked` flag and `attestationId` shown to the user now
// genuinely come from the verification layer, and the resultHash in the
// attestation is a real SHA-256 of the (synthetic, demo) deliverable
// bytes that were actually stored on Walrus.
//
// Still TO REPLACE once Person 1/2's real integration points exist:
//   - Person 2's PTB #1 (lock-escrow-and-create-deal) resolves -> should
//     drive "escrow-locked" instead of a timed step
//   - Person 2's PTB #2 (verify-and-release-and-update-reputation)
//     resolves -> should drive "payment-released" and "reputation-updated"
//   - Seal encryption of negotiation terms (verification/seal.ts) is
//     still blocked on @mysten/seal not being installed and
//     custodia::deal_access not being implemented — not wired here, the
//     "negotiating" step stays scripted.

import { storeBlob } from "../verification/walrus";
import { mockNautilusAttest } from "../verification/nautilus.mock";
import type { DealReceipt, StatusStep } from "./types";

const STEP_DELAY_MS = 650;

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runDemoStatusSequence(
  goal: string,
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
    { id: "escrow-locked", state: "pending", label: "Custodia locked" },
    { id: "work-in-progress", state: "pending", label: "Work in progress" },
    { id: "verification", state: "pending", label: "Verifying delivery" },
    { id: "payment-released", state: "pending", label: "Payment released" },
    { id: "reputation-updated", state: "pending", label: "Reputation updated" },
  ];

  function emit() {
    handlers.onStepsChange([...steps]);
  }

  emit();
  await wait(STEP_DELAY_MS);

  steps[0].state = "done";
  steps[1].state = "active";
  emit();
  await wait(STEP_DELAY_MS);

  steps[1].state = "done";
  steps[1].detail = {
    agentId: "0xDEMO_AGENT",
    suinsName: "legal-review.sui",
    reputationScore: 94,
  };
  steps[2].state = "active";
  emit();
  await wait(STEP_DELAY_MS);

  steps[2].state = "done";
  steps[2].detail = `Negotiated for: ${goal}`;
  steps[3].state = "active";
  emit();
  await wait(STEP_DELAY_MS);

  steps[3].state = "done";
  steps[3].detail = {
    maxSpend: 50,
    spentSoFar: 12,
    allowedCategories: ["legal", "logistics"],
    expiresAt: "2026-09-30",
  };
  steps[4].state = "active";
  emit();
  await wait(STEP_DELAY_MS);

  steps[4].state = "done";
  steps[5].state = "active";
  steps[5].detail = "Uploading to Walrus testnet — this can take several seconds.";
  emit();

  // REAL: store a synthetic deliverable on Walrus testnet. The content
  // itself is still a demo placeholder (there is no real specialist
  // agent producing work yet) — but the storage call, the resulting
  // blobId, and the network round-trip are genuine.
  const deliverableText = `Deliverable for: ${goal}\nProduced by: legal-review.sui\nTimestamp: ${new Date().toISOString()}`;
  let blobId: string;
  try {
    const stored = await storeBlob(deliverableText);
    blobId = stored.blobId;
  } catch (err) {
    steps[5].state = "failed";
    steps[5].detail = `Walrus storage failed: ${err instanceof Error ? err.message : String(err)}`;
    emit();
    throw err;
  }

  steps[5].state = "done";
  steps[5].detail = `Stored on Walrus · blob ${blobId}`;
  steps[6].state = "active";
  emit();

  // REAL: call the actual (mocked-by-design) Nautilus attestation
  // function against the bytes that were really stored above. The
  // `mocked` flag below comes from mockNautilusAttest's real return
  // value, not a literal written in this file.
  const attestation = await mockNautilusAttest(
    "demo-deal-0001",
    new TextEncoder().encode(deliverableText),
  );

  steps[6].state = "done";
  steps[6].detail = {
    mocked: attestation.mocked,
    attestationId: attestation.attestationId,
  };
  steps[7].state = "active";
  emit();
  await wait(STEP_DELAY_MS);

  steps[7].state = "done";
  steps[8].state = "active";
  emit();
  await wait(STEP_DELAY_MS);

  steps[8].state = "done";
  emit();
  await wait(STEP_DELAY_MS / 2);

  handlers.onComplete({
    dealId: "demo-deal-0001",
    amount: 12,
    counterpartyName: "legal-review.sui",
    verification: { mocked: attestation.mocked, attestationId: attestation.attestationId },
    // Fully scripted, like the rest of this file — see orchestrator.ts
    // for the real Seal-encrypted equivalent this sequencer never used.
    deliverable: { blobId: "demo-blob-0001", allowlistId: "0x0", seedId: "00" },
  });
}
