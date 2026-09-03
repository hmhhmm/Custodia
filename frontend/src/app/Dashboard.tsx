// Deals tab — the app's resting state. Shows in-progress deals (live from
// the Chat tab's ConversationTurn state) above the completed/history
// grid, or a written empty state on first use. Clicking an in-progress
// card opens ProgressView.tsx, a dedicated standalone screen — not back
// into Chat, since the two are separate ways to track the same deal.
//
// max-w-7xl (not max-w-6xl) to match AppShell's header width exactly —
// the grid should feel like it uses the same canvas as the rest of the
// app, not a narrower column floating inside it.

import type { ConversationTurn, DealSummary, DealSummaryStatus, StatusStep } from "./types";

const STATUS_STYLE: Record<DealSummaryStatus, { dot: string; label: string }> = {
  escrowed: { dot: "bg-accent", label: "Escrowed" },
  released: { dot: "bg-emerald-500", label: "Released" },
  disputed: { dot: "bg-red-500", label: "Disputed" },
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

function DealCard({ deal }: { deal: DealSummary }) {
  const status = STATUS_STYLE[deal.status];

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-5 transition-colors hover:border-white/20 hover:bg-surface-hover">
      <div className="flex items-start justify-between gap-3">
        <CardIcon category={deal.category} />
        <span className="rounded-full border border-border px-2.5 py-1 text-xs text-manifest">
          {deal.category}
        </span>
      </div>

      <div>
        <p className="truncate font-medium text-vellum">{deal.counterpartyName}</p>
        <p className="mt-1 line-clamp-2 text-sm text-manifest">{deal.description}</p>
      </div>

      <div className="mt-auto flex items-center justify-between border-t border-border pt-3 text-sm">
        <span className="font-data text-manifest">{deal.amount} SUI</span>
        <span className="flex items-center gap-1.5 text-vellum">
          <span className={`h-1.5 w-1.5 rounded-full ${status.dot}`} aria-hidden="true" />
          {status.label}
        </span>
      </div>
    </div>
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

function InProgressCard({ turn, onClick }: { turn: Extract<ConversationTurn, { kind: "deal" }>; onClick: () => void }) {
  const failed = turn.steps.some((s) => s.state === "failed");
  const doneCount = turn.steps.filter((s) => s.state === "done").length;

  return (
    <button
      type="button"
      onClick={onClick}
      className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-5 text-left transition-colors hover:border-white/20 hover:bg-surface-hover"
    >
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

      <div className="mt-auto border-t border-border pt-3">
        <div className="h-1 w-full overflow-hidden rounded-full bg-ink">
          <div
            className={`h-full rounded-full transition-[width] ${failed ? "bg-wax" : "bg-vellum"}`}
            style={{ width: `${Math.min(100, (doneCount / (turn.steps.length || 9)) * 100)}%` }}
          />
        </div>
        <p className="mt-2 text-xs text-manifest">{doneCount} of {turn.steps.length || 9} steps complete</p>
      </div>
    </button>
  );
}

export function Dashboard({
  deals,
  turns,
  onNewDeal,
  onOpenDeal,
}: {
  deals: DealSummary[];
  turns: ConversationTurn[];
  onNewDeal: () => void;
  onOpenDeal: (dealTurnId: string) => void;
}) {
  const inProgress = turns.filter(
    (t): t is Extract<ConversationTurn, { kind: "deal" }> => t.kind === "deal" && !t.receipt,
  );

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-10 lg:px-8">
      <div className="mb-8 flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight text-vellum">Your deals</h1>
        <button
          type="button"
          onClick={onNewDeal}
          className="rounded-md bg-white px-4 py-2 text-sm font-medium text-black transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          Ask Envoy
        </button>
      </div>

      {inProgress.length > 0 && (
        <div className="mb-10">
          <h2 className="mb-4 text-sm font-medium text-manifest">In progress</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {inProgress.map((turn) => (
              <InProgressCard key={turn.id} turn={turn} onClick={() => onOpenDeal(turn.id)} />
            ))}
          </div>
        </div>
      )}

      {deals.length === 0 && inProgress.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border py-16 text-center">
          <p className="text-manifest">
            No deals yet. Describe what you need done, and Custodia finds who can do it.
          </p>
        </div>
      ) : deals.length > 0 ? (
        <div>
          {inProgress.length > 0 && <h2 className="mb-4 text-sm font-medium text-manifest">Completed</h2>}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {deals.map((deal) => (
              <DealCard key={deal.dealId} deal={deal} />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
