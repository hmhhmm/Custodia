// Owner: Person 4 (frontend + orchestration).
//
// THE SIGNATURE ELEMENT. Per the design brainstorm: a single stamp/seal
// device that does two jobs with the same shape — pressed in Sealing Wax
// when escrow locks, re-pressed in Verdigris (or, honestly, a
// "SIMULATED" face) when verification/release resolves. This is the one
// place in the whole UI where motion and the signature accent color are
// spent — everything else in the app stays deliberately quiet so this
// moment reads as THE moment.
//
// Respects prefers-reduced-motion (handled globally in index.css by
// collapsing animation/transition durations to ~0) — the reduced-motion
// fallback still clearly communicates the state change via the instant
// color/label swap, it just skips the press/settle motion.

import { motion } from "motion/react";

export type SealKind = "locked" | "verified" | "simulated";

const SEAL_CONTENT: Record<SealKind, { label: string; color: string }> = {
  locked: { label: "SEALED", color: "var(--color-wax)" },
  verified: { label: "VERIFIED", color: "var(--color-verdigris)" },
  simulated: { label: "SIMULATED", color: "var(--color-verdigris)" },
};

export function Seal({ kind, size = 96 }: { kind: SealKind; size?: number }) {
  const { label, color } = SEAL_CONTENT[kind];

  // Longer labels (SIMULATED, VERIFIED) need a smaller font and tighter
  // tracking than short ones (SEALED) to fit the circle at small sizes —
  // a fixed fontSize/tracking pair overflowed "SIMULATED" at 64px.
  const fontSize = Math.min(size * 0.13, (size * 0.72) / label.length);
  const letterSpacing = size < 80 ? "0.02em" : "0.05em";

  return (
    <motion.div
      key={kind}
      initial={{ scale: 0.6, opacity: 0, rotate: -8 }}
      animate={{ scale: 1, opacity: 1, rotate: 0 }}
      transition={{
        duration: 0.6,
        ease: [0.34, 1.56, 0.64, 1], // deliberate overshoot then settle — a press, not a fade
      }}
      className="relative inline-flex shrink-0 items-center justify-center rounded-full border-4 font-display font-semibold uppercase"
      style={{
        width: size,
        height: size,
        borderColor: color,
        color,
      }}
    >
      {/* radial bloom that fades — simulates ink/wax settling, not a glow loop */}
      <motion.span
        initial={{ opacity: 0.5, scale: 0.4 }}
        animate={{ opacity: 0, scale: 1.6 }}
        transition={{ duration: 0.7, ease: "easeOut" }}
        className="absolute inset-0 rounded-full"
        style={{ backgroundColor: color }}
        aria-hidden="true"
      />
      <span
        className="relative px-2 text-center leading-tight"
        style={{ fontSize, letterSpacing }}
      >
        {label}
      </span>
    </motion.div>
  );
}
