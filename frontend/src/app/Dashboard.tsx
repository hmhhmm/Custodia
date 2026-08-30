// Owner: Person 4 (frontend + orchestration).
//
// Dashboard / home screen — the app's resting state, reached inside the
// persistent shell (see AppShell.tsx). Always shows real state: a real
// grid of past/active deal cards, or, on first use, a written empty
// state. Never a blank screen. Cards (icon avatar, category tag, title,
// description, status) intentionally mirror a familiar
// marketplace/integrations-grid pattern, per direct design feedback,
// rather than the plain ledger-line list from the previous pass — the
// wax-seal signature moment (StatusFeed / Receipt) still carries the
// ledger/seal metaphor, this screen prioritizes at-a-glance scanning.

import type { DealSummary, DealSummaryStatus } from "./types";

const STATUS_STYLE: Record<DealSummaryStatus, { dot: string; label: string }> = {
  escrowed: { dot: "bg-accent", label: "Escrowed" },
  released: { dot: "bg-emerald-500", label: "Released" },
  disputed: { dot: "bg-red-500", label: "Disputed" },
};

/** Deterministic accent color per deal, derived from the counterparty
 * name — gives each card icon a distinct identity without needing real
 * per-agent branding data yet. Saturated colors here are deliberate (the
 * one place color is allowed to be vivid, matching how brand/app icons
 * work in reference marketplace grids) — everything else in the shell
 * stays neutral. */
const AVATAR_HUES = ["#0070f3", "#7c3aed", "#f59e0b", "#10b981", "#ec4899"];

function avatarColorFor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_HUES[hash % AVATAR_HUES.length];
}

function DealCard({ deal }: { deal: DealSummary }) {
  const status = STATUS_STYLE[deal.status];
  const avatarColor = avatarColorFor(deal.counterpartyName);

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-5 transition-colors hover:border-white/20 hover:bg-surface-hover">
      <div className="flex items-start justify-between gap-3">
        <div
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-base font-semibold text-white"
          style={{ backgroundColor: avatarColor }}
        >
          {deal.counterpartyName.slice(0, 1).toUpperCase()}
        </div>
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

export function Dashboard({
  deals,
  onNewDeal,
}: {
  deals: DealSummary[];
  onNewDeal: () => void;
}) {
  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight text-vellum">Your deals</h1>
        <button
          type="button"
          onClick={onNewDeal}
          className="rounded-md bg-white px-4 py-2 text-sm font-medium text-black transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          + New deal
        </button>
      </div>

      {deals.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border py-16 text-center">
          <p className="text-manifest">
            No deals yet. Describe what you need done, and Escrow finds who can do it.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {deals.map((deal) => (
            <DealCard key={deal.dealId} deal={deal} />
          ))}
        </div>
      )}
    </div>
  );
}
