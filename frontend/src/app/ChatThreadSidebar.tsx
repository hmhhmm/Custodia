// Chat thread sidebar — real conversation-history management, not a
// single endless list. One thread per deal (auto-titled from its task,
// carrying that deal's own live status) plus one ongoing "General"
// thread for plain conversation. Clicking a thread switches ChatPanel's
// active thread in place; this is also what "Return to chat" from the
// Deals tab actually opens now — a SPECIFIC deal's thread, picking up
// exactly where it left off, not a blank new conversation.

import type { ConversationTurn } from "./types";
import { GENERAL_THREAD_ID } from "./types";

interface ThreadSummary {
  threadId: string;
  title: string;
  isDeal: boolean;
  /** For a deal thread: its live-ish status label, derived from the
   * deal turn's own steps/receipt/pending — same signals ChatPanel's own
   * DealProgress already shows inline, just surfaced here too so the
   * sidebar row itself communicates state at a glance. */
  statusLabel?: string;
  lastActivityIndex: number;
}

function dealStatusLabel(turn: Extract<ConversationTurn, { kind: "deal" }>): string {
  if (turn.receipt) return "Released";
  if (turn.pending) return "In progress";
  const failed = turn.steps.some((s) => s.state === "failed");
  if (failed) return "Failed";
  return "Setting up";
}

/** Derives the thread list from the flat turns array — General always
 * exists (even with zero turns yet, so it's always selectable), plus one
 * entry per distinct deal thread found, newest first. */
export function deriveThreads(turns: ConversationTurn[]): ThreadSummary[] {
  const dealThreads = new Map<string, ThreadSummary>();
  let generalLastActivity = -1;

  turns.forEach((turn, i) => {
    if (turn.threadId === GENERAL_THREAD_ID) {
      generalLastActivity = i;
      return;
    }
    if (turn.kind === "deal") {
      dealThreads.set(turn.threadId, {
        threadId: turn.threadId,
        title: turn.task,
        isDeal: true,
        statusLabel: dealStatusLabel(turn),
        lastActivityIndex: i,
      });
    } else if (!dealThreads.has(turn.threadId)) {
      // The triggering user message can arrive before the deal turn
      // itself in the array on the very first render of a new thread —
      // give it a placeholder title until the deal turn lands.
      dealThreads.set(turn.threadId, {
        threadId: turn.threadId,
        title: turn.kind === "text" ? turn.text : "New deal",
        isDeal: true,
        lastActivityIndex: i,
      });
    } else {
      const existing = dealThreads.get(turn.threadId)!;
      dealThreads.set(turn.threadId, { ...existing, lastActivityIndex: i });
    }
  });

  const general: ThreadSummary = {
    threadId: GENERAL_THREAD_ID,
    title: "General",
    isDeal: false,
    lastActivityIndex: generalLastActivity,
  };

  return [general, ...Array.from(dealThreads.values()).sort((a, b) => b.lastActivityIndex - a.lastActivityIndex)];
}

function ThreadRow({
  thread,
  active,
  onSelect,
}: {
  thread: ThreadSummary;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`flex w-full flex-col items-start gap-0.5 rounded-lg px-3 py-2.5 text-left transition-colors ${
        active ? "bg-surface-hover text-vellum" : "text-manifest hover:bg-surface-hover hover:text-vellum"
      }`}
    >
      <span className="line-clamp-1 w-full text-sm">{thread.title}</span>
      {thread.statusLabel && <span className="text-xs text-manifest">{thread.statusLabel}</span>}
    </button>
  );
}

export function ChatThreadSidebar({
  turns,
  activeThreadId,
  onSelectThread,
  onNewChat,
}: {
  turns: ConversationTurn[];
  activeThreadId: string;
  onSelectThread: (threadId: string) => void;
  onNewChat: () => void;
}) {
  const threads = deriveThreads(turns);

  return (
    <div className="flex h-full w-64 shrink-0 flex-col border-r border-border">
      <div className="p-3">
        <button
          type="button"
          onClick={onNewChat}
          className="flex w-full items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-vellum transition-colors hover:border-white/30"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 5v14M5 12h14" />
          </svg>
          New chat
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        <div className="flex flex-col gap-0.5">
          {threads.map((thread) => (
            <ThreadRow
              key={thread.threadId}
              thread={thread}
              active={thread.threadId === activeThreadId}
              onSelect={() => onSelectThread(thread.threadId)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
