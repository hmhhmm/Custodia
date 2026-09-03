// Standalone progress screen — reached only from the Deals tab's
// in-progress card. Shows one deal's live StatusFeed full-page, separate
// from Chat entirely (Chat shows the same deal turn inline while you're
// actively chatting, via ChatPanel's DealProgress; this is a lightweight
// viewer for tracking a long-running deal without re-entering Chat).

import type { ConversationTurn } from "./types";
import { StatusFeed } from "./StatusFeed";

export function ProgressView({
  turn,
  onBack,
}: {
  turn: Extract<ConversationTurn, { kind: "deal" }>;
  onBack: () => void;
}) {
  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-10">
      <button
        type="button"
        onClick={onBack}
        className="mb-6 text-sm text-manifest transition-colors hover:text-vellum focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        ← Back to deals
      </button>

      <p className="mb-2 text-xs uppercase tracking-wider text-manifest">Task</p>
      <p className="mb-8 text-lg font-medium text-vellum">{turn.task}</p>

      <StatusFeed steps={turn.steps} onBack={onBack} />
    </div>
  );
}
