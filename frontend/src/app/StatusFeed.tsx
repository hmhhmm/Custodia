// Owner: Person 4 (frontend + orchestration).
//
// Live status feed — the demo centerpiece. Renders each step of the
// searching -> negotiating -> escrow -> verified -> paid flow as a glass
// card that appears/updates via a `motion` animation as the corresponding
// event actually happens.
//
// IMPORTANT: this component is a pure renderer — it takes `steps` as a
// prop and animates state transitions, but does NOT itself decide when a
// step completes. That decision belongs to real on-chain/off-chain
// events once Person 1/2/3's work is wired up (PTB #1 confirmation,
// Person 3's verification result, PTB #2 confirmation, etc.) — do not
// drive this with an arbitrary setTimeout sequence once those real
// integration points exist. Until they are, the caller (see App.tsx) is
// responsible for clearly marking which steps are driven by placeholder
// data.

import { AnimatePresence, motion } from "motion/react";
import { GlassCard } from "./components/GlassCard";
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

function StateIndicator({ state }: { state: StatusStep["state"] }) {
  const styles: Record<StatusStep["state"], string> = {
    pending: "bg-warrant-border text-warrant-text-dim",
    active: "bg-warrant-accent-dim text-warrant-text animate-pulse",
    done: "bg-warrant-success/20 text-warrant-success",
    failed: "bg-warrant-danger/20 text-warrant-danger",
  };
  const labels: Record<StatusStep["state"], string> = {
    pending: "Pending",
    active: "In progress",
    done: "Done",
    failed: "Failed",
  };
  return (
    <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${styles[state]}`}>
      {labels[state]}
    </span>
  );
}

function StepDetail({ detail }: { detail: StatusStep["detail"] }) {
  if (!detail) return null;

  if (typeof detail === "string") {
    return <p className="mt-2 text-sm text-warrant-text-dim">{detail}</p>;
  }

  if (isCandidateInfo(detail)) {
    return (
      <div className="mt-2 flex items-center gap-3 text-sm text-warrant-text-dim">
        <span className="font-mono text-warrant-text">{detail.suinsName}</span>
        <span>·</span>
        <span>Reputation {detail.reputationScore}</span>
      </div>
    );
  }

  if (isMandateSnapshot(detail)) {
    return (
      <div className="mt-2 rounded-lg border border-warrant-border bg-warrant-bg/40 px-3 py-2 text-sm text-warrant-text-dim">
        <div>
          Spend limit: {detail.spentSoFar} / {detail.maxSpend}
        </div>
        <div>Categories: {detail.allowedCategories.join(", ")}</div>
        <div>Expires: {detail.expiresAt}</div>
      </div>
    );
  }

  if (isVerificationInfo(detail)) {
    return (
      <div className="mt-2 flex items-center gap-2 text-sm">
        <span className="font-mono text-warrant-text-dim">{detail.attestationId}</span>
        {detail.mocked ? (
          <span className="rounded-full bg-warrant-danger/20 px-2 py-0.5 text-xs font-medium text-warrant-danger">
            Simulated for demo
          </span>
        ) : (
          <span className="rounded-full bg-warrant-success/20 px-2 py-0.5 text-xs font-medium text-warrant-success">
            Verified
          </span>
        )}
      </div>
    );
  }

  return null;
}

export function StatusFeed({ steps }: { steps: StatusStep[] }) {
  return (
    <div className="mx-auto flex min-h-screen max-w-2xl flex-col gap-3 px-6 py-12">
      <h2 className="mb-2 text-lg font-medium text-warrant-text">Working on it</h2>
      <AnimatePresence initial={false}>
        {steps.map((step) => (
          <motion.div
            key={step.id}
            layout
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, ease: "easeOut" }}
          >
            <GlassCard>
              <div className="flex items-center justify-between gap-3">
                <span className="font-medium text-warrant-text">{step.label}</span>
                <StateIndicator state={step.state} />
              </div>
              <StepDetail detail={step.detail} />
            </GlassCard>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
