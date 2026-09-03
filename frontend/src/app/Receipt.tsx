// Receipt screen: closes the loop back to the dashboard — "Back to your
// deals" lands on a dashboard that now includes this deal. See App.tsx for
// how the new DealSummary gets appended.

import { useState } from "react";
import { CurrentAccountSigner, type DAppKit } from "@mysten/dapp-kit-core";
import { dAppKit } from "../sui/dapp-kit";
import { readBlob } from "../verification/walrus";
import { decryptDealContent } from "../verification/seal";
import type { DealReceipt } from "./types";

export function Receipt({
  receipt,
  onBackToDeals,
}: {
  receipt: DealReceipt;
  onBackToDeals: () => void;
}) {
  const [deliverableText, setDeliverableText] = useState<string | null>(null);
  const [decryptStatus, setDecryptStatus] = useState<"idle" | "loading" | "error">("idle");
  const [decryptError, setDecryptError] = useState<string | null>(null);

  async function handleViewDeliverable() {
    setDecryptStatus("loading");
    setDecryptError(null);
    try {
      const encrypted = await readBlob(receipt.deliverable.blobId);
      // CurrentAccountSigner's constructor param type is hard-coded to
      // DAppKit<[]> (an empty tuple) rather than the module-augmented
      // Register['dAppKit'] type dapp-kit.ts declares — a real typing gap
      // in @mysten/dapp-kit-core, not a mistake here (our dAppKit
      // genuinely satisfies the same shape at runtime; only the networks
      // tuple's literal type differs). VERIFY this cast is still needed
      // next time @mysten/dapp-kit-core is upgraded.
      const signer = new CurrentAccountSigner(dAppKit as unknown as DAppKit);
      const decrypted = await decryptDealContent(
        encrypted,
        dAppKit.getClient(),
        receipt.deliverable.allowlistId,
        receipt.deliverable.seedId,
        signer,
      );
      setDeliverableText(new TextDecoder().decode(decrypted));
      setDecryptStatus("idle");
    } catch (err) {
      setDecryptStatus("error");
      setDecryptError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="flex flex-col items-center py-8 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-surface-hover text-emerald-500">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20 6 9 17l-5-5" />
        </svg>
      </div>

      <div className="mt-4 flex items-center gap-2">
        <p className="text-xl font-semibold tracking-tight text-vellum">
          Paid {receipt.counterpartyName} · {receipt.amount} SUI
        </p>
        {receipt.verification.mocked && (
          <span className="rounded-full border border-border px-2 py-0.5 text-xs text-manifest">Simulated</span>
        )}
      </div>
      <p className="mt-1 text-sm text-manifest">
        {receipt.verification.mocked
          ? "Verified by a simulated attestation — see README for the real Nautilus integration path."
          : "Verified by Nautilus attestation."}
      </p>
      <p className="mt-1 font-data text-xs text-manifest">{receipt.verification.attestationId}</p>

      <div className="mt-6 w-full max-w-md rounded-lg border border-border p-5 text-left">
        <p className="font-medium text-vellum">Deliverable</p>
        <p className="mt-1 text-sm text-manifest">
          Encrypted with Seal and stored on Walrus — only you and {receipt.counterpartyName} can
          decrypt it.
        </p>
        {deliverableText ? (
          <pre className="mt-3 whitespace-pre-wrap font-data text-xs text-vellum">{deliverableText}</pre>
        ) : (
          <button
            type="button"
            onClick={handleViewDeliverable}
            disabled={decryptStatus === "loading"}
            className="mt-3 rounded-md border border-border px-3 py-1.5 text-sm text-vellum transition-colors hover:border-white/30 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {decryptStatus === "loading" ? "Decrypting…" : "Decrypt and view"}
          </button>
        )}
        {decryptStatus === "error" && <p className="mt-2 text-sm text-wax">{decryptError}</p>}
      </div>

      {receipt.explorerUrl && (
        <a
          href={receipt.explorerUrl}
          target="_blank"
          rel="noreferrer"
          className="mt-4 text-sm text-accent underline underline-offset-2"
        >
          View on Sui Explorer
        </a>
      )}

      <button
        type="button"
        onClick={onBackToDeals}
        className="mt-8 rounded-md bg-white px-5 py-2.5 text-sm font-medium text-black transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        Back to your deals
      </button>
    </div>
  );
}
