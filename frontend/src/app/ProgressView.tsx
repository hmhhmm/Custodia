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
import type { ConversationTurn, DealReceipt, PendingRelease } from "./types";
import { StatusFeed } from "./StatusFeed";
import {
  findDealById,
  findDealMetadata,
  findDealStageTimestamps,
  type DealStatusName,
  type DealMetadata,
  type DealStageTimestamps,
} from "../sui/deal-queries";
import { releaseDeal, reconstructPendingRelease } from "./release";
import { summarizeDealTitle } from "../agent/llm";
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
    Released: "text-emerald-400",
    Settled: "text-emerald-400",
    Disputed: "text-red-400",
    Refunded: "text-manifest",
  };
  return <span className={`text-xs font-medium ${style[status]}`}>{status}</span>;
}

function formatDateTime(ms: number | null | undefined): string {
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

/** Status timeline — a real progression readout (not just the current
 * status alone), so the page communicates the deal's full history at a
 * glance the way a professional order-tracking page would. */
function Timeline({
  status,
  createdAtMs,
  stageTimes,
}: {
  status: DealStatusName;
  createdAtMs: number | null | undefined;
  stageTimes: DealStageTimestamps | null;
}) {
  const currentRank = statusRank(status);
  const isDisputeLike = status === "Disputed" || status === "Refunded";

  return (
    <div className="flex flex-col gap-0">
      {TIMELINE_STAGES.map((stage, i) => {
        const stageRank = statusRank(stage.status);
        const done = !isDisputeLike && currentRank >= stageRank;
        const active = !isDisputeLike && currentRank === stageRank - 1;
        const isLast = i === TIMELINE_STAGES.length - 1;
        const ts = done ? stageTimestamp(stage.status, createdAtMs, stageTimes) : null;
        return (
          <div key={stage.status} className="flex gap-3">
            <div className="flex flex-col items-center">
              <span
                className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-xs ${
                  done
                    ? "border-emerald-500 bg-emerald-500 text-ink"
                    : active
                      ? "border-accent text-accent"
                      : "border-border text-manifest"
                }`}
              >
                {done ? "✓" : ""}
              </span>
              {!isLast && <span className={`w-px flex-1 ${done ? "bg-emerald-500/40" : "bg-border"}`} style={{ minHeight: "1.5rem" }} />}
            </div>
            <div className="flex flex-1 items-baseline justify-between gap-3 pb-6">
              <p className={`text-sm ${done || active ? "text-vellum" : "text-manifest"}`}>{stage.label}</p>
              {ts && <p className="shrink-0 text-xs text-manifest">{formatDateTime(ts)}</p>}
            </div>
          </div>
        );
      })}
      {isDisputeLike && (
        <p className="mt-1 text-sm text-wax">
          {status === "Disputed" ? "This deal was disputed before reaching release." : "This deal was refunded to the client's Mandate."}
        </p>
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
}) {
  const [pending, setPending] = useState<PendingRelease | "loading" | null>(turn?.pending ?? "loading");
  const [liveStatus, setLiveStatus] = useState<DealStatusName | null>(null);
  const [metadata, setMetadata] = useState<DealMetadata | null>(null);
  const [stageTimes, setStageTimes] = useState<DealStageTimestamps | null>(null);
  const [title, setTitle] = useState<string | null>(() => getCachedDealTitle(dealId));
  const [releasing, setReleasing] = useState(false);
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
    setReleaseError(null);
    try {
      const receipt = await releaseDeal(pending);
      onReleased(receipt);
    } catch (err) {
      setReleaseError(err instanceof Error ? err.message : String(err));
    } finally {
      setReleasing(false);
    }
  }

  const displayStatus = alreadyReleased ? "Released" : liveStatus;
  // The ORIGINAL amount, from the DealCreated event via metadata — not
  // Deal.escrowed_amount (which correctly reads 0 once release has paid
  // it out, and was wrongly shown as "0 SUI paid" before this fix).
  const amountSui = metadata ? Number(metadata.amountMist) / 1_000_000_000 : null;

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-10">
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
          <Timeline status={displayStatus} createdAtMs={metadata?.createdAtMs} stageTimes={stageTimes} />

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
              {releaseError && <p className="mt-2 text-sm text-wax">{releaseError}</p>}
            </div>
          )}
        </div>
      )}

      {alreadyReleased && (
        <div className="mt-6 rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-6">
          <p className="flex items-center gap-2 text-sm font-medium text-emerald-400">
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
