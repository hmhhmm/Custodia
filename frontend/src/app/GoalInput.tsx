// Owner: Person 4 (frontend + orchestration).
//
// Goal input — reached via the dashboard's "+ New deal" action, not a
// standalone screen. Stays deliberately minimal: one field, one action.
// Feeds into src/agent's discovery/matching logic (still stubs — see
// /frontend/src/agent/).

import { useState } from "react";

export function GoalInput({
  onSubmit,
  onBack,
}: {
  onSubmit: (goal: string) => void;
  onBack: () => void;
}) {
  const [goal, setGoal] = useState("");

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = goal.trim();
    if (trimmed.length === 0) return;
    onSubmit(trimmed);
  }

  return (
    <div className="mx-auto max-w-xl">
      <button
        type="button"
        onClick={onBack}
        className="mb-6 text-sm text-manifest transition-colors hover:text-vellum focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        ← Back to deals
      </button>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <label htmlFor="goal-input" className="text-xl font-semibold tracking-tight text-vellum">
          What do you need done?
        </label>
        <textarea
          id="goal-input"
          value={goal}
          onChange={(event) => setGoal(event.target.value)}
          placeholder="e.g. Review a rental agreement and get feedback within 24 hours"
          rows={4}
          autoFocus
          className="w-full resize-none rounded-md border border-border bg-surface px-4 py-3 text-base text-vellum placeholder:text-manifest focus:border-accent focus:outline-none"
        />
        <button
          type="submit"
          disabled={goal.trim().length === 0}
          className="self-start rounded-md bg-white px-5 py-2.5 text-sm font-medium text-black transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          Find an agent
        </button>
      </form>
    </div>
  );
}
