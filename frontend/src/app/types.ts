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
  deliverable: {
    blobId: string;
    allowlistId: string;
    seedId: string;
    /** Set only when the specialist attached a file (see
     * ptb-deliver.ts's DeliveryExtra) — its own independent Walrus blob +
     * Seal seed, separate from the deliverable text's. */
    file?: { blobId: string; seedId: string; name: string; mimeType: string };
  };
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

/** Everything the client side (Envoy, on the connected wallet's behalf)
 * needs to call verify_and_release later, once a real specialist has
 * accepted and delivered via their own inbox — set once escrow locks,
 * read again whenever the release button is used. */
export interface PendingRelease {
  dealId: string;
  counterpartyName: string;
  amountSui: number;
  clientAgentIdentityId: string;
  clientReputationId: string;
  specialistReputationId: string;
  /** The wallet address that owns the specialist's AgentIdentity — where
   * payment actually lands. Used to verify the release really moved funds
   * (see release.ts), not just that the transaction didn't abort. */
  specialistOwnerAddress: string;
  allowlistId: string;
  seedId: string;
}

/** Every turn belongs to a thread — "general" for plain conversation, or a
 * deal's own `id` once a message turns out to have started one. This is
 * set retroactively: the LLM only reveals "this was a deal" after the
 * fact (see ChatPanel.tsx's handleSubmit), so the triggering user message
 * is re-tagged with the deal's thread id the moment that's known, moving
 * it out of "general" into that deal's own thread. Real chat-history
 * management (per-deal threads + one ongoing general thread), not a
 * single endless list — see ChatThreadList.tsx. */
export const GENERAL_THREAD_ID = "general";

/** Links a "deal" turn to its siblings in a multi-agent chain — e.g. the
 * pickup/repair/return sequence one complicated Chat request can produce
 * (see chainAdvance.ts). Optional and purely additive: every existing
 * single-deal turn simply omits it and behaves exactly as before this
 * field existed. `chainId` doubles as the shared thread id for the whole
 * chain (one thread, N deal turns) — see ChatPanel.tsx's start_deal_chain
 * handling. */
export interface ChainInfo {
  chainId: string;
  legIndex: number;
  legTotal: number;
  /** Legs not yet started, in order — the ENTIRE remaining plan, not just
   * the next one, so creating leg i+1 never needs to reconstruct leg i+2's
   * brief from anywhere else. Empty on the last leg. */
  remainingLegs: { category: string; taskDescription: string }[];
  /** User-requested stop — e.g. a leg keeps failing (a real case this
   * session hit: the Mandate ran out of funds) and the user wants the
   * chain to genuinely stop trying rather than sit there retrying or
   * waiting indefinitely. Distinct from a leg simply failing on its own:
   * this is a deliberate "end session" action, checked by
   * chainAdvance.ts's poll gate so a manually-ended chain never
   * auto-advances again, even after a page reload (unlike the in-memory
   * dealsWithFailedAdvance guard, this is a real persisted field on the
   * turn). Any already-escrowed on-chain Deal is untouched by this — it
   * still resolves normally via the usual accept/deliver/release or
   * timeout-refund path; this only stops the CHAT-SIDE automation from
   * creating any further legs. */
  ended?: boolean;
}

/** Every turn now carries a stable `id`, not just "deal" turns — using
 * the array INDEX as React's list key (ChatPanel.tsx's turn-rendering
 * .map) was a real bug: once `tryAdvanceChain` starts appending new
 * turns (a summary turn, then a new deal turn) mid-session, index-based
 * keys can misattribute a re-rendered component to the wrong turn,
 * which is exactly the kind of thing that can silently corrupt a
 * running DealProgress instance's closure state (its isLatestUnadvancedLeg
 * prop, its polling interval) without throwing any visible error — the
 * observed symptom was a chain simply stopping mid-way with no error in
 * sight. `id` must be unique across the whole `turns` array, not just
 * per-thread. */
export type ConversationTurn =
  | { kind: "text"; id: string; role: "user" | "assistant"; text: string; attachment?: AttachmentInfo; threadId: string }
  | { kind: "deal"; id: string; task: string; steps: StatusStep[]; receipt: DealReceipt | null; pending: PendingRelease | null; threadId: string; chain?: ChainInfo }
  | { kind: "error"; id: string; text: string; threadId: string };
