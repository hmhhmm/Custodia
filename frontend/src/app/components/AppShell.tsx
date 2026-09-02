// Persistent app shell: present on every screen — a wordmark, real nav,
// and an account icon that opens a full Settings screen (see
// Settings.tsx) rather than a dropdown menu, so it can hold real content.
//
// Content width: max-w-6xl (not max-w-3xl) so a multi-column dashboard
// grid actually uses the viewport instead of squeezing into a narrow
// centered column.

import type { ReactNode } from "react";

export type NavItem = "deals" | "mandate" | "settings";

export function AppShell({
  activeNav,
  onNavChange,
  address,
  children,
}: {
  activeNav: NavItem;
  onNavChange: (nav: NavItem) => void;
  address: string;
  children: ReactNode;
}) {
  return (
    <div className="min-h-screen bg-ink text-vellum">
      <header className="border-b border-border px-4 py-4 sm:px-6">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-4 sm:gap-8">
            <span className="shrink-0 text-base font-semibold tracking-tight text-vellum sm:text-lg">
              Custodia
            </span>
            <nav className="flex items-center gap-3 text-xs sm:gap-6 sm:text-sm">
              <button
                type="button"
                onClick={() => onNavChange("deals")}
                className={`whitespace-nowrap border-b-2 pb-0.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                  activeNav === "deals"
                    ? "border-vellum text-vellum"
                    : "border-transparent text-manifest hover:text-vellum"
                }`}
              >
                Deals
              </button>
              <button
                type="button"
                onClick={() => onNavChange("mandate")}
                className={`whitespace-nowrap border-b-2 pb-0.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                  activeNav === "mandate"
                    ? "border-vellum text-vellum"
                    : "border-transparent text-manifest hover:text-vellum"
                }`}
              >
                Mandate
              </button>
            </nav>
          </div>

          <button
            type="button"
            onClick={() => onNavChange("settings")}
            title={address}
            className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border font-data text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
              activeNav === "settings"
                ? "border-white/30 text-vellum"
                : "border-border text-manifest hover:border-white/30 hover:text-vellum"
            }`}
          >
            {address.slice(2, 3).toUpperCase()}
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-10">{children}</main>
    </div>
  );
}
