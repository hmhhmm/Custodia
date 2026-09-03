// Deals tab — the app's resting state. Its list is derived from REAL
// on-chain Deal objects (client_agent === Envoy's AgentIdentity), not from
// ConversationTurn state — turns live only in React memory and are lost on
// refresh, which used to make a genuinely in-progress deal disappear from
// this tab the moment the page reloaded even though the Deal object itself
// was untouched on-chain. Live in-session turns (this browser tab, this
// session, still animating through its steps) are still shown for the
// nicer live progress bar, but the underlying deal list itself always
// comes from chain first.
//
// "Hide" (never "Delete") on a card only ever changes local display state
// (see deal-local-meta.ts) — a real Deal can't be erased once created, only
// moved through its state machine, so hiding is honest about what actually
// happens: the deal stays on-chain forever, this browser just stops
// showing the card.
//
// max-w-7xl (not max-w-6xl) to match AppShell's header width exactly —
// the grid should feel like it uses the same canvas as the rest of the
// app, not a narrower column floating inside it.

import { useEffect, useState } from "react";
import type { ConversationTurn, StatusStep } from "./types";
import type { SpecialistDeal, DealStatusName } from "../sui/deal-queries";
import { findDealsForClient, findDealMetadata, type DealMetadata } from "../sui/deal-queries";
import { findOwnedAgentIdentity } from "../sui/onboarding-status";
import { ENVOY_ADDRESS } from "../sui/envoy-signer";
import { isDealHidden, getCachedDealTitle, setCachedDealTitle } from "./deal-local-meta";
import { summarizeDealTitle } from "../agent/llm";

function mistToSui(mist: bigint): number {
  return Number(mist) / 1_000_000_000;
}

/** No pills, no backgrounds — plain text status labels, like a data
 * table's status column rather than a colorful badge. Neutral gray for
 * every in-progress status; the two outcomes that matter (paid,
 * disputed) get color on the text alone, nothing else. */
const STATUS_STYLE: Record<DealStatusName, { text: string; label: string }> = {
  Negotiating: { text: "text-manifest", label: "Negotiating" },
  Escrowed: { text: "text-manifest", label: "Escrowed" },
  Accepted: { text: "text-manifest", label: "Accepted" },
  Delivered: { text: "text-slate-400", label: "Delivered" },
  Verified: { text: "text-manifest", label: "Verified" },
  Released: { text: "text-emerald-400", label: "Released" },
  Disputed: { text: "text-red-400", label: "Disputed" },
  Refunded: { text: "text-manifest", label: "Refunded" },
  Settled: { text: "text-emerald-400", label: "Settled" },
};

/** Category icon set — a small, deliberately simple line-icon per
 * category instead of a flat letter avatar, so a card reads as "what kind
 * of work" at a glance rather than "whose initial is this." Falls back to
 * a generic document glyph for an unrecognized category. */
function CategoryIcon({ category }: { category: string }) {
  const key = category.toLowerCase();
  const common = { width: 18, height: 18, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.75, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

  if (key.includes("legal") || key.includes("review")) {
    return (
      <svg {...common}>
        <path d="M12 3v18M8 6h8M5 6l3 6-3 6M19 6l-3 6 3 6" />
      </svg>
    );
  }
  if (key.includes("logistic") || key.includes("courier")) {
    return (
      <svg {...common}>
        <path d="M3 7h11v9H3zM14 10h4l3 3v3h-7zM6.5 20a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3ZM17.5 20a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z" />
      </svg>
    );
  }
  if (key.includes("translat")) {
    return (
      <svg {...common}>
        <path d="M4 5h9M7 3v2M4 8c1.5 3 4 5.5 7 7M11 8c-1.5 3-4 5.5-7 7M15 20l4-9 4 9M16.3 17h5.4" />
      </svg>
    );
  }
  if (key.includes("design")) {
    return (
      <svg {...common}>
        <path d="M12 2l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 15.9 6.8 18l1-5.8L3.5 8.1l5.9-.9L12 2Z" />
      </svg>
    );
  }
  if (key.includes("research")) {
    return (
      <svg {...common}>
        <circle cx="11" cy="11" r="7" />
        <path d="M21 21l-4.5-4.5" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <path d="M7 3h7l4 4v14H7V3ZM14 3v4h4M9 12h6M9 16h6" />
    </svg>
  );
}

/** Monochrome card icon — a plain neutral surface square with a white/
 * light-gray glyph, no per-category color. Category is conveyed by the
 * text label badge next to it, not by icon color; this keeps the grid
 * quiet and consistent (Linear/Notion-style) instead of a rainbow of
 * per-category tints. */
function CardIcon({ category, tone = "neutral" }: { category?: string; tone?: "neutral" | "active" | "failed" }) {
  if (tone === "failed") {
    return (
      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-wax/15">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--color-wax)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 6L6 18M6 6l12 12" />
        </svg>
      </div>
    );
  }
  if (tone === "active") {
    return (
      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-surface-hover">
        <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-vellum" aria-hidden="true" />
      </div>
    );
  }
  return (
    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-surface-hover text-vellum">
      <CategoryIcon category={category ?? ""} />
    </div>
  );
}

function formatDateTime(ms: number | null): string {
  if (ms === null) return "Unknown";
  return new Date(ms).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Fetches (and persistently caches) a deal's Gemini title — shared by the
 * compact card and the detail modal so both show the same text without
 * either one needing to own the fetch. */
function useDealTitle(dealId: string, category: string | undefined, amountSui: number): string | null {
  const [title, setTitle] = useState<string | null>(() => getCachedDealTitle(dealId));

  useEffect(() => {
    if (title !== null) return;
    let cancelled = false;
    summarizeDealTitle(category ?? "General", amountSui).then((t) => {
      setCachedDealTitle(dealId, t);
      if (!cancelled) setTitle(t);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dealId, category]);

  return title;
}

/** Card — a colored left accent bar and status-colored dot/label give the
 * status real visual weight at a glance (previously every non-terminal
 * status shared the same flat violet dot, so nothing stood out — "the
 * grey colour" this was reported for). Clicking goes straight to the full
 * ProgressView page — no inline expand, no modal; the card's only job is
 * to be scannable, not to hold detail. */
function ChainDealCard({
  deal,
  metadata,
  onOpen,
}: {
  deal: SpecialistDeal;
  metadata: DealMetadata | undefined;
  onOpen: () => void;
}) {
  const status = STATUS_STYLE[deal.status];
  const category = metadata?.category;
  const title = useDealTitle(deal.dealId, category, mistToSui(deal.escrowedAmountMist));

  return (
    <button
      type="button"
      onClick={onOpen}
      className="group flex w-full flex-col gap-4 overflow-hidden rounded-xl border border-border bg-surface p-5 text-left transition-colors hover:border-white/20 hover:bg-surface-hover"
    >
      <div className="flex items-start justify-between gap-3">
        <CardIcon category={category} />
        <span className={`text-xs font-medium ${status.text}`}>{status.label}</span>
      </div>

      <div className="min-w-0">
        <p className="truncate text-base font-medium text-vellum">
          {title ?? <span className="inline-block h-4 w-32 animate-pulse rounded bg-surface-hover align-middle" />}
        </p>
        <p className="mt-1 flex items-center gap-1.5 text-xs text-manifest">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
            <circle cx="12" cy="12" r="10" />
            <path d="M12 6v6l4 2" />
          </svg>
          {formatDateTime(metadata?.createdAtMs ?? null)}
        </p>
      </div>

      <div className="flex items-center justify-between border-t border-border pt-3 text-sm">
        <span className="font-data text-vellum">
          {mistToSui(deal.escrowedAmountMist).toLocaleString(undefined, { maximumFractionDigits: 4 })} SUI
        </span>
        <span className="text-manifest transition-transform group-hover:translate-x-0.5">→</span>
      </div>
    </button>
  );
}

/** The current step's label for an in-progress deal turn, e.g. "Escrow
 * locked" — whichever step is "active", or the last "done" one if none is
 * active yet (a brief gap between steps). */
function currentStepLabel(steps: StatusStep[]): string {
  const active = steps.find((s) => s.state === "active");
  if (active) return active.label;
  const failed = steps.find((s) => s.state === "failed");
  if (failed) return failed.label;
  const doneSteps = steps.filter((s) => s.state === "done");
  return doneSteps[doneSteps.length - 1]?.label ?? "Starting…";
}

function InProgressCard({
  turn,
  onClick,
  onReturnToChat,
}: {
  turn: Extract<ConversationTurn, { kind: "deal" }>;
  onClick: () => void;
  onReturnToChat: (threadId: string) => void;
}) {
  const failed = turn.steps.some((s) => s.state === "failed");
  const doneCount = turn.steps.filter((s) => s.state === "done").length;

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-5 text-left transition-colors hover:border-white/20 hover:bg-surface-hover">
      <button type="button" onClick={onClick} className="flex flex-col gap-4 text-left">
        <div className="flex items-start justify-between gap-3">
          <CardIcon tone={failed ? "failed" : "active"} />
          <span className="rounded-full border border-border px-2.5 py-1 text-xs text-manifest">
            {failed ? "Failed" : "In progress"}
          </span>
        </div>

        <div>
          <p className="line-clamp-2 font-medium text-vellum">{turn.task}</p>
          <p className="mt-1 text-sm text-manifest">{currentStepLabel(turn.steps)}</p>
        </div>

        <div className="border-t border-border pt-3">
          <div className="h-1 w-full overflow-hidden rounded-full bg-ink">
            <div
              className={`h-full rounded-full transition-[width] ${failed ? "bg-wax" : "bg-vellum"}`}
              style={{ width: `${Math.min(100, (doneCount / (turn.steps.length || 9)) * 100)}%` }}
            />
          </div>
          <p className="mt-2 text-xs text-manifest">{doneCount} of {turn.steps.length || 9} steps complete</p>
        </div>
      </button>

      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onReturnToChat(turn.threadId);
        }}
        className="rounded-md border border-border px-3 py-1.5 text-xs text-vellum transition-colors hover:border-white/30"
      >
        Return to chat
      </button>
    </div>
  );
}

export function Dashboard({
  turns,
  onNewDeal,
  onOpenDeal,
  onOpenChainDeal,
  onReturnToChat,
}: {
  turns: ConversationTurn[];
  onNewDeal: () => void;
  onOpenDeal: (dealTurnId: string) => void;
  onOpenChainDeal: (dealId: string) => void;
  onReturnToChat: (threadId: string) => void;
}) {
  const [chainDeals, setChainDeals] = useState<SpecialistDeal[]>([]);
  const [metadataByDeal, setMetadataByDeal] = useState<Map<string, DealMetadata>>(new Map());
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [showHidden, setShowHidden] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");

    findOwnedAgentIdentity(ENVOY_ADDRESS, "client")
      .then((envoyAgent) => {
        if (!envoyAgent) {
          if (!cancelled) {
            setChainDeals([]);
            setStatus("ready");
          }
          return;
        }
        return Promise.all([findDealsForClient(envoyAgent.agentId), findDealMetadata()]).then(([found, meta]) => {
          if (cancelled) return;
          setChainDeals(found);
          setMetadataByDeal(meta);
          setStatus("ready");
        });
      })
      .catch(() => {
        if (!cancelled) setStatus("error");
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // Live in-session turns still driving their own step animation (escrow
  // just locked, waiting on specialist) — these overlap with chainDeals
  // once escrow lands, so chain-derived rows for the SAME dealId are
  // suppressed below in favor of the richer live card.
  const inProgress = turns.filter(
    (t): t is Extract<ConversationTurn, { kind: "deal" }> => t.kind === "deal" && !t.receipt,
  );
  const liveTrackedDealIds = new Set(inProgress.map((t) => t.pending?.dealId).filter((id): id is string => !!id));

  const notLiveTracked = chainDeals.filter((d) => !liveTrackedDealIds.has(d.dealId));
  const visibleChainDeals = showHidden ? notLiveTracked : notLiveTracked.filter((d) => !isDealHidden(d.dealId));
  const hiddenCount = notLiveTracked.filter((d) => isDealHidden(d.dealId)).length;

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-10 lg:px-8">
      <div className="mb-8 flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight text-vellum">Your deals</h1>
        <div className="flex items-center gap-3">
          {hiddenCount > 0 && (
            <button
              type="button"
              onClick={() => setShowHidden((v) => !v)}
              className="rounded-md border border-border px-3 py-2 text-sm text-manifest transition-colors hover:border-white/30 hover:text-vellum"
            >
              {showHidden ? "Hide hidden deals" : `Show hidden (${hiddenCount})`}
            </button>
          )}
          <button
            type="button"
            onClick={onNewDeal}
            className="rounded-md bg-white px-4 py-2 text-sm font-medium text-black transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            Ask Envoy
          </button>
        </div>
      </div>

      {inProgress.length > 0 && (
        <div className="mb-10">
          <h2 className="mb-4 text-sm font-medium text-manifest">In progress</h2>
          <div className="grid grid-cols-1 items-start gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {inProgress.map((turn) => (
              <InProgressCard key={turn.id} turn={turn} onClick={() => onOpenDeal(turn.id)} onReturnToChat={onReturnToChat} />
            ))}
          </div>
        </div>
      )}

      {status === "loading" && <p className="text-sm text-manifest">Loading your deals from chain…</p>}
      {status === "error" && <p className="text-sm text-wax">Couldn't load deals right now. Try again shortly.</p>}

      {status === "ready" && visibleChainDeals.length === 0 && inProgress.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border py-16 text-center">
          <p className="text-manifest">
            No deals yet. Describe what you need done, and Custodia finds who can do it.
          </p>
        </div>
      ) : status === "ready" && visibleChainDeals.length > 0 ? (
        <div>
          {inProgress.length > 0 && <h2 className="mb-4 text-sm font-medium text-manifest">All deals</h2>}
          <div className="grid grid-cols-1 items-start gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {visibleChainDeals.map((deal) => (
              <ChainDealCard
                key={deal.dealId}
                deal={deal}
                metadata={metadataByDeal.get(deal.dealId)}
                onOpen={() => onOpenChainDeal(deal.dealId)}
              />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
