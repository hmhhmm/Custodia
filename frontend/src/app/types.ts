// Shared UI-layer types for the Custodia screens. These describe what the
// UI needs to render, not the on-chain Deal/Mandate shapes themselves —
// see /docs/ARCHITECTURE.md for the real Move object fields.

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
  /** Short human-readable label, e.g. "Custodia locked". */
  label: string;
  /** Optional detail shown once the step is active/done — e.g. the
   * candidate's name+score or verification info. */
  detail?: CandidateInfo | VerificationInfo | string;
}

export interface DealReceipt {
  dealId: string;
  amount: number;
  counterpartyName: string;
  verification: VerificationInfo;
  /** VERIFY: exact Sui testnet explorer URL pattern before wiring this up
   * for real — do not guess the path format. */
  explorerUrl?: string;
  /** The deliverable, real and Seal-encrypted on Walrus — see
   * verification/seal.ts and sui/ptb-deal-access.ts. `allowlistId` is the
   * DealAllowlist object id needed to build the seal_approve dry-run tx;
   * `seedId` is the exact Seal identity used at encrypt time ([allowlist
   * id][random nonce], hex) and must be passed back unchanged to
   * decryptDealContent() — it cannot be re-derived from allowlistId alone. */
  deliverable: { blobId: string; allowlistId: string; seedId: string };
}

/** Row shown on the dashboard's deal history. A deliberately smaller
 * status vocabulary than StatusStep — the dashboard shows resting state,
 * not the in-progress sequence (see StatusFeed for that). */
export type DealSummaryStatus = "escrowed" | "released" | "disputed";

export interface DealSummary {
  dealId: string;
  counterpartyName: string;
  amount: number;
  status: DealSummaryStatus;
  /** Category tag shown on the deal card, e.g. "Legal", "Logistics" —
   * mirrors Mandate.allowed_categories vocabulary. */
  category: string;
  /** Short one-line description of what the deal is for, shown on the
   * card below the counterparty name. */
  description: string;
}

/** A single turn in the Chat tab's ongoing conversation. Lives in App.tsx
 * (not ChatPanel's own local state) so the Deals tab can show a running
 * deal's live progress and let the user jump back to its exact turn in
 * Chat — the two tabs are two views over the same state, not separate
 * copies of it. */
export interface AttachmentInfo {
  name: string;
  mimeType: string;
  /** Only set for images — an object URL for inline preview/thumbnail.
   * Revoked on unmount by the component that created it. */
  previewUrl?: string;
}

export type ConversationTurn =
  | { kind: "text"; role: "user" | "assistant"; text: string; attachment?: AttachmentInfo }
  | { kind: "deal"; id: string; task: string; steps: StatusStep[]; receipt: DealReceipt | null }
  | { kind: "error"; text: string };
