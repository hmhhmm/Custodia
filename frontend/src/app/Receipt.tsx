// Owner: Person 4 (frontend + orchestration).
//
// Receipt screen: final delivered result plus a compact on-chain receipt
// summary. `explorerUrl` is optional and left unset until the exact Sui
// testnet explorer URL pattern is confirmed — see DealReceipt in
// ./types.ts. Do not guess the explorer path format.

import { motion } from "motion/react";
import { GlassCard } from "./components/GlassCard";
import type { DealReceipt } from "./types";

export function Receipt({
  receipt,
  onStartOver,
}: {
  receipt: DealReceipt;
  onStartOver: () => void;
}) {
  return (
    <div className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-6 px-6 py-12">
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: "easeOut" }}
      >
        <h2 className="text-2xl font-semibold text-warrant-text">Done.</h2>
        <p className="mt-1 text-sm text-warrant-text-dim">
          Paid automatically once verified — no manual approval step.
        </p>
      </motion.div>

      <GlassCard>
        <dl className="grid grid-cols-2 gap-y-3 text-sm">
          <dt className="text-warrant-text-dim">Amount</dt>
          <dd className="text-right font-mono text-warrant-text">{receipt.amount} SUI</dd>

          <dt className="text-warrant-text-dim">Paid to</dt>
          <dd className="text-right font-mono text-warrant-text">{receipt.counterpartyName}</dd>

          <dt className="text-warrant-text-dim">Verification</dt>
          <dd className="text-right text-warrant-text">
            {receipt.verification.mocked ? (
              <span className="text-warrant-danger">Simulated for demo</span>
            ) : (
              <span className="text-warrant-success">Nautilus attestation</span>
            )}
          </dd>

          {receipt.explorerUrl && (
            <>
              <dt className="text-warrant-text-dim">On-chain record</dt>
              <dd className="text-right">
                <a
                  href={receipt.explorerUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-warrant-accent underline underline-offset-2"
                >
                  View on Sui Explorer
                </a>
              </dd>
            </>
          )}
        </dl>
      </GlassCard>

      <button
        type="button"
        onClick={onStartOver}
        className="self-start rounded-lg border border-warrant-border px-4 py-2 text-sm font-medium text-warrant-text-dim transition-colors hover:border-warrant-accent-dim hover:text-warrant-text"
      >
        Start another task
      </button>
    </div>
  );
}
