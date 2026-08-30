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
    <div>
      <button
        type="button"
        onClick={onBack}
        className="mb-6 text-sm text-manifest transition-colors hover:text-vellum focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass"
      >
        ← Back to deals
      </button>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <label htmlFor="goal-input" className="font-display text-xl font-semibold text-vellum">
          What do you need done?
        </label>
        <textarea
          id="goal-input"
          value={goal}
          onChange={(event) => setGoal(event.target.value)}
          placeholder="e.g. Review a rental agreement and get feedback within 24 hours"
          rows={4}
          autoFocus
          className="w-full resize-none rounded border border-brass/40 bg-transparent px-4 py-3 text-base text-vellum placeholder:text-manifest/70 focus:border-brass focus:outline-none"
        />
        <button
          type="submit"
          disabled={goal.trim().length === 0}
          className="self-start rounded border border-brass/50 px-5 py-2.5 text-sm font-medium text-vellum transition-colors hover:border-brass hover:bg-brass/10 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass"
        >
          Find an agent
        </button>
      </form>
    </div>
  );
}
