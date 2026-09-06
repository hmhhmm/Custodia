// Owner: Person 4 (frontend + orchestration).
//
// Live status feed — the demo centerpiece. Renders each step as a plain
// ledger line (✓ done / ○ pending), deliberately NOT as decorative
// glass/shadow cards — the point is that this reads like a real record
// being written, not a widget. escrow-locked and verification used to
// break this rhythm with a separate wax-seal stamp component; that's been
// dropped in favor of the same plain line every other step uses, so the
// whole feed reads as one consistent record rather than one moment
// visually competing with the rest of the app's monochrome language. A
// "Simulated" badge stays on verification when the attestation is mocked
// — that's a real honesty signal (never present simulated verification as
// indistinguishable from real), not decoration.
//
// StepList is the pure renderer — it takes `steps` as a prop and animates
// state transitions, but does NOT itself decide when a step completes.
// See orchestrator.ts for the real driver (discovery, Gemini, the
// on-chain PTBs, Walrus/Seal, Nautilus-mock). It's used in three places:
// StatusFeed below (the standalone ProgressView screen), ChatPanel's
// collapsible DealProgress indicator, and nowhere else — Dashboard's
// InProgressCard only needs a one-line summary, not the full list.

import { AnimatePresence, motion } from "motion/react";
import type { CandidateInfo, StatusStep, VerificationInfo } from "./types";

function isCandidateInfo(detail: StatusStep["detail"]): detail is CandidateInfo {
  return typeof detail === "object" && detail !== null && "suinsName" in detail;
}

function isVerificationInfo(detail: StatusStep["detail"]): detail is VerificationInfo {
  return typeof detail === "object" && detail !== null && "attestationId" in detail;
}

/** The active state was a static half-filled character with a slow
 * opacity fade — easy to miss, and didn't read as "something is really
 * happening right now" the way a genuine spinning ring does. A real
 * CSS-animated spinner (rotating border, not text/emoji) is unambiguous
 * at a glance and matches the "in progress" language most people already
 * read as a loading indicator elsewhere on the web. */
function StepGlyph({ state }: { state: StatusStep["state"] }) {
  if (state === "done") return <span className="text-vellum">✓</span>;
  if (state === "failed") return <span className="text-red-500">✕</span>;
  if (state === "active") {
    return (
      <span
        className="inline-block h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-manifest border-t-vellum"
        role="status"
        aria-label="In progress"
      />
    );
  }
  return <span className="text-manifest">○</span>;
}

function DetailLine({ detail }: { detail: StatusStep["detail"] }) {
  if (!detail || typeof detail !== "string") return null;
  // overflow-wrap: anywhere (not just break-words): Move abort messages
  // contain long unbroken `::`-joined type paths that otherwise force
  // this line (and its flex ancestors) wider than the viewport instead of
  // wrapping — break-words alone doesn't affect intrinsic-width sizing
  // the way `anywhere` does.
  return <p className="mt-1 min-w-0 pl-6 text-sm text-manifest [overflow-wrap:anywhere]">{detail}</p>;
}

function CandidateLine({ detail }: { detail: CandidateInfo }) {
  return (
    <p className="mt-1 pl-6 font-data text-sm text-manifest">
      {detail.suinsName} · Reputation {detail.reputationScore}
    </p>
  );
}

export function StepList({ steps }: { steps: StatusStep[] }) {
  return (
    <AnimatePresence initial={false}>
      <div className="flex min-w-0 flex-col gap-3">
        {steps.map((step) => (
          <motion.div
            key={step.id}
            layout
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className="min-w-0"
          >
            <div className="min-w-0">
              <div className="flex items-center gap-3 text-sm">
                <StepGlyph state={step.state} />
                <span className={step.state === "pending" ? "text-manifest" : "text-vellum"}>{step.label}</span>
                {isVerificationInfo(step.detail) && step.detail.mocked && (
                  <span className="rounded-full border border-border px-2 py-0.5 text-xs text-manifest">
                    Simulated
                  </span>
                )}
              </div>
              {isCandidateInfo(step.detail) && <CandidateLine detail={step.detail} />}
              <DetailLine detail={step.detail} />
              {isVerificationInfo(step.detail) && (
                <p className="mt-1 break-words pl-6 font-data text-xs text-manifest">{step.detail.attestationId}</p>
              )}
            </div>
          </motion.div>
        ))}
      </div>
    </AnimatePresence>
  );
}

/** Full-screen wrapper around StepList — used by ProgressView.tsx (the
 * Deals tab's "view this deal's live progress" destination). */
export function StatusFeed({
  steps,
  counterpartyName,
  onBack,
}: {
  steps: StatusStep[];
  counterpartyName?: string;
  onBack: () => void;
}) {
  const failedStep = steps.find((s) => s.state === "failed");

  return (
    <div>
      <h1 className="mb-1 text-2xl font-semibold tracking-tight text-vellum">
        {failedStep ? "Something went wrong" : "Working on it"}
      </h1>
      {counterpartyName && <p className="mb-6 text-sm text-manifest">Deal with {counterpartyName}</p>}

      <StepList steps={steps} />

      {failedStep && (
        <button
          type="button"
          onClick={onBack}
          className="mt-8 rounded-md border border-border px-4 py-2 text-sm font-medium text-vellum transition-colors hover:border-white/30"
        >
          Back to deals
        </button>
      )}
    </div>
  );
}
