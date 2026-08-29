// Owner: Person 4 (frontend + orchestration).
//
// Shared frosted-glass card primitive used across the live status feed
// and receipt screen. Deliberately restrained (moderate blur, no heavy
// decorative animation) per the design direction: glassmorphism should
// read clearly on a projector/screen-share during judging, not just look
// nice on a laptop.

import type { ReactNode } from "react";
import { motion } from "motion/react";

export function GlassCard({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: "easeOut" }}
      className={`glass-card rounded-xl p-5 ${className}`}
    >
      {children}
    </motion.div>
  );
}
