// Owner: Person 4 (frontend + orchestration).
//
// Persistent app shell: present on every screen. This is the structural
// answer to "must read as real software" — a wordmark, real nav, and an
// always-visible identity indicator, so nothing ever renders as an
// isolated screen floating in empty space. `activeNav` and `identity`
// are placeholder-driven until Person 2's real zkLogin session and a
// real "Active Deals" vs "History" split exist — see App.tsx.

import type { ReactNode } from "react";

export type NavItem = "active" | "history";

export function AppShell({
  activeNav,
  onNavChange,
  identityLabel,
  children,
}: {
  activeNav: NavItem;
  onNavChange: (nav: NavItem) => void;
  identityLabel: string;
  children: ReactNode;
}) {
  return (
    <div className="min-h-screen bg-ink text-vellum">
      <header className="rule-brass border-b px-4 py-4 sm:px-6">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-4 sm:gap-8">
            <span className="shrink-0 font-display text-base font-semibold tracking-[0.1em] text-vellum sm:text-lg sm:tracking-[0.15em]">
              WARRANT
            </span>
            <nav className="flex items-center gap-3 text-xs sm:gap-6 sm:text-sm">
              <button
                type="button"
                onClick={() => onNavChange("active")}
                className={`whitespace-nowrap border-b-2 pb-0.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass ${
                  activeNav === "active"
                    ? "border-brass text-vellum"
                    : "border-transparent text-manifest hover:text-vellum"
                }`}
              >
                <span className="sm:hidden">Active</span>
                <span className="hidden sm:inline">Active Deals</span>
              </button>
              <button
                type="button"
                onClick={() => onNavChange("history")}
                className={`whitespace-nowrap border-b-2 pb-0.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass ${
                  activeNav === "history"
                    ? "border-brass text-vellum"
                    : "border-transparent text-manifest hover:text-vellum"
                }`}
              >
                History
              </button>
            </nav>
          </div>

          <div
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-brass/40 font-data text-xs text-manifest"
            title={identityLabel}
          >
            {identityLabel.slice(0, 1).toUpperCase()}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-10">{children}</main>
    </div>
  );
}
