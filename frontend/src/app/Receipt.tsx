// Owner: Person 4 (frontend + orchestration).
//
// Receipt screen: closes the loop back to the dashboard. Per the design
// brief, "Back to your deals" must land on a dashboard that now includes
// this deal — state visibly persists rather than the receipt being a
// dead end. See App.tsx for how the new DealSummary gets appended.

import { Seal } from "./components/Seal";
import type { DealReceipt } from "./types";

export function Receipt({
  receipt,
  onBackToDeals,
}: {
  receipt: DealReceipt;
  onBackToDeals: () => void;
}) {
  return (
    <div className="flex flex-col items-center py-8 text-center">
      <Seal kind={receipt.verification.mocked ? "simulated" : "verified"} size={112} />

      <p className="mt-6 font-display text-xl font-semibold text-vellum">
        Paid {receipt.counterpartyName} · {receipt.amount} SUI
      </p>
      <p className="mt-1 text-sm text-manifest">
        {receipt.verification.mocked
          ? "Verified by a simulated attestation — see README for the real Nautilus integration path."
          : "Verified by Nautilus attestation."}
      </p>
      <p className="mt-1 font-data text-xs text-manifest">{receipt.verification.attestationId}</p>

      {receipt.explorerUrl && (
        <a
          href={receipt.explorerUrl}
          target="_blank"
          rel="noreferrer"
          className="mt-4 text-sm text-brass underline underline-offset-2"
        >
          View on Sui Explorer
        </a>
      )}

      <button
        type="button"
        onClick={onBackToDeals}
        className="mt-8 rounded border border-brass/50 px-5 py-2.5 text-sm font-medium text-vellum transition-colors hover:border-brass hover:bg-brass/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass"
      >
        Back to your deals
      </button>
    </div>
  );
}
