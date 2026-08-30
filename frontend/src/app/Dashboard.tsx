// Owner: Person 4 (frontend + orchestration).
//
// Dashboard / home screen — the app's resting state, reached inside the
// persistent shell (see AppShell.tsx). Always shows real state: a real
// ledger of past/active deals, or, on first use, a written empty state.
// Never a blank screen. Rows read like ledger lines (counterparty,
// amount, status) rather than cards — consistent with the ledger
// metaphor rather than a generic dashboard "widget" look.

import type { DealSummary, DealSummaryStatus } from "./types";

const STATUS_GLYPH: Record<DealSummaryStatus, { glyph: string; color: string; label: string }> = {
  escrowed: { glyph: "◐", color: "text-brass", label: "Escrowed" },
  released: { glyph: "●", color: "text-verdigris", label: "Released" },
  disputed: { glyph: "◔", color: "text-wax", label: "Disputed" },
};

function DealRow({ deal }: { deal: DealSummary }) {
  const status = STATUS_GLYPH[deal.status];
  return (
    <div className="flex flex-col gap-1 border-b border-brass/15 py-3 text-sm last:border-b-0 sm:flex-row sm:items-center sm:justify-between sm:gap-0">
      <span className="truncate font-data text-vellum">{deal.counterpartyName}</span>
      <div className="flex items-center justify-between gap-3 sm:contents">
        <span className="font-data text-manifest">{deal.amount} SUI</span>
        <span className={`flex items-center gap-2 font-data ${status.color}`}>
          <span aria-hidden="true">{status.glyph}</span>
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
        <h1 className="font-display text-2xl font-semibold text-vellum">Your deals</h1>
        <button
          type="button"
          onClick={onNewDeal}
          className="rounded border border-brass/50 px-4 py-2 text-sm font-medium text-vellum transition-colors hover:border-brass hover:bg-brass/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass"
        >
          + New deal
        </button>
      </div>

      {deals.length === 0 ? (
        <div className="rule-brass rounded border border-dashed py-16 text-center">
          <p className="text-manifest">
            No deals yet. Describe what you need done, and Warrant finds who can do it.
          </p>
        </div>
      ) : (
        <div className="rule-brass rounded border px-4">
          {deals.map((deal) => (
            <DealRow key={deal.dealId} deal={deal} />
          ))}
        </div>
      )}
    </div>
  );
}
