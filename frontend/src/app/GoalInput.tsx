// Owner: Person 4 (frontend + orchestration).
//
// Goal input screen: a single large text input and one submit action.
// Per the design direction, this stays deliberately minimal — "one input
// box and one outcome" is the pitch, so no extra fields/options belong
// here. Feeds into src/agent's discovery/matching logic (still stubs —
// see /frontend/src/agent/).

import { useState } from "react";
import { motion } from "motion/react";

export function GoalInput({ onSubmit }: { onSubmit: (goal: string) => void }) {
  const [goal, setGoal] = useState("");

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = goal.trim();
    if (trimmed.length === 0) return;
    onSubmit(trimmed);
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-6">
      <motion.form
        onSubmit={handleSubmit}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: "easeOut" }}
        className="flex w-full max-w-xl flex-col gap-4"
      >
        <label htmlFor="goal-input" className="text-lg font-medium text-warrant-text">
          What do you need done?
        </label>
        <textarea
          id="goal-input"
          value={goal}
          onChange={(event) => setGoal(event.target.value)}
          placeholder="e.g. Have a contract reviewed and get a same-day courier quote"
          rows={4}
          autoFocus
          className="w-full resize-none rounded-lg border border-warrant-border bg-warrant-surface px-4 py-3 text-base text-warrant-text placeholder:text-warrant-text-dim focus:border-warrant-accent-dim focus:outline-none"
        />
        <button
          type="submit"
          disabled={goal.trim().length === 0}
          className="self-start rounded-lg bg-warrant-accent px-5 py-2.5 text-sm font-medium text-warrant-bg transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Find an agent
        </button>
      </motion.form>
    </div>
  );
}
