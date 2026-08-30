// Owner: Person 4 (frontend + orchestration).
//
// Live status feed — the demo centerpiece. Renders each step as a plain
// ledger line (✓ done / ○ pending), deliberately NOT as decorative
// glass/shadow cards — the point is that this reads like a real record
// being written, not a widget. The escrow-lock and verification steps
// are the two exceptions: they break the list rhythm with the Seal
// signature component, because those are the one moment the whole brief
// is about.
//
// This component is a pure renderer — it takes `steps` as a prop and
// animates state transitions, but does NOT itself decide when a step
// completes. See demoStatusSequence.ts for the current placeholder
// driver and what it must be replaced with once Person 1/2/3's real
// integration points exist.

import { AnimatePresence, motion } from "motion/react";
import { Seal } from "./components/Seal";
import type {
  CandidateInfo,
  MandateSnapshot,
  StatusStep,
  VerificationInfo,
} from "./types";

function isCandidateInfo(detail: StatusStep["detail"]): detail is CandidateInfo {
  return typeof detail === "object" && detail !== null && "suinsName" in detail;
}

function isMandateSnapshot(detail: StatusStep["detail"]): detail is MandateSnapshot {
  return typeof detail === "object" && detail !== null && "maxSpend" in detail;
}

function isVerificationInfo(detail: StatusStep["detail"]): detail is VerificationInfo {
  return typeof detail === "object" && detail !== null && "attestationId" in detail;
}

function StepGlyph({ state }: { state: StatusStep["state"] }) {
  if (state === "done") return <span className="text-verdigris">✓</span>;
  if (state === "failed") return <span className="text-wax">✕</span>;
  if (state === "active") return <span className="animate-pulse text-brass">◐</span>;
  return <span className="text-manifest">○</span>;
}

function DetailLine({ detail }: { detail: StatusStep["detail"] }) {
  if (!detail || typeof detail !== "string") return null;
  return <p className="mt-1 pl-6 text-sm text-manifest">{detail}</p>;
}

function CandidateLine({ detail }: { detail: CandidateInfo }) {
  return (
    <p className="mt-1 pl-6 font-data text-sm text-manifest">
      {detail.suinsName} · Reputation {detail.reputationScore}
    </p>
  );
}

function MandateLine({ detail }: { detail: MandateSnapshot }) {
  return (
    <p className="mt-1 pl-6 font-data text-sm text-manifest">
      {detail.spentSoFar} / {detail.maxSpend} SUI · {detail.allowedCategories.join(", ")} · expires{" "}
      {detail.expiresAt}
    </p>
  );
}

/** Steps that get the full Seal treatment instead of a plain ledger line. */
const SEALED_STEPS = new Set(["escrow-locked", "verification"]);

function sealKindFor(stepId: string, detail: StatusStep["detail"]): "locked" | "verified" | "simulated" {
  if (stepId === "escrow-locked") return "locked";
  if (isVerificationInfo(detail) && detail.mocked) return "simulated";
  return "verified";
}

export function StatusFeed({ steps, counterpartyName }: { steps: StatusStep[]; counterpartyName?: string }) {
  return (
    <div>
      <h1 className="mb-1 font-display text-2xl font-semibold text-vellum">Working on it</h1>
      {counterpartyName && (
        <p className="mb-6 text-sm text-manifest">Deal with {counterpartyName}</p>
      )}

      <AnimatePresence initial={false}>
        <div className="flex flex-col gap-3">
          {steps.map((step) => {
            const showSeal = SEALED_STEPS.has(step.id) && step.state === "done";

            return (
              <motion.div
                key={step.id}
                layout
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2, ease: "easeOut" }}
              >
                {showSeal ? (
                  <div className="flex items-center gap-4 rounded border border-brass/30 bg-brass/5 px-4 py-4">
                    <Seal kind={sealKindFor(step.id, step.detail)} size={64} />
                    <div>
                      <p className="font-medium text-vellum">{step.label}</p>
                      <DetailLine detail={step.detail} />
                      {isVerificationInfo(step.detail) && (
                        <p className="mt-1 font-data text-sm text-manifest">
                          {step.detail.attestationId}
                        </p>
                      )}
                    </div>
                  </div>
                ) : (
                  <div>
                    <div className="flex items-center gap-3 text-sm">
                      <StepGlyph state={step.state} />
                      <span className={step.state === "pending" ? "text-manifest" : "text-vellum"}>
                        {step.label}
                      </span>
                    </div>
                    {isCandidateInfo(step.detail) && <CandidateLine detail={step.detail} />}
                    {isMandateSnapshot(step.detail) && <MandateLine detail={step.detail} />}
                    <DetailLine detail={step.detail} />
                  </div>
                )}
              </motion.div>
            );
          })}
        </div>
      </AnimatePresence>
    </div>
  );
}
