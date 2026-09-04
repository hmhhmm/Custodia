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

/** For a multi-agent chain, "Part i of N — {leg status}" — computed from
 * whichever leg turn is LATEST for this chainId (every leg shares the
 * same threadId, so they all land in the same sidebar row; this is what
 * makes that row's status reflect the CURRENT leg, not a stale early
 * one). Plain dealStatusLabel for a non-chain deal turn. */
function chainAwareStatusLabel(latestLegTurn: Extract<ConversationTurn, { kind: "deal" }>): string {
  const base = dealStatusLabel(latestLegTurn);
  if (!latestLegTurn.chain) return base;
  const { legIndex, legTotal } = latestLegTurn.chain;
  return `Part ${legIndex + 1} of ${legTotal} — ${base}`;
}

/** Derives the thread list from the flat turns array. Unlike the old
 * version, General is only included once it actually HAS a turn in it —
 * a brand-new wallet with zero messages ever sent has zero threads, not
 * one empty "General" row sitting there before anything happened (that
 * was the "front page still shows a sidebar/New chat" complaint: the
 * empty landing state and a real, populated conversation looked
 * identical from the sidebar's point of view). */
export function deriveThreads(turns: ConversationTurn[]): ThreadSummary[] {
  const dealThreads = new Map<string, ThreadSummary>();
  let generalLastActivity = -1;

  turns.forEach((turn, i) => {
    if (turn.threadId === GENERAL_THREAD_ID) {
      generalLastActivity = i;
      return;
    }
    if (turn.kind === "deal") {
      const existing = dealThreads.get(turn.threadId);
      // For a multi-agent chain, the thread's title should stay the
      // ORIGINAL multi-phase request (leg 0's title, set once via
      // ChatPanel.tsx's onThreadCreated call), not flip to whichever
      // leg's narrower taskDescription was seen most recently as the
      // chain advances — a chain thread's `existing.title` is preserved
      // once set. A non-chain deal has only ever had one task, so this
      // is a no-op for it either way.
      const title = turn.chain && existing?.title ? existing.title : turn.task;
      dealThreads.set(turn.threadId, {
        threadId: turn.threadId,
        title,
        isDeal: true,
        statusLabel: chainAwareStatusLabel(turn),
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

  const dealList = Array.from(dealThreads.values()).sort((a, b) => b.lastActivityIndex - a.lastActivityIndex);

  if (generalLastActivity === -1) return dealList;

  const general: ThreadSummary = {
    threadId: GENERAL_THREAD_ID,
    title: "General",
    isDeal: false,
    lastActivityIndex: generalLastActivity,
  };
  return [general, ...dealList];
}

function ThreadRow({
  thread,
  active,
  onSelect,
  onDelete,
}: {
  thread: ThreadSummary;
  active: boolean;
  onSelect: () => void;
  /** Undefined for General — it's the one always-present thread, deleting
   * it doesn't make sense the way deleting a deal/chain thread does (and
   * "New chat" already clears its content). Deleting a deal/chain thread
   * only removes it from THIS device's local view — the underlying
   * on-chain Deal(s), if any were escrowed, are permanent Sui objects and
   * are completely unaffected; they still resolve normally through the
   * real accept/deliver/release or timeout-refund path regardless of
   * whether this local record of the conversation exists. */
  onDelete?: () => void;
}) {
  return (
    <div
      className={`group flex w-full items-center gap-1 rounded-lg text-left transition-colors ${
        active ? "bg-surface-hover text-vellum" : "text-manifest hover:bg-surface-hover hover:text-vellum"
      }`}
    >
      <button type="button" onClick={onSelect} className="flex min-w-0 flex-1 flex-col items-start gap-0.5 px-3 py-2.5 text-left">
        <span className="line-clamp-1 w-full text-sm">{thread.title}</span>
        {thread.statusLabel && <span className="text-xs text-manifest">{thread.statusLabel}</span>}
      </button>
      {onDelete && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          title="Delete this chat"
          aria-label="Delete this chat"
          className="mr-1.5 shrink-0 rounded-md p-1.5 text-manifest opacity-0 transition-opacity hover:text-wax group-hover:opacity-100"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
          </svg>
        </button>
      )}
    </div>
  );
}

export function ChatThreadSidebar({
  turns,
  activeThreadId,
  onSelectThread,
  onNewChat,
  onCollapse,
  onDeleteThread,
}: {
  turns: ConversationTurn[];
  activeThreadId: string;
  onSelectThread: (threadId: string) => void;
  onNewChat: () => void;
  /** Collapses the sidebar (still reopenable — see ChatPanel's toggle in
   * the empty/collapsed states) — a real hide control, not just "it only
   * shows once a thread exists." */
  onCollapse: () => void;
  /** Removes every turn for that threadId from local history — see
   * ThreadRow's own comment on why this never touches on-chain state. */
  onDeleteThread: (threadId: string) => void;
}) {
  const threads = deriveThreads(turns);

  return (
    <div className="flex h-full w-64 shrink-0 flex-col border-r border-border">
      <div className="flex items-center gap-2 p-3">
        <button
          type="button"
          onClick={onNewChat}
          className="flex flex-1 items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-vellum transition-colors hover:border-white/30"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 5v14M5 12h14" />
          </svg>
          New chat
        </button>
        <button
          type="button"
          onClick={onCollapse}
          title="Hide sidebar"
          aria-label="Hide sidebar"
          className="shrink-0 rounded-lg border border-border p-2 text-manifest transition-colors hover:border-white/30 hover:text-vellum"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="4" width="18" height="16" rx="2" />
            <path d="M9 4v16" />
          </svg>
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
              onDelete={thread.threadId === GENERAL_THREAD_ID ? undefined : () => onDeleteThread(thread.threadId)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
