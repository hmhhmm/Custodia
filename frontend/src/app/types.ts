// Owner: Person 4 (frontend + orchestration).
//
// Shared UI-layer types for the Envoy screens. These describe what the
// UI needs to RENDER, not the on-chain Deal/Mandate shapes themselves —
// see /docs/ARCHITECTURE.md for the real Move object fields (still
// PROPOSED/TBD in several places) and /frontend/src/verification/proof.ts
// for the PROPOSED proof_ref format. Do not assume these UI types map
// 1:1 onto the eventual on-chain structs; a mapping/adapter layer will be
// needed once Person 1/2's real types are confirmed.

export type StatusStepId =
  | "searching"
  | "candidate-found"
  | "negotiating"
  | "mandate-check"
  | "escrow-locked"
  | "work-in-progress"
  | "verification"
  | "payment-released"
  | "reputation-updated";

export type StatusStepState = "pending" | "active" | "done" | "failed";

export interface CandidateInfo {
  agentId: string;
  suinsName: string;
  reputationScore: number;
}

export interface MandateSnapshot {
  maxSpend: number;
  spentSoFar: number;
  allowedCategories: string[];
  expiresAt: string;
}

export interface VerificationInfo {
  /** Mirrors nautilus.mock.ts's MockAttestation.mocked — MUST be surfaced
   * in the UI per the design direction: never present a simulated
   * attestation as indistinguishable from a real one. */
  mocked: boolean;
  attestationId: string;
}

export interface StatusStep {
  id: StatusStepId;
  state: StatusStepState;
  /** Short human-readable label, e.g. "Escrow locked". */
  label: string;
  /** Optional detail shown once the step is active/done — e.g. the
   * candidate's name+score, the Mandate snapshot, or verification info. */
  detail?: CandidateInfo | MandateSnapshot | VerificationInfo | string;
}

export interface DealReceipt {
  dealId: string;
  amount: number;
  counterpartyName: string;
  verification: VerificationInfo;
  /** VERIFY: exact Sui testnet explorer URL pattern before wiring this up
   * for real — do not guess the path format. */
  explorerUrl?: string;
}
