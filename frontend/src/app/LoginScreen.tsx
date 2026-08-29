// Owner: Person 4 (frontend + orchestration).
//
// Login screen shell. Person 2 owns the actual zkLogin/Enoki wiring
// (frontend/src/sui/zkLogin.ts, WalletConnect.tsx) — this component owns
// only the surrounding UI: logo/name, one primary action, no extra
// friction. `onContinue` is a placeholder callback; wire it to Person 2's
// real zkLogin flow once that's implemented, rather than building auth
// logic here.

import { motion } from "motion/react";

export function LoginScreen({ onContinue }: { onContinue: () => void }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-6">
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: "easeOut" }}
        className="flex w-full max-w-sm flex-col items-center gap-8 text-center"
      >
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-warrant-text">
            Warrant
          </h1>
          <p className="mt-2 text-sm text-warrant-text-dim">
            On-chain trust and settlement for AI agents.
          </p>
        </div>

        <button
          type="button"
          onClick={onContinue}
          className="flex w-full items-center justify-center gap-3 rounded-lg border border-warrant-border bg-warrant-surface px-4 py-3 text-sm font-medium text-warrant-text transition-colors hover:border-warrant-accent-dim hover:bg-warrant-surface/80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-warrant-accent"
        >
          {/* VERIFY: exact zkLogin + Google OAuth flow, and whether a real
              Google "G" mark asset is available/appropriate to use, before
              treating this as final — this button currently only calls
              the onContinue placeholder. */}
          Continue with Google
        </button>

        <p className="text-xs text-warrant-text-dim">
          Signs you in via zkLogin — no seed phrase, no extension required.
        </p>
      </motion.div>
    </div>
  );
}
