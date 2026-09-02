// Settings screen — reached via the account icon in AppShell. Shows only
// what this app genuinely knows about the connected account: the address,
// the connected wallet, the network, and a disconnect action. Mandate
// spend/limit details live exclusively on the Mandate tab, not duplicated
// here.

import { useState } from "react";
import { useCurrentWallet, useCurrentNetwork, useDAppKit } from "@mysten/dapp-kit-react";

export function Settings({ address }: { address: string }) {
  const wallet = useCurrentWallet();
  const network = useCurrentNetwork();
  const dAppKit = useDAppKit();
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    await navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="mx-auto max-w-xl">
      <h1 className="text-2xl font-semibold tracking-tight text-vellum">Settings</h1>

      <div className="mt-8 flex flex-col gap-4">
        <div className="rounded-lg border border-border p-5">
          <p className="text-sm text-manifest">Address</p>
          <div className="mt-2 flex items-center justify-between gap-3">
            <p className="truncate font-data text-sm text-vellum">{address}</p>
            <button
              type="button"
              onClick={handleCopy}
              className="shrink-0 rounded-md border border-border px-3 py-1.5 text-xs text-vellum transition-colors hover:border-white/30"
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        </div>

        <div className="rounded-lg border border-border p-5">
          <p className="text-sm text-manifest">Wallet</p>
          <p className="mt-2 text-sm text-vellum">{wallet?.name ?? "Unknown"}</p>
        </div>

        <div className="rounded-lg border border-border p-5">
          <p className="text-sm text-manifest">Network</p>
          <p className="mt-2 flex items-center gap-2 text-sm text-vellum">
            {/* Only testnet is registered in sui/dapp-kit.ts today — this
                renders correctly if/when mainnet is added there too. */}
            <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-hidden="true" />
            Sui {network.charAt(0).toUpperCase() + network.slice(1)}
          </p>
        </div>

        <button
          type="button"
          onClick={() => dAppKit.disconnectWallet()}
          className="mt-2 self-start rounded-md border border-border px-4 py-2 text-sm font-medium text-vellum transition-colors hover:border-wax hover:text-wax"
        >
          Disconnect
        </button>
      </div>
    </div>
  );
}
