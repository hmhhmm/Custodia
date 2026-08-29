// Owner: Person 4 (frontend + orchestration).
//
// DEMO-ONLY scripted status sequence. This exists purely so the live
// status feed has something real to render before Person 1/2/3's actual
// integration points (PTB confirmations, on-chain reads, Person 3's
// verification result) are wired up. It is explicitly NOT the pattern
// the design direction calls for long-term — per /docs/ARCHITECTURE.md
// and the Person 4 design brief, each step should be driven by a real
// on-chain/off-chain event, not an arbitrary setTimeout sequence.
//
// Replace call sites of runDemoStatusSequence with real event-driven
// updates once:
//   - Person 2's PTB #1 (lock-escrow-and-create-deal) resolves -> drives
//     "escrow-locked"
//   - Person 3's verification module (real or nautilus.mock.ts) resolves
//     -> drives "verification" (and must carry through the real `mocked`
//     flag — do not hardcode `mocked: true` once real Nautilus exists)
//   - Person 2's PTB #2 (verify-and-release-and-update-reputation)
//     resolves -> drives "payment-released" and "reputation-updated"

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
    { id: "escrow-locked", state: "pending", label: "Escrow locked" },
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
  emit();
  await wait(STEP_DELAY_MS);

  steps[5].state = "done";
  steps[6].state = "active";
  emit();
  await wait(STEP_DELAY_MS);

  steps[6].state = "done";
  steps[6].detail = {
    mocked: true,
    attestationId: "mock-attest-demo",
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
    verification: { mocked: true, attestationId: "mock-attest-demo" },
  });
}
