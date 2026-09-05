// Standalone progress screen — reached from the Deals tab, either from a
// live in-session card (ConversationTurn, still animating through its
// steps) or a chain-derived card (opened after a refresh, when the
// ConversationTurn that originally tracked this deal is long gone). Either
// way this screen ALWAYS re-derives the release info it needs
// (reconstructPendingRelease) from chain by dealId alone — never solely
// from React state — so a refresh mid-deal can never strand the release
// button.
//
// Redesigned as a real deal-summary page (title, amount, both parties,
// status timeline, deal ID) rather than a bare status pill with no other
// content — the previous version was reported as "shows nothing
// important." A live specialist has to accept/deliver from their own
// inbox (see SpecialistInbox.tsx); once Delivered, a "Verify & Release
// Payment" button appears here, signed by Envoy on the client's behalf
// (see release.ts).

import { useEffect, useState } from "react";
import { CurrentAccountSigner, type DAppKit } from "@mysten/dapp-kit-core";
import { dAppKit } from "../sui/dapp-kit";
import type { ConversationTurn, DealReceipt, PendingRelease } from "./types";
import { StatusFeed } from "./StatusFeed";
import {
  findDealById,
  findDealMetadata,
  findDealStageTimestamps,
  findCheckpointsForDeal,
  findAllowlistForDeal,
  type DealStatusName,
  type DealMetadata,
  type DealStageTimestamps,
  type DealCheckpointInfo,
} from "../sui/deal-queries";
import { releaseDeal, reconstructPendingRelease, type ReleaseProgressStage } from "./release";
import { summarizeDealTitle } from "../agent/llm";
import { readBlob } from "../verification/walrus";
import { decryptDealContent } from "../verification/seal";
import {
  getCachedDealTitle,
  setCachedDealTitle,
  isDealHidden,
  hideDeal,
  unhideDeal,
  getDealNote,
  setDealNote,
} from "./deal-local-meta";

const POLL_INTERVAL_MS = 4000;

const TIMELINE_STAGES: { status: DealStatusName; label: string }[] = [
  { status: "Escrowed", label: "Escrow locked" },
  { status: "Accepted", label: "Accepted by specialist" },
  { status: "Delivered", label: "Delivered" },
  { status: "Released", label: "Payment released" },
];

// Every stage here is a real on-chain read or the release transaction
// itself — no LLM call happens during release.ts's releaseDeal, so this
// label map is entirely honest about what the wait is actually for.
const RELEASE_STAGE_LABEL: Record<ReleaseProgressStage, string> = {
  "checking-proof": "Confirming delivery proof on-chain…",
  "reading-balance-before": "Reading the specialist's current balance…",
  signing: "Waiting for your signature…",
  confirming: "Waiting for the release transaction to confirm on-chain…",
  "verifying-balance": "Confirming the payment actually landed…",
};

function statusRank(status: DealStatusName): number {
  const order: DealStatusName[] = [
    "Negotiating",
    "Escrowed",
    "Accepted",
    "Delivered",
    "Verified",
    "Released",
    "Settled",
  ];
  const i = order.indexOf(status);
  return i === -1 ? -1 : i;
}

/** No pill, no background — plain text status label, same treatment as
 * Dashboard.tsx's card status. Neutral gray for every in-progress status;
 * color only on the text itself for the two outcomes that matter (paid,
 * disputed). */
function StatusPill({ status }: { status: DealStatusName }) {
  const style: Record<DealStatusName, string> = {
    Negotiating: "text-manifest",
    Escrowed: "text-manifest",
    Accepted: "text-manifest",
    Delivered: "text-slate-400",
    Verified: "text-manifest",
    Released: "text-vellum",
    Settled: "text-vellum",
    Disputed: "text-red-400",
    Refunded: "text-manifest",
  };
  return <span className={`text-xs font-medium ${style[status]}`}>{status}</span>;
}

export function formatDateTime(ms: number | null | undefined): string {
  if (!ms) return "Unknown";
  return new Date(ms).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function HideButton({ dealId, onHidden }: { dealId: string; onHidden: () => void }) {
  const [hidden, setHidden] = useState(() => isDealHidden(dealId));
  return (
    <button
      type="button"
      onClick={() => {
        if (hidden) {
          unhideDeal(dealId);
          setHidden(false);
        } else {
          hideDeal(dealId);
          setHidden(true);
          onHidden();
        }
      }}
      title={hidden ? "Show this deal again" : "Hide from this device — the deal itself stays on-chain"}
      className="shrink-0 rounded-md border border-border px-3 py-1.5 text-sm text-manifest transition-colors hover:border-white/30 hover:text-vellum"
    >
      {hidden ? "Unhide" : "Hide"}
    </button>
  );
}

function NoteSection({ dealId }: { dealId: string }) {
  const [note, setNote] = useState(() => getDealNote(dealId));
  const [editing, setEditing] = useState(false);

  return (
    <div className="rounded-xl border border-border bg-surface p-6">
      <p className="text-sm font-medium text-vellum">Note</p>
      <p className="mt-1 text-xs text-manifest">Only visible to you on this device.</p>
      {editing ? (
        <input
          autoFocus
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onBlur={() => {
            setDealNote(dealId, note);
            setEditing(false);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              setDealNote(dealId, note);
              setEditing(false);
            }
          }}
          placeholder="Write a note…"
          className="mt-3 w-full rounded-md border border-border bg-ink px-3 py-2 text-sm text-vellum focus:border-accent focus:outline-none"
        />
      ) : note ? (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="mt-3 block w-full rounded-md bg-ink px-3 py-2 text-left text-sm text-vellum hover:bg-surface-hover"
        >
          {note}
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="mt-3 text-sm text-manifest underline underline-offset-2 hover:text-vellum"
        >
          Add a note
        </button>
      )}
    </div>
  );
}

function CopyableAddress({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-manifest">{label}</p>
      <button
        type="button"
        onClick={() => {
          navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        }}
        title="Click to copy"
        className="mt-1 block max-w-full truncate rounded-md font-data text-sm text-vellum hover:bg-surface-hover"
      >
        {copied ? "Copied" : value}
      </button>
    </div>
  );
}

/** Real (not fabricated) per-stage time — pulled from the checkpoint
 * timestamp of the DealCreated/DealAccepted/DealDelivered/DealReleased
 * event carrying this dealId. See findDealStageTimestamps's own comment:
 * Deal itself stores no stage history, only a forward-looking, overwritten
 * stage_deadline_ms — this is the only real source for "when." */
function stageTimestamp(
  stage: DealStatusName,
  createdAtMs: number | null | undefined,
  stageTimes: DealStageTimestamps | null,
): number | null {
  switch (stage) {
    case "Escrowed":
      return createdAtMs ?? null;
    case "Accepted":
      return stageTimes?.acceptedAtMs ?? null;
    case "Delivered":
      return stageTimes?.deliveredAtMs ?? null;
    case "Released":
      return stageTimes?.releasedAtMs ?? null;
    default:
      return null;
  }
}

/** One row in the unified vertical timeline — either a coarse on-chain
 * stage (Escrow locked / Accepted / Delivered / Payment released) or a
 * specialist-pushed checkpoint, rendered on the SAME connected line in
 * true chronological order. Merging them (rather than the earlier
 * design's separate horizontal-stages-then-checkpoints-below layout) is
 * what makes this read as one real order-tracker, not two disconnected
 * lists. */
type TimelineRow =
  | { kind: "stage"; label: string; done: boolean; active: boolean; ts: number | null }
  | { kind: "checkpoint"; checkpoint: DealCheckpointInfo };

/** Real (single, continuous) vertical order-tracker — every row is a real
 * on-chain fact (Event.timestamp for the 4 coarse stages,
 * DealCheckpoint's own fields for specialist updates), merged in
 * chronological order rather than shown as two separate lists. */
function Timeline({
  status,
  createdAtMs,
  stageTimes,
  checkpoints,
  dealId,
  allowlistId,
}: {
  status: DealStatusName;
  createdAtMs: number | null | undefined;
  stageTimes: DealStageTimestamps | null;
  checkpoints: DealCheckpointInfo[];
  dealId: string;
  allowlistId: string | null;
}) {
  const currentRank = statusRank(status);
  const isDisputeLike = status === "Disputed" || status === "Refunded";

  // Build every stage row with its real timestamp (or null if it hasn't
  // happened yet), then interleave checkpoints by their own real
  // createdAtMs — a checkpoint sorts wherever it chronologically falls,
  // which in practice is always between "Accepted" and "Delivered" since
  // that's the only window a specialist can push one, but computing it
  // this way (rather than hardcoding "checkpoints go under Accepted")
  // means the order is driven by real timestamps, not an assumption.
  const stageRows: (TimelineRow & { kind: "stage"; sortMs: number })[] = TIMELINE_STAGES.map((stage) => {
    const stageRank = statusRank(stage.status);
    const done = !isDisputeLike && currentRank >= stageRank;
    const active = !isDisputeLike && currentRank === stageRank - 1;
    const ts = done ? stageTimestamp(stage.status, createdAtMs, stageTimes) : null;
    // Undone/future stages sort to the end regardless of a missing
    // timestamp — Infinity as a sort key, never rendered.
    return { kind: "stage", label: stage.label, done, active, ts, sortMs: ts ?? Infinity };
  });

  const checkpointRows: (TimelineRow & { kind: "checkpoint"; sortMs: number })[] = checkpoints.map((c) => ({
    kind: "checkpoint",
    checkpoint: c,
    sortMs: c.createdAtMs,
  }));

  const rows = [...stageRows, ...checkpointRows].sort((a, b) => a.sortMs - b.sortMs);

  return (
    <div>
      <div className="flex flex-col gap-0">
        {rows.map((row, i) => {
          const isLast = i === rows.length - 1;
          // Every marker sits in the SAME h-6 w-6 column regardless of
          // row kind, and the connecting line segment is a direct
          // sibling of that column (not nested inside a smaller wrapper)
          // — this is what keeps the line touching every dot with no
          // visible gap, including at a checkpoint's smaller dot.
          if (row.kind === "stage") {
            return (
              <div key={`stage-${row.label}`} className="flex gap-3">
                <div className="flex w-6 shrink-0 flex-col items-center">
                  {row.done ? (
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 border-vellum text-sm text-vellum">
                      ✓
                    </span>
                  ) : row.active ? (
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 border-vellum">
                      <span className="block h-2 w-2 rounded-full bg-vellum" />
                    </span>
                  ) : (
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center">
                      <span className="block h-2.5 w-2.5 rounded-full border-2 border-border" />
                    </span>
                  )}
                  {!isLast && <span className={`w-px flex-1 ${row.done ? "bg-vellum" : "bg-border"}`} />}
                </div>
                <div className="flex flex-1 items-baseline justify-between gap-3 pb-7">
                  <p className={`text-sm font-medium ${row.done || row.active ? "text-vellum" : "text-manifest"}`}>{row.label}</p>
                  {row.ts && <p className="shrink-0 text-xs text-manifest">{formatDateTime(row.ts)}</p>}
                </div>
              </div>
            );
          }
          return (
            <div key={row.checkpoint.checkpointId} className="flex gap-3">
              <div className="flex w-6 shrink-0 flex-col items-center">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center" aria-hidden="true">
                  <span className="block h-2 w-2 rounded-full bg-vellum" />
                </span>
                {!isLast && <span className="w-px flex-1 bg-vellum" />}
              </div>
              <div className="flex-1 pb-7">
                <CheckpointItem checkpoint={row.checkpoint} dealId={dealId} allowlistId={allowlistId} />
              </div>
            </div>
          );
        })}
      </div>
      {isDisputeLike && (
        <p className="mt-1 text-sm text-wax">
          {status === "Disputed" ? "This deal was disputed before reaching release." : "This deal was refunded to the client's Mandate."}
        </p>
      )}
    </div>
  );
}

/** One real specialist-pushed status update in the client-facing trail —
 * label, note, timestamp, and a photo decrypted on demand with the
 * CONNECTED wallet's own signature (the client, who is on this screen —
 * unlike chainAdvance.ts's automatic Envoy-signed summarization, a photo
 * click here is a genuine user action, so the same manual-decrypt pattern
 * Receipt.tsx already uses applies unchanged). Rendered as a plain row —
 * the connecting dot/line is drawn by the parent Timeline, since this
 * row shares one continuous line with the coarse stages around it. */
function CheckpointItem({
  checkpoint,
  dealId,
  allowlistId,
}: {
  checkpoint: DealCheckpointInfo;
  dealId: string;
  allowlistId: string | null;
}) {
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [photoStatus, setPhotoStatus] = useState<"idle" | "loading" | "error">("idle");

  function makeSigner() {
    return new CurrentAccountSigner(dAppKit as unknown as DAppKit);
  }

  async function handleViewPhoto() {
    if (!checkpoint.photo || !allowlistId) return;
    setPhotoStatus("loading");
    try {
      const encrypted = await readBlob(checkpoint.photo.blobId);
      const decrypted = await decryptDealContent(encrypted, dAppKit.getClient(), allowlistId, checkpoint.photo.seedId, makeSigner());
      const blob = new Blob([new Uint8Array(decrypted)]);
      setPhotoUrl(URL.createObjectURL(blob));
      setPhotoStatus("idle");
    } catch (err) {
      console.error("checkpoint photo decrypt failed for", dealId, err);
      setPhotoStatus("error");
    }
  }

  useEffect(() => {
    return () => {
      if (photoUrl) URL.revokeObjectURL(photoUrl);
    };
  }, [photoUrl]);

  return (
    <div>
      <p className="text-[11px] uppercase tracking-wide text-manifest">Specialist update</p>
      <div className="mt-0.5 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <p className="text-sm text-vellum">{checkpoint.label}</p>
        <p className="shrink-0 text-xs text-manifest">{formatDateTime(checkpoint.createdAtMs)}</p>
      </div>
      {checkpoint.note && <p className="mt-1 text-sm text-manifest">{checkpoint.note}</p>}
      {checkpoint.photo && (
        <div className="mt-2">
          {photoUrl ? (
            <img src={photoUrl} alt={checkpoint.label} className="max-h-48 rounded-lg border border-border" />
          ) : (
            <button
              type="button"
              onClick={handleViewPhoto}
              disabled={photoStatus === "loading" || !allowlistId}
              className="rounded-md border border-border px-2.5 py-1 text-xs text-manifest transition-colors hover:border-white/30 hover:text-vellum disabled:cursor-not-allowed disabled:opacity-40"
            >
              {photoStatus === "loading" ? "Decrypting…" : photoStatus === "error" ? "Failed to load — retry" : "View photo"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export function ProgressView({
  dealId,
  turn,
  onBack,
  onReturnToChat,
  onReleased,
  embedded = false,
}: {
  dealId: string;
  /** Present only when opened from a live in-session Chat turn — gives the
   * nicer animated step-by-step feed for the pre-escrow phase. Absent
   * when opened from a chain-derived card (e.g. after a refresh); the
   * summary below works identically either way. */
  turn?: Extract<ConversationTurn, { kind: "deal" }>;
  onBack: () => void;
  onReturnToChat: () => void;
  onReleased: (receipt: DealReceipt) => void;
  /** True when rendered as one leg inside ChainDetailView's stacked
   * multi-leg page rather than as its own standalone page — hides this
   * component's own outer page padding and "Back to deals"/"Return to
   * chat" row, since the parent already renders exactly one of those for
   * the whole chain. Everything else (status timeline, checkpoints,
   * release button) renders identically either way. */
  embedded?: boolean;
}) {
  const [pending, setPending] = useState<PendingRelease | "loading" | null>(turn?.pending ?? "loading");
  const [liveStatus, setLiveStatus] = useState<DealStatusName | null>(null);
  const [metadata, setMetadata] = useState<DealMetadata | null>(null);
  const [stageTimes, setStageTimes] = useState<DealStageTimestamps | null>(null);
  const [checkpoints, setCheckpoints] = useState<DealCheckpointInfo[]>([]);
  const [allowlistId, setAllowlistId] = useState<string | null>(null);
  const [title, setTitle] = useState<string | null>(() => getCachedDealTitle(dealId));
  const [releasing, setReleasing] = useState(false);
  const [releaseStage, setReleaseStage] = useState<ReleaseProgressStage | null>(null);
  const [releaseError, setReleaseError] = useState<string | null>(null);
  const alreadyReleased = Boolean(turn?.receipt);

  // Always re-derive from chain, even when a live turn already carries
  // `pending` — the turn's copy could be stale, and this also lets a bare
  // dealId with no turn at all work identically.
  useEffect(() => {
    if (alreadyReleased) return;
    let cancelled = false;

    reconstructPendingRelease(dealId)
      .then((found) => {
        if (!cancelled) setPending(found);
      })
      .catch(() => {
        if (!cancelled) setPending(null);
      });

    return () => {
      cancelled = true;
    };
  }, [dealId, alreadyReleased]);

  useEffect(() => {
    let cancelled = false;
    findDealMetadata()
      .then((map) => {
        if (!cancelled) setMetadata(map.get(dealId) ?? null);
      })
      .catch(() => {
        if (!cancelled) setMetadata(null);
      });
    return () => {
      cancelled = true;
    };
  }, [dealId]);

  useEffect(() => {
    if (alreadyReleased) return;
    let cancelled = false;

    async function poll() {
      try {
        const deal = await findDealById(dealId);
        if (!cancelled && deal) setLiveStatus(deal.status);
      } catch {
        // Transient GraphQL hiccup — next poll tick will retry.
      }
    }

    poll();
    const interval = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [dealId, alreadyReleased]);

  // Stage timestamps only exist once a stage has actually happened on-chain
  // — re-poll alongside status so a freshly-Accepted/Delivered/Released
  // deal picks up its new timestamp without needing a manual refresh.
  useEffect(() => {
    let cancelled = false;

    async function poll() {
      try {
        const times = await findDealStageTimestamps(dealId);
        if (!cancelled) setStageTimes(times);
      } catch {
        // Transient GraphQL hiccup — next poll tick will retry.
      }
    }

    poll();
    const interval = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [dealId]);

  // The specialist's real granular checkpoint trail (see
  // move/sources/checkpoint.move) — polled alongside the coarse status so
  // a newly-pushed checkpoint appears here live, not just after a manual
  // refresh. Also fetch the deal's DealAllowlist once (its id doesn't
  // change) — needed by CheckpointItem to decrypt any attached photo.
  useEffect(() => {
    let cancelled = false;

    async function poll() {
      try {
        const found = await findCheckpointsForDeal(dealId);
        if (!cancelled) setCheckpoints(found);
      } catch {
        // Transient GraphQL hiccup — next poll tick will retry.
      }
    }

    poll();
    const interval = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [dealId]);

  useEffect(() => {
    let cancelled = false;
    findAllowlistForDeal(dealId)
      .then((found) => {
        if (!cancelled) setAllowlistId(found);
      })
      .catch(() => {
        if (!cancelled) setAllowlistId(null);
      });
    return () => {
      cancelled = true;
    };
  }, [dealId]);

  useEffect(() => {
    if (title !== null || (pending === "loading" && !metadata)) return;
    const amount = pending && pending !== "loading" ? pending.amountSui : 0;
    let cancelled = false;
    summarizeDealTitle(metadata?.category ?? "General", amount).then((t) => {
      setCachedDealTitle(dealId, t);
      if (!cancelled) setTitle(t);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [metadata, pending]);

  async function handleRelease() {
    if (!pending || pending === "loading") return;
    setReleasing(true);
    setReleaseStage(null);
    setReleaseError(null);
    try {
      const receipt = await releaseDeal(pending, setReleaseStage);
      onReleased(receipt);
    } catch (err) {
      setReleaseError(err instanceof Error ? err.message : String(err));
    } finally {
      setReleasing(false);
      setReleaseStage(null);
    }
  }

  const displayStatus = alreadyReleased ? "Released" : liveStatus;
  // The ORIGINAL amount, from the DealCreated event via metadata — not
  // Deal.escrowed_amount (which correctly reads 0 once release has paid
  // it out, and was wrongly shown as "0 SUI paid" before this fix).
  const amountSui = metadata ? Number(metadata.amountMist) / 1_000_000_000 : null;

  return (
    <div className={embedded ? "" : "mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-10"}>
      {!embedded && (
        <div className="mb-6 flex items-center justify-between">
          <button
            type="button"
            onClick={onBack}
            className="text-sm text-manifest transition-colors hover:text-vellum focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            ← Back to deals
          </button>
          <div className="flex items-center gap-2">
            <HideButton dealId={dealId} onHidden={onBack} />
            <button
              type="button"
              onClick={onReturnToChat}
              className="rounded-md border border-border px-3 py-1.5 text-sm text-vellum transition-colors hover:border-white/30"
            >
              Return to chat
            </button>
          </div>
        </div>
      )}

      <div className="rounded-xl border border-border bg-surface p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xl font-semibold tracking-tight text-vellum">
              {title ?? turn?.task ?? metadata?.category ?? "Deal"}
            </p>
            <p className="mt-1 font-data text-xs text-manifest">{dealId}</p>
          </div>
          {displayStatus && <StatusPill status={displayStatus} />}
        </div>

        <div className="mt-5 grid grid-cols-2 gap-4 border-t border-border pt-5 sm:grid-cols-4">
          <div>
            <p className="text-xs uppercase tracking-wide text-manifest">Amount</p>
            <p className="mt-1 font-data text-sm text-vellum">{amountSui !== null ? `${amountSui.toLocaleString(undefined, { maximumFractionDigits: 4 })} SUI` : "—"}</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-manifest">Category</p>
            <p className="mt-1 text-sm text-vellum">{metadata?.category ?? "—"}</p>
          </div>
          <div className="col-span-2 sm:col-span-2">
            <p className="text-xs uppercase tracking-wide text-manifest">Created</p>
            <p className="mt-1 text-sm text-vellum">{formatDateTime(metadata?.createdAtMs)}</p>
          </div>
        </div>

        {pending && pending !== "loading" && (
          <div className="mt-5 grid grid-cols-1 gap-4 border-t border-border pt-5 sm:grid-cols-2">
            <CopyableAddress label="Specialist" value={pending.counterpartyName} />
            <CopyableAddress label="Specialist wallet" value={pending.specialistOwnerAddress} />
          </div>
        )}
      </div>

      {turn && !turn.pending && (
        <div className="mt-6 rounded-xl border border-border bg-surface p-6">
          <p className="mb-4 text-sm font-medium text-vellum">Setup progress</p>
          <StatusFeed steps={turn.steps} onBack={onBack} />
        </div>
      )}

      {displayStatus && (
        <div className="mt-6 rounded-xl border border-border bg-surface p-6">
          <p className="mb-5 text-sm font-medium text-vellum">Status timeline</p>
          <Timeline
            status={displayStatus}
            createdAtMs={metadata?.createdAtMs}
            stageTimes={stageTimes}
            checkpoints={checkpoints}
            dealId={dealId}
            allowlistId={allowlistId}
          />

          {!alreadyReleased && liveStatus === "Delivered" && (
            <div className="border-t border-border pt-5">
              <p className="text-sm text-manifest">Delivered — ready to verify and release payment.</p>
              <button
                type="button"
                onClick={handleRelease}
                disabled={releasing || pending === "loading" || !pending}
                className="mt-3 rounded-md bg-white px-4 py-2 text-sm font-medium text-black transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {releasing ? "Releasing…" : pending === "loading" ? "Loading deal details…" : "Verify & Release Payment"}
              </button>
              {releasing && (
                <p className="mt-2 text-xs text-manifest">
                  {releaseStage ? RELEASE_STAGE_LABEL[releaseStage] : "Starting…"}
                </p>
              )}
              {releaseError && <p className="mt-2 text-sm text-wax">{releaseError}</p>}
            </div>
          )}
        </div>
      )}

      {alreadyReleased && (
        <div className="mt-6 rounded-xl border border-border bg-surface p-6">
          <p className="flex items-center gap-2 text-sm font-medium text-vellum">
            <span>✓</span>
            Payment released
          </p>
          <p className="mt-1 text-sm text-manifest">This deal is complete.</p>
        </div>
      )}

      <div className="mt-6">
        <NoteSection dealId={dealId} />
      </div>
    </div>
  );
}
