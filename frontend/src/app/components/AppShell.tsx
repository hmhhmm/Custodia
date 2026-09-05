// Persistent app shell: present on every screen — a wordmark, real nav
// (Chat is the home tab, Deals and Mandate are secondary destinations),
// and an account dropdown with real content (address, wallet, network,
// disconnect) instead of a full Settings screen — see AccountMenu below.
//
// Header is taller (py-5) with more gap between nav items than earlier
// passes — the original felt cramped with everything packed against the
// wordmark.
//
// Chat's own layout manages its own height/scroll (ChatPanel.tsx); Deals
// and Mandate use the full viewport width themselves rather than a single
// shared max-width here, since a squeezed centered column was exactly the
// complaint that prompted this rework.

import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useCurrentWallet, useCurrentNetwork, useDAppKit } from "@mysten/dapp-kit-react";

export type NavItem = "chat" | "deals" | "mandate" | "specialist" | "verify";

function truncateAddress(address: string): string {
  return `${address.slice(0, 8)}…${address.slice(-6)}`;
}

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
    <div className="flex h-screen flex-col overflow-x-hidden bg-ink text-vellum">
      <header className="shrink-0 border-b border-border px-5 py-4 sm:px-8">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-6">
          <div className="flex min-w-0 items-center gap-8 sm:gap-12">
            <span className="shrink-0 text-xl font-semibold tracking-tight text-vellum">Custodia</span>
            <nav className="flex items-center gap-1 rounded-full border border-border bg-surface p-1.5">
              <NavLink label="Chat" active={activeNav === "chat"} onClick={() => onNavChange("chat")} />
              <NavLink label="Deals" active={activeNav === "deals"} onClick={() => onNavChange("deals")} />
              <NavLink label="Mandate" active={activeNav === "mandate"} onClick={() => onNavChange("mandate")} />
              <NavLink label="Specialist" active={activeNav === "specialist"} onClick={() => onNavChange("specialist")} />
              <NavLink label="Verify" active={activeNav === "verify"} onClick={() => onNavChange("verify")} />
            </nav>
          </div>

          <AccountMenu address={address} />
        </div>
      </header>

      {/* min-h-0 lets a flex child shrink below its content size — without
          it, a scrollable descendant (ChatPanel's message list) can't
          actually constrain itself and the whole page scrolls instead. */}
      <main className="min-h-0 flex-1 overflow-y-auto">{children}</main>
    </div>
  );
}

function NavLink({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`whitespace-nowrap rounded-full px-6 py-2.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
        active ? "bg-surface-hover text-vellum" : "text-manifest hover:text-vellum"
      }`}
    >
      {label}
    </button>
  );
}

function AccountMenu({ address }: { address: string }) {
  const wallet = useCurrentWallet();
  const network = useCurrentNetwork();
  const dAppKit = useDAppKit();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  async function handleCopy() {
    await navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div ref={menuRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={address}
        className={`flex h-10 w-10 items-center justify-center rounded-full font-data text-sm font-medium text-vellum transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
          open ? "ring-2 ring-white/30" : "hover:ring-2 hover:ring-white/15"
        }`}
        style={{ background: "linear-gradient(135deg, #3a3a3a, var(--color-surface-hover))" }}
      >
        {address.slice(2, 3).toUpperCase()}
      </button>

      {open && (
        <div className="absolute right-0 top-12 z-20 w-80 overflow-hidden rounded-xl border border-border bg-surface shadow-xl shadow-black/50">
          <div className="border-b border-border p-5">
            <div className="flex items-center gap-3">
              <div
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full font-data text-base font-medium text-vellum"
                style={{ background: "linear-gradient(135deg, #3a3a3a, var(--color-surface-hover))" }}
              >
                {address.slice(2, 3).toUpperCase()}
              </div>
              <div className="min-w-0">
                <p className="truncate font-data text-sm text-vellum">{truncateAddress(address)}</p>
                <p className="mt-0.5 text-xs text-manifest">Connected via {wallet?.name ?? "Unknown wallet"}</p>
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-1 p-3">
            <div className="flex items-center justify-between rounded-lg px-3 py-2.5">
              <span className="text-xs uppercase tracking-wide text-manifest">Address</span>
              <button
                type="button"
                onClick={handleCopy}
                className="rounded-md border border-border px-2.5 py-1 text-xs text-vellum transition-colors hover:border-white/30"
              >
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
            <div className="flex items-center justify-between rounded-lg px-3 py-2.5">
              <span className="text-xs uppercase tracking-wide text-manifest">Wallet</span>
              <span className="text-sm text-vellum">{wallet?.name ?? "Unknown"}</span>
            </div>
            <div className="flex items-center justify-between rounded-lg px-3 py-2.5">
              <span className="text-xs uppercase tracking-wide text-manifest">Network</span>
              <span className="flex items-center gap-1.5 text-sm text-vellum">
                <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-hidden="true" />
                {network.charAt(0).toUpperCase() + network.slice(1)}
              </span>
            </div>
          </div>

          <div className="border-t border-border p-3">
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                dAppKit.disconnectWallet();
              }}
              className="w-full rounded-lg px-3 py-2.5 text-left text-sm font-medium text-vellum transition-colors hover:bg-wax/10 hover:text-wax"
            >
              Disconnect
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
