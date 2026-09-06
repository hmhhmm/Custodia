// The Chat tab — Claude/ChatGPT-style: an empty state with the input box
// centered on the page (like Claude's default screen), which animates
// down to a pinned footer the moment the first message is sent. Deal
// progress renders as a collapsible "working" indicator inline in the
// conversation (ChatGPT's tool-call pattern), not a static bordered box —
// expanded while running, auto-collapses to a one-line summary once it
// settles, with a manual toggle to reopen it.
//
// Controlled by App.tsx (turns/onTurnsChange), not local state — the
// Deals tab reads the same in-progress deal turns to show live status and
// links to a dedicated progress page (ProgressView.tsx), not back into
// Chat.

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence, LayoutGroup } from "motion/react";
import { sendChatTurn, type ChatMessage, type ChatAttachment } from "../agent/chat";
import { createDealAndEscrow, createDealChain } from "./orchestrator";
import { releaseDeal, reconstructPendingRelease } from "./release";
import { tryAdvanceChain } from "./chainAdvance";
import { findDealById, findProofForDeal, findCheckpointsForDeal, type DealStatusName, type DealCheckpointInfo } from "../sui/deal-queries";
import type { OnboardingResult } from "./Onboarding";
import type { AttachmentInfo, ChainInfo, ConversationTurn, DealReceipt, PendingRelease, StatusStep } from "./types";
import { GENERAL_THREAD_ID } from "./types";
import { StepList } from "./StatusFeed";
import { formatDateTime } from "./ProgressView";
import { Markdown } from "./components/Markdown";
import { ChatThreadSidebar, deriveThreads } from "./ChatThreadSidebar";

// SpeechRecognition (and its instance methods/events) isn't part of
// TypeScript's standard DOM lib yet. SpeechRecognitionEvent already is
// (used untyped-import-free below); only the constructor + the
// vendor-prefixed Window property need declaring here — verified against
// MDN's SpeechRecognition docs this session.
declare global {
  interface Window {
    SpeechRecognition?: {
      new (): SpeechRecognitionInstance;
    };
    webkitSpeechRecognition?: {
      new (): SpeechRecognitionInstance;
    };
  }
  interface SpeechRecognitionInstance {
    continuous: boolean;
    interimResults: boolean;
    lang: string;
    onresult: ((event: SpeechRecognitionEvent) => void) | null;
    onerror: ((event: Event) => void) | null;
    onend: (() => void) | null;
    start(): void;
    stop(): void;
  }
}

// Gemini's inline_data accepts images, PDF, and plain text reliably at
// small sizes — kept intentionally narrow rather than accepting "any
// file," since anything else (video, office docs) isn't something the
// model can actually read this way. 15MB is comfortably under the inline
// (non-Files-API) request size ceiling.
const ACCEPTED_FILE_TYPES = "image/*,application/pdf,text/plain,text/markdown,text/csv";
const MAX_FILE_BYTES = 15 * 1024 * 1024;

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // "data:<mime>;base64,<data>" — strip the prefix, Gemini wants raw base64.
      resolve(result.slice(result.indexOf(",") + 1));
    };
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

/** Voice input via the browser's native SpeechRecognition — verified
 * against MDN this session: constructor needs the webkitSpeechRecognition
 * fallback (Chrome/Safari), unsupported entirely in Firefox, and requires
 * network access (Chrome sends audio to a web service, doesn't work
 * offline). `supported` lets the caller hide the mic entirely rather than
 * show a button that silently does nothing. */
function useSpeechToText(onResult: (transcript: string) => void) {
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);

  const SpeechRecognitionCtor =
    typeof window !== "undefined" ? window.SpeechRecognition ?? window.webkitSpeechRecognition : undefined;
  const supported = Boolean(SpeechRecognitionCtor);

  function start() {
    if (!SpeechRecognitionCtor || listening) return;
    const recognition = new SpeechRecognitionCtor();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = navigator.language || "en-US";
    recognition.onresult = (event: SpeechRecognitionEvent) => {
      const transcript = event.results[0]?.[0]?.transcript;
      if (transcript) onResult(transcript);
    };
    recognition.onerror = () => setListening(false);
    recognition.onend = () => setListening(false);
    recognitionRef.current = recognition;
    recognition.start();
    setListening(true);
  }

  function stop() {
    recognitionRef.current?.stop();
    setListening(false);
  }

  useEffect(() => () => recognitionRef.current?.stop(), []);

  return { supported, listening, start, stop };
}

export function ChatPanel({
  connectedAddress,
  onboarding,
  turns,
  onTurnsChange,
  onDealReleased,
  activeThreadId,
  onSelectThread,
  onThreadCreated,
}: {
  connectedAddress: string | undefined;
  onboarding: OnboardingResult;
  turns: ConversationTurn[];
  onTurnsChange: (update: (prev: ConversationTurn[]) => ConversationTurn[]) => void;
  onDealReleased: (receipt: DealReceipt) => void;
  /** Which thread is currently open — GENERAL_THREAD_ID or a deal's own
   * id (see types.ts's ConversationTurn.threadId). Controlled by App.tsx
   * so the Deals tab's "Return to chat" can open a SPECIFIC deal's
   * thread, not just the one flat list — this is the real fix for
   * "Return to chat opens a new/blank conversation instead of continuing
   * the one that was there": there wasn't a concept of separate threads
   * before, so "the chat" was always just whatever was in the single
   * array, and any deal in progress got mixed in with everything else. */
  activeThreadId: string;
  /** Sidebar thread click / "New chat" — switches which thread is shown
   * without leaving the Chat tab. */
  onSelectThread: (threadId: string) => void;
  /** Called once, the moment a message turns out to have started a deal
   * — lets App.tsx register the new thread in its sidebar list under a
   * real title immediately, not just whenever Dashboard happens to
   * re-derive deals from chain. */
  onThreadCreated: (threadId: string, title: string) => void;
}) {
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [pendingFile, setPendingFile] = useState<{ file: File; previewUrl?: string } | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  // User-controlled hide, independent of whether any thread exists —
  // "make it able to hide it" was explicit. Starts open; once the user
  // hides it, it stays hidden until they reopen it (not tied to nav or
  // thread switches — a manual view preference, not derived state).
  const [sidebarHidden, setSidebarHidden] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const threadTurns = turns.filter((t) => t.threadId === activeThreadId);
  const started = threadTurns.length > 0;
  // No real conversation exists yet (fresh wallet, nothing sent) — the
  // sidebar and its "New chat" button have nothing meaningful to show,
  // so they're not rendered at all rather than showing an empty shell
  // with a placeholder "General" row before anything ever happened.
  const hasAnyThreads = deriveThreads(turns).length > 0;
  const showSidebar = hasAnyThreads && !sidebarHidden;
  const speech = useSpeechToText((transcript) => {
    setInput((prev) => (prev.trim().length > 0 ? `${prev} ${transcript}` : transcript));
  });
  // Only the assistant turn that just arrived gets the word-reveal effect
  // — re-renders of older history (e.g. a deal turn's steps updating)
  // shouldn't replay it. mountedTurnCountRef freezes at first paint's
  // length, so anything already present when this component mounted
  // never animates; newTurnIndexRef tracks the single most-recently-
  // appended index so only that one bubble reveals. Keyed per-thread so
  // switching threads resets which turns count as "already there".
  const mountedTurnCountRef = useRef(threadTurns.length);
  useEffect(() => {
    mountedTurnCountRef.current = threadTurns.length;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeThreadId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [threadTurns.length]);

  // Revoke the pending-attachment preview's object URL if the component
  // unmounts (e.g. navigating away) while a file is still staged but
  // never sent — otherwise it leaks for the life of the tab.
  useEffect(() => {
    return () => {
      if (pendingFile?.previewUrl) URL.revokeObjectURL(pendingFile.previewUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function history(): ChatMessage[] {
    // Only this thread's own messages — a deal's thread shouldn't see
    // unrelated general chat as context, and vice versa.
    return threadTurns
      .filter((t): t is Extract<ConversationTurn, { kind: "text" }> => t.kind === "text")
      .map((t) => ({ role: t.role, text: t.text }));
  }

  function handleFileSelect(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = ""; // allow re-selecting the same file later
    if (!file) return;
    setFileError(null);
    if (file.size > MAX_FILE_BYTES) {
      setFileError(`${file.name} is too large — 15MB max.`);
      return;
    }
    const previewUrl = file.type.startsWith("image/") ? URL.createObjectURL(file) : undefined;
    setPendingFile({ file, previewUrl });
  }

  function clearPendingFile() {
    if (pendingFile?.previewUrl) URL.revokeObjectURL(pendingFile.previewUrl);
    setPendingFile(null);
  }

  // "New chat" previously only switched TO General — a no-op with no
  // visible effect when already viewing General, which is exactly what
  // made it look broken/unresponsive. Now it actually starts fresh: only
  // General's own turns are cleared (deal threads are untouched — they're
  // real on-chain history, not something a "new chat" click should ever
  // discard), and the view is switched to General so the input is
  // immediately ready for a genuinely new conversation.
  function handleNewChat() {
    onTurnsChange((prev) => prev.filter((t) => t.threadId !== GENERAL_THREAD_ID));
    onSelectThread(GENERAL_THREAD_ID);
  }

  // Removes a thread from THIS device's local chat history only — see
  // ChatThreadSidebar.tsx's ThreadRow comment on why any escrowed Deal
  // behind it is completely unaffected (Sui objects are permanent; this
  // is local UI state, same honesty convention as deal-local-meta.ts's
  // hide feature). If the deleted thread was the one currently open,
  // falls back to General so the view is never left pointing at a
  // thread that no longer has any turns.
  function handleDeleteThread(threadId: string) {
    onTurnsChange((prev) => prev.filter((t) => t.threadId !== threadId));
    if (activeThreadId === threadId) {
      onSelectThread(GENERAL_THREAD_ID);
    }
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = input.trim();
    if ((trimmed.length === 0 && !pendingFile) || busy) return;

    let chatAttachment: ChatAttachment | undefined;
    let turnAttachment: AttachmentInfo | undefined;
    if (pendingFile) {
      try {
        const data = await readFileAsBase64(pendingFile.file);
        chatAttachment = { mimeType: pendingFile.file.type || "application/octet-stream", data, name: pendingFile.file.name };
        turnAttachment = { name: pendingFile.file.name, mimeType: pendingFile.file.type, previewUrl: pendingFile.previewUrl };
      } catch (err) {
        setFileError(err instanceof Error ? err.message : "Failed to read the file.");
        return;
      }
    }

    setInput("");
    setPendingFile(null);
    const sentText = trimmed.length > 0 ? trimmed : `Attached: ${pendingFile?.file.name}`;
    // Sent from whichever thread is currently open. If this turns out to
    // start a deal, this same turn is retroactively re-tagged to that
    // deal's own thread id below — the LLM only reveals "this was a deal"
    // after the fact, so there's no way to know the real thread up front.
    onTurnsChange((prev) => [
      ...prev,
      { kind: "text", id: crypto.randomUUID(), role: "user", text: sentText, attachment: turnAttachment, threadId: activeThreadId },
    ]);
    setBusy(true);

    try {
      const result = await sendChatTurn([
        ...history(),
        { role: "user", text: sentText, attachment: chatAttachment },
      ]);

      if (result.kind === "reply") {
        onTurnsChange((prev) => [
          ...prev,
          { kind: "text", id: crypto.randomUUID(), role: "assistant", text: result.text, threadId: activeThreadId },
        ]);
        setBusy(false);
        return;
      }

      if (result.kind === "start_deal") {
        // Hand off to the real orchestrator, rendering its live steps
        // inline as this turn progresses. This only runs the client side
        // through escrow lock — a real specialist then has to
        // accept/deliver from their own inbox (SpecialistInbox.tsx)
        // before this deal can be released, so it does NOT finish in one
        // synchronous call anymore. Once escrowed, the Deals tab takes
        // over (polls live status, shows the Verify & Release button).
        const dealId = crypto.randomUUID();
        // Move EVERY turn currently in the active thread into this deal's
        // own thread — not just the one message matching sentText by
        // exact text. That narrower match was a real bug: once a
        // clarifying question is involved (see the system instruction in
        // agent/chat.ts), the message that actually triggers start_deal
        // is the user's REPLY to that question, not their original
        // request — matching only sentText left the original request
        // permanently stranded in General as its own orphaned,
        // untitled-looking thread while the reply alone moved to the new
        // deal thread. Sweeping the whole active thread's history in is
        // correct because a clarifying round-trip always happens within
        // the SAME thread before a deal starts — only do this when that
        // thread is General, though: if the user was mid-conversation in
        // an existing deal's thread, its unrelated history must not be
        // swept into a brand-new one.
        onTurnsChange((prev) => [
          ...prev.map((t) =>
            activeThreadId === GENERAL_THREAD_ID && t.threadId === activeThreadId ? { ...t, threadId: dealId } : t,
          ),
          { kind: "deal", id: dealId, task: result.task, steps: [], receipt: null, pending: null, threadId: dealId },
        ]);
        onThreadCreated(dealId, result.task);

        createDealAndEscrow(result.task, connectedAddress, onboarding, {
          onStepsChange: (nextSteps: StatusStep[]) => {
            onTurnsChange((prev) =>
              prev.map((t) => (t.kind === "deal" && t.id === dealId ? { ...t, steps: nextSteps } : t)),
            );
          },
          onEscrowed: (pending: PendingRelease) => {
            onTurnsChange((prev) =>
              prev.map((t) => (t.kind === "deal" && t.id === dealId ? { ...t, pending } : t)),
            );
            setBusy(false);
          },
        }).catch((err: unknown) => {
          // The failing step's own detail already carries the specific
          // reason (see fail() in orchestrator.ts and StepList's
          // rendering of it) — this just unblocks the input again rather
          // than leaving the chat stuck mid-turn.
          onTurnsChange((prev) => [
            ...prev,
            {
              kind: "text",
              id: crypto.randomUUID(),
              role: "assistant",
              text: `That didn't go through: ${err instanceof Error ? err.message : String(err)}`,
              threadId: dealId,
            },
          ]);
          setBusy(false);
        });
        return;
      }

      // result.kind === "start_deal_chain" — same shape as start_deal,
      // but only leg 0 is escrowed here (createDealChain is a thin
      // wrapper around createDealAndEscrow for exactly that leg). Leg 1+
      // are created later, gated on each prior leg's real on-chain proof
      // — see chainAdvance.ts's tryAdvanceChain, polled from
      // DealProgress below once this leg's `pending` exists.
      const chainId = crypto.randomUUID();
      const leg0 = result.legs[0];
      const chain: ChainInfo = {
        chainId,
        legIndex: 0,
        legTotal: result.legs.length,
        remainingLegs: result.legs.slice(1),
      };
      // Same fix as start_deal above: sweep EVERY turn from the active
      // thread (only when it's General) into the new chain thread, not
      // just the one message matching sentText — a clarifying-question
      // round-trip means the message that actually triggers
      // start_deal_chain is the user's reply, not their original
      // request, and matching only that reply stranded the original
      // request in General as its own orphaned thread.
      onTurnsChange((prev) => [
        ...prev.map((t) => (activeThreadId === GENERAL_THREAD_ID && t.threadId === activeThreadId ? { ...t, threadId: chainId } : t)),
        { kind: "deal", id: chainId, task: leg0.taskDescription, steps: [], receipt: null, pending: null, threadId: chainId, chain },
      ]);
      // The chain's thread is titled from the ORIGINAL multi-phase
      // request, not leg 0's narrower taskDescription, so the sidebar
      // reads e.g. "Laptop screen repair" rather than "Pick up laptop."
      onThreadCreated(chainId, sentText);

      createDealChain(result.legs, connectedAddress, onboarding, {
        onStepsChange: (nextSteps: StatusStep[]) => {
          onTurnsChange((prev) =>
            prev.map((t) => (t.kind === "deal" && t.id === chainId ? { ...t, steps: nextSteps } : t)),
          );
        },
        onEscrowed: (pending: PendingRelease) => {
          onTurnsChange((prev) =>
            prev.map((t) => (t.kind === "deal" && t.id === chainId ? { ...t, pending } : t)),
          );
          setBusy(false);
        },
      }).catch((err: unknown) => {
        onTurnsChange((prev) => [
          ...prev,
          {
            kind: "text",
            id: crypto.randomUUID(),
            role: "assistant",
            text: `That didn't go through: ${err instanceof Error ? err.message : String(err)}`,
            threadId: chainId,
          },
        ]);
        setBusy(false);
      });
    } catch (err) {
      onTurnsChange((prev) => [
        ...prev,
        { kind: "error", id: crypto.randomUUID(), text: err instanceof Error ? err.message : String(err), threadId: activeThreadId },
      ]);
      setBusy(false);
    }
  }

  const inputBox = (
    <div className="flex flex-col gap-2">
      {pendingFile && (
        <div className="flex items-center gap-2 self-start rounded-xl border border-border bg-surface px-3 py-2">
          {pendingFile.previewUrl ? (
            <img src={pendingFile.previewUrl} alt="" className="h-8 w-8 rounded-md object-cover" />
          ) : (
            <span className="flex h-8 w-8 items-center justify-center rounded-md bg-surface-hover text-manifest">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                <path d="M7 3h7l4 4v14H7V3ZM14 3v4h4" />
              </svg>
            </span>
          )}
          <span className="max-w-40 truncate text-xs text-manifest">{pendingFile.file.name}</span>
          <button
            type="button"
            onClick={clearPendingFile}
            aria-label="Remove attachment"
            className="text-manifest transition-colors hover:text-vellum"
          >
            ✕
          </button>
        </div>
      )}
      {fileError && <p className="text-xs text-wax">{fileError}</p>}

      <div className="flex items-center gap-1 rounded-full border border-border bg-surface p-2">
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPTED_FILE_TYPES}
          onChange={handleFileSelect}
          className="hidden"
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          aria-label="Attach a file"
          className="flex h-9 w-9 shrink-0 items-center justify-center self-center rounded-full text-manifest transition-colors hover:bg-surface-hover hover:text-vellum"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
            <path d="M17.5 8.5 9.4 16.6a3 3 0 0 1-4.24-4.24l7.78-7.78a4.5 4.5 0 0 1 6.36 6.36l-8.13 8.13a1.5 1.5 0 0 1-2.12-2.12l7.42-7.42" />
          </svg>
        </button>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSubmit(e);
            }
          }}
          placeholder={speech.listening ? "Listening…" : "Ask anything"}
          rows={1}
          autoFocus
          className="max-h-40 flex-1 resize-none self-center bg-transparent py-1.5 pl-1 text-sm text-vellum placeholder:text-manifest focus:outline-none"
        />
        {input.trim().length === 0 && !pendingFile && speech.supported ? (
          <button
            type="button"
            onClick={() => (speech.listening ? speech.stop() : speech.start())}
            aria-label={speech.listening ? "Stop listening" : "Voice input"}
            className={`flex h-9 w-9 shrink-0 items-center justify-center self-center rounded-full transition-colors ${
              speech.listening ? "bg-wax/20 text-wax" : "bg-surface-hover text-vellum hover:opacity-90"
            }`}
          >
            {speech.listening ? (
              <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-wax" />
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
                <path d="M19 10v1a7 7 0 0 1-14 0v-1M12 18v3" />
              </svg>
            )}
          </button>
        ) : (
          <button
            type="submit"
            disabled={busy || (input.trim().length === 0 && !pendingFile)}
            aria-label="Send"
            className="flex h-9 w-9 shrink-0 items-center justify-center self-center rounded-full bg-white text-black transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? (
              <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-black/30 border-t-black" />
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 19V5M5 12l7-7 7 7" />
              </svg>
            )}
          </button>
        )}
      </div>
    </div>
  );

  return (
    <div className="flex h-full">
      {showSidebar && (
        <ChatThreadSidebar
          turns={turns}
          activeThreadId={activeThreadId}
          onSelectThread={onSelectThread}
          onNewChat={handleNewChat}
          onCollapse={() => setSidebarHidden(true)}
          onDeleteThread={handleDeleteThread}
        />
      )}
      <LayoutGroup>
        <div className="relative flex h-full min-w-0 flex-1 flex-col">
          {hasAnyThreads && sidebarHidden && (
            <button
              type="button"
              onClick={() => setSidebarHidden(false)}
              title="Show sidebar"
              aria-label="Show sidebar"
              className="absolute left-4 top-4 z-10 rounded-lg border border-border bg-ink p-2 text-manifest transition-colors hover:border-white/30 hover:text-vellum sm:left-8"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="4" width="18" height="16" rx="2" />
                <path d="M9 4v16" />
              </svg>
            </button>
          )}
          {!started ? (
          <motion.div layout className="flex h-full flex-col items-center justify-center px-4 pb-[18vh]">
            <motion.p layout className="text-3xl font-normal text-vellum sm:text-4xl">
              What do you need done?
            </motion.p>
            <motion.form layout onSubmit={handleSubmit} className="mt-8 w-full max-w-2xl">
              {inputBox}
            </motion.form>
          </motion.div>
        ) : (
          <>
            <div className="min-h-0 flex-1 overflow-y-auto px-4 sm:px-8">
              <div className="mx-auto max-w-3xl">
                <AnimatePresence initial={false}>
                  <div className="flex flex-col gap-5 py-6">
                    {threadTurns.map((turn, i) => (
                      <motion.div
                        key={turn.id}
                        layout
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.2, ease: "easeOut" }}
                      >
                        {turn.kind === "text" && (
                          <MessageBubble
                            role={turn.role}
                            text={turn.text}
                            attachment={turn.attachment}
                            reveal={turn.role === "assistant" && i >= mountedTurnCountRef.current}
                          />
                        )}
                        {turn.kind === "error" && <MessageBubble role="assistant" text={turn.text} isError />}
                        {turn.kind === "deal" && (
                          <>
                            {turn.chain && <ChainLegHeader legIndex={turn.chain.legIndex} legTotal={turn.chain.legTotal} task={turn.task} />}
                            <DealProgress
                              task={turn.task}
                              steps={turn.steps}
                              pending={turn.pending}
                              receipt={turn.receipt}
                              chain={turn.chain ?? null}
                              threadId={turn.threadId}
                              // Only the LATEST leg of its chain should ever
                              // poll to advance the chain — otherwise every
                              // resolved earlier leg would independently
                              // try to create the next one too. This is a
                              // presentational hint only, NOT the real
                              // race guard — a plain boolean derived from
                              // `turns` can't reliably be one, since every
                              // mounted component instance (including
                              // stale/duplicate ones) recomputes it
                              // independently with no shared "someone's
                              // already doing this" signal between them.
                              // The actual guard against duplicate advance
                              // is chainAdvance.ts's chainsCurrentlyAdvancing
                              // module-level lock, held for a chain's
                              // entire advance regardless of which/how many
                              // component instances call in — that's what
                              // makes it now SAFE for this hint to be
                              // permissive: a later leg only counts as
                              // "the chain has moved on" once it actually
                              // escrowed (pending set), not merely exists
                              // as a turn, so a dead/failed duplicate leg
                              // (e.g. from the exact race the lock now
                              // prevents) can never permanently block the
                              // real leg from polling and retrying again —
                              // the lock, not this heuristic, is what
                              // stops that retry from ALSO racing.
                              isLatestUnadvancedLeg={
                                !!turn.chain &&
                                !turns.some(
                                  (t) =>
                                    t.kind === "deal" &&
                                    t.chain?.chainId === turn.chain!.chainId &&
                                    t.chain.legIndex > turn.chain!.legIndex &&
                                    t.pending !== null,
                                )
                              }
                              connectedAddress={connectedAddress}
                              onboarding={onboarding}
                              onTurnsChange={onTurnsChange}
                              onReleased={(receipt) => {
                                onTurnsChange((prev) =>
                                  prev.map((t) => (t.kind === "deal" && t.id === turn.id ? { ...t, receipt } : t)),
                                );
                                onDealReleased(receipt);
                              }}
                            />
                          </>
                        )}
                      </motion.div>
                    ))}
                  </div>
                </AnimatePresence>
                <div ref={bottomRef} />
              </div>
            </div>

            <div className="shrink-0 border-t border-border px-4 py-4 sm:px-8">
              <motion.form layout onSubmit={handleSubmit} className="mx-auto max-w-3xl">
                {inputBox}
              </motion.form>
            </div>
          </>
          )}
        </div>
      </LayoutGroup>
    </div>
  );
}

const POLL_INTERVAL_MS = 4000;

// orchestrator.ts's static step array indices: 0 searching, 1
// candidate-found, 2 negotiating, 3 mandate-check, 4 escrow-locked, 5
// work-in-progress, 6 verification, 7 payment-released, 8
// reputation-updated. Hoisted module-level (not per-render) since these
// never change.
const LIVE_STATUS_STEP_INDEX: Partial<Record<DealStatusName, number>> = {
  Escrowed: 5,
  Accepted: 5,
  Delivered: 6,
  Verified: 6,
  Released: 7,
  Settled: 8,
};
// Builds a fuller live-status detail using whatever real counterparty/
// amount info the reconstructed PendingRelease carries — "add more info,
// no need to compact it" was explicit feedback, so these read as a real
// status log rather than a terse label once escrow has locked.
function liveStatusDetail(status: DealStatusName, pending: PendingRelease, latestCheckpoint?: DealCheckpointInfo): string {
  const amount = pending.amountSui.toFixed(4);
  switch (status) {
    case "Escrowed":
      return `${amount} SUI is locked in escrow, waiting for ${pending.counterpartyName} to accept the offer from their own specialist inbox. Nothing moves until they do — if they never accept, the escrow refunds back to the Mandate once the delivery window lapses.`;
    case "Accepted": {
      const base = `${pending.counterpartyName} accepted the offer with their own wallet signature and is now working on the delivery. ${amount} SUI stays locked in escrow until they mark it delivered and it's verified.`;
      if (!latestCheckpoint) return base;
      return `${base} Latest update: "${latestCheckpoint.label}"${latestCheckpoint.note ? ` — ${latestCheckpoint.note}` : ""} (${formatDateTime(latestCheckpoint.createdAtMs)}).`;
    }
    case "Delivered":
      return `${pending.counterpartyName} marked the work delivered and uploaded proof (Seal-encrypted, stored on Walrus). Ready to verify and release — click below to confirm delivery and pay out the ${amount} SUI.`;
    case "Verified":
      return `Delivery verified. Releasing ${amount} SUI to ${pending.counterpartyName} on-chain.`;
    case "Released":
      return `${amount} SUI has been paid to ${pending.counterpartyName}'s wallet — confirmed by re-reading their live on-chain balance before and after, not just trusting the transaction didn't abort.`;
    case "Settled":
      return `This deal is fully settled on-chain.`;
    default:
      return status;
  }
}

/** A clear divider marking the handoff into one leg of a multi-agent
 * chain — deliberately more prominent than a small label, since a leg's
 * full step-by-step log (searching, negotiating, escrow...) appearing
 * right after the previous leg's card otherwise reads as noise piling up
 * rather than a deliberate "now starting the next step" moment. Only the
 * FIRST leg (index 0) skips this — that one is the direct result of the
 * user's own message, not a handoff from anything prior. */
function ChainLegHeader({ legIndex, legTotal, task }: { legIndex: number; legTotal: number; task: string }) {
  if (legIndex === 0) {
    return <p className="mb-1.5 text-xs uppercase tracking-wide text-manifest">Part 1 of {legTotal} · {task}</p>;
  }
  return (
    <div className="mb-3 mt-1 flex items-center gap-3">
      <span className="h-px flex-1 bg-border" />
      <p className="shrink-0 text-xs uppercase tracking-wide text-manifest">
        Part {legIndex + 1} of {legTotal} — starting next step
      </p>
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}

const LIVE_STATUS_LABEL: Partial<Record<DealStatusName, string>> = {
  Escrowed: "Waiting for the specialist to accept…",
  Accepted: "Accepted — waiting for delivery…",
  Delivered: "Delivered — ready to verify and release",
  Verified: "Verified",
  Released: "Payment released",
  Settled: "Settled",
};

/** ChatGPT-style collapsible tool-call indicator: expanded with full step
 * detail while a deal is running or just failed, auto-collapses to a
 * one-line summary a moment after it finishes successfully. Always
 * re-openable by clicking the summary line.
 *
 * Once escrow locks (`pending` is set), this polls the deal's REAL
 * on-chain status — the static `steps` array orchestrator.ts hands back
 * stops at "waiting for specialist" and never updates again, since a real
 * specialist accepts/delivers from their own separate browser session.
 * Without this poll, the chat bubble stayed frozen on "Waiting for
 * specialist" forever even after the specialist had actually delivered —
 * ProgressView already polled correctly; this brings the inline chat view
 * in sync with the same live signal instead of showing a second,
 * disagreeing story. */
function DealProgress({
  task,
  steps,
  pending,
  receipt,
  chain,
  threadId,
  isLatestUnadvancedLeg,
  connectedAddress,
  onboarding,
  onTurnsChange,
  onReleased,
}: {
  task: string;
  steps: StatusStep[];
  pending: PendingRelease | null;
  receipt: DealReceipt | null;
  /** Non-null only when this turn is one leg of a multi-agent chain — see
   * types.ts's ChainInfo and chainAdvance.ts. */
  chain: ChainInfo | null;
  threadId: string;
  /** True only for the single turn that should poll to advance the chain
   * — computed by the caller from the full turns array (see the render
   * call site) so a duplicate advance is structurally prevented rather
   * than merely debounced. Always false for a non-chain deal. */
  isLatestUnadvancedLeg: boolean;
  connectedAddress: string | undefined;
  onboarding: OnboardingResult;
  onTurnsChange: (update: (prev: ConversationTurn[]) => ConversationTurn[]) => void;
  onReleased: (receipt: DealReceipt) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const [autoCollapsed, setAutoCollapsed] = useState(false);
  const [liveStatus, setLiveStatus] = useState<DealStatusName | null>(null);
  // The granular specialist-pushed trail (e.g. "Picked up" -> "Arrived")
  // — without this, Chat only ever showed the coarse Escrowed/Accepted/
  // Delivered stage labels and sat on a single frozen "Waiting for the
  // specialist to accept & deliver" line for the entire delivery window,
  // even while the specialist was actively pushing real checkpoints that
  // ProgressView already displayed live. Same data source, same poll
  // cadence as ProgressView's own CheckpointItem trail, so the two views
  // can never disagree.
  const [checkpoints, setCheckpoints] = useState<DealCheckpointInfo[]>([]);
  const [releasing, setReleasing] = useState(false);
  const [releaseError, setReleaseError] = useState<string | null>(null);
  // Set the instant releaseDeal() resolves, but deliberately NOT the
  // same thing as `receipt` (the prop) — this only becomes the App-level
  // receipt (which pops the modal card open) once the user clicks "View
  // receipt" below, so release finishing doesn't yank a card open on top
  // of whatever the user is doing.
  const [readyReceipt, setReadyReceipt] = useState<DealReceipt | null>(null);
  const [reconstructedPending, setReconstructedPending] = useState<PendingRelease | null>(null);

  const failed = steps.some((s) => s.state === "failed");
  // A turn's `pending` field can be permanently null even after real
  // escrow (e.g. onEscrowed's write raced a page reload, or an older
  // saved session predates a fix) — steps[4]'s own detail text always
  // carries the real dealId once escrow locks (see orchestrator.ts's
  // `Deal ${dealId} created and escrowed on-chain`), which is enough to
  // rebuild everything else from chain via reconstructPendingRelease.
  // Without this, a turn stuck with pending: null can NEVER poll or
  // self-heal — this is what kept the exact same deal showing "Waiting
  // for specialist" in Chat while ProgressView (which always
  // reconstructs from a bare dealId) correctly showed Released.
  const escrowDetail = steps[4]?.detail;
  const dealIdFromSteps = typeof escrowDetail === "string" ? escrowDetail.match(/Deal (0x[0-9a-f]+) created/)?.[1] : undefined;
  const effectivePending = pending ?? reconstructedPending;

  useEffect(() => {
    if (pending || !dealIdFromSteps || reconstructedPending) return;
    let cancelled = false;
    reconstructPendingRelease(dealIdFromSteps)
      .then((found) => {
        if (!cancelled && found) setReconstructedPending(found);
      })
      .catch((err) => {
        console.error("DealProgress pending reconstruction failed for", dealIdFromSteps, err);
      });
    return () => {
      cancelled = true;
    };
  }, [pending, dealIdFromSteps, reconstructedPending]);

  useEffect(() => {
    if (!effectivePending || receipt || readyReceipt) return;
    let cancelled = false;

    async function poll() {
      try {
        console.log("[DealProgress] polling", { dealId: effectivePending!.dealId, chain, isLatestUnadvancedLeg });
        const deal = await findDealById(effectivePending!.dealId);
        console.log("[DealProgress] poll result", { dealId: effectivePending!.dealId, status: deal?.status });
        if (!cancelled && deal) setLiveStatus(deal.status);
      } catch (err) {
        // Transient GraphQL hiccup — next poll tick will retry. Logged
        // (not silently swallowed) since a genuinely stuck poll here
        // previously looked identical to "the chat status is wrong,"
        // when the real cause could be every fetch quietly failing.
        console.error("DealProgress poll failed for", effectivePending!.dealId, err);
      }
      try {
        const found = await findCheckpointsForDeal(effectivePending!.dealId);
        if (!cancelled) setCheckpoints(found);
      } catch (err) {
        console.error("DealProgress checkpoint poll failed for", effectivePending!.dealId, err);
      }
    }

    poll();
    const interval = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [effectivePending, receipt]);

  // Self-heals a turn whose receipt never got written back into `turns`
  // — e.g. it was released from ProgressView reached via a chain-derived
  // Dashboard card, a path that (before this fix) silently skipped the
  // `turns` update entirely. Rather than depend on every possible release
  // path remembering to write back correctly, this makes Chat's own
  // polling authoritative: the moment it independently observes
  // Released/Settled on-chain, it reconstructs a real receipt from chain
  // (the delivery proof + the original DealCreated amount) and reports it
  // up, so `turns` — and therefore what Chat shows — can never disagree
  // with the real on-chain state for long.
  useEffect(() => {
    if (receipt || !effectivePending) return;
    if (liveStatus !== "Released" && liveStatus !== "Settled") return;
    let cancelled = false;

    findProofForDeal(effectivePending.dealId)
      .then((proof) => {
        if (cancelled || !proof) return;
        onReleased({
          dealId: effectivePending.dealId,
          amount: effectivePending.amountSui,
          counterpartyName: effectivePending.counterpartyName,
          verification: { mocked: true, attestationId: proof.storageId },
          deliverable: { blobId: proof.storageId, allowlistId: effectivePending.allowlistId, seedId: proof.seedId, file: proof.file },
        });
      })
      .catch((err) => {
        console.error("DealProgress self-heal failed for", effectivePending.dealId, err);
      });

    return () => {
      cancelled = true;
    };
  }, [effectivePending, receipt, liveStatus, onReleased]);

  // Drives a multi-agent chain forward: once this leg's real on-chain
  // delivery proof exists, posts a summary of it to chat and (if more
  // legs remain) escrows the next one — see chainAdvance.ts. Reuses the
  // same POLL_INTERVAL_MS this component already polls liveStatus on,
  // gated on isLatestUnadvancedLeg (computed by the caller from the full
  // turns array) so only one turn per chain ever attempts this, and on
  // effectivePending existing (nothing to gate on before escrow locks).
  // tryAdvanceChain itself re-derives everything it needs from chain
  // (findProofForDeal), never trusting only in-memory state — same
  // principle as reconstructPendingRelease and the self-heal effect
  // above — so a page refresh mid-chain cannot strand it.
  useEffect(() => {
    console.log("[chainAdvance] gate check", { chain, isLatestUnadvancedLeg, effectivePending });
    if (!chain || chain.ended || !isLatestUnadvancedLeg || !effectivePending) return;
    let cancelled = false;
    // A single call to tryAdvanceChain involves several sequential async
    // steps (decrypt proof, a real Gemini summarization call, then a
    // full build-sign-wait escrow transaction for the next leg) that can
    // easily take longer than POLL_INTERVAL_MS combined. Without this
    // guard, setInterval fires the NEXT poll tick before the first one
    // has appended the new leg turn to `turns` — both ticks see the same
    // stale "no next leg yet" state and both think they're the one that
    // should create it, producing two duplicate leg turns (the exact bug
    // reported: "Part 2 of 3" appearing twice). isLatestUnadvancedLeg
    // alone can't prevent this — it's computed from `turns`, which
    // doesn't change until the FIRST call's onTurnsChange actually runs.
    let inFlight = false;

    async function poll() {
      if (inFlight) return;
      inFlight = true;
      try {
        console.log("[chainAdvance] polling tryAdvanceChain for", effectivePending!.dealId);
        await tryAdvanceChain({ task, threadId, pending: effectivePending!, chain: chain! }, connectedAddress, onboarding, onTurnsChange);
      } catch (err) {
        if (!cancelled) console.error("DealProgress chain-advance failed for", effectivePending!.dealId, err);
      } finally {
        inFlight = false;
      }
    }

    poll();
    const interval = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chain, isLatestUnadvancedLeg, effectivePending, connectedAddress, onboarding, onTurnsChange, readyReceipt]);

  // Once escrow locks, orchestrator.ts's static steps stop at
  // "work-in-progress" and never change again — it has no way to know what
  // a real specialist does in their own separate session. Rather than bolt
  // a second, separately worded status panel underneath the frozen list
  // (which is what produced the contradiction: the step list frozen on
  // "waiting" while a panel below says "Delivered, ready to release"),
  // overlay liveStatus onto the SAME steps array so there is exactly one
  // story on screen.
  //
  // A turn that already carries a `receipt` (release already happened and
  // was written back — e.g. across a page reload, or via the self-heal
  // effect above) must NOT depend on the poll effect to learn that: that
  // effect explicitly bails out `if (receipt) return` and so never sets
  // `liveStatus`, leaving it permanently null and this overlay a no-op —
  // exactly what left a genuinely Released deal frozen on "Waiting for
  // specialist" in Chat while ProgressView (no such gate) showed Released.
  // A receipt is itself proof of the terminal state, so treat it as one.
  const effectiveLiveStatus: DealStatusName | null = receipt ? "Released" : liveStatus;
  const latestCheckpoint = checkpoints.length > 0 ? checkpoints[checkpoints.length - 1] : undefined;
  const displaySteps: StatusStep[] = (() => {
    if (!effectivePending || !effectiveLiveStatus) return steps;
    // verify_and_release() bumps BOTH reputations in the same atomic
    // transaction as payment (see deal.move's verify_and_release calling
    // client_reputation.record_completed() / specialist_reputation.
    // record_completed() right after pay_specialist) — so a `receipt`
    // existing means reputation is already done too, not merely payment.
    // Without this, step 8 ("Updating on-chain reputation") sat at
    // "pending" forever once release finished, since deal.move's status
    // machine has no separate on-chain "Settled" phase this poll could
    // ever observe distinct from Released, and the poll effect stops
    // entirely the instant `receipt` is set (see the poll effect above).
    const targetIndex = receipt ? steps.length - 1 : LIVE_STATUS_STEP_INDEX[effectiveLiveStatus];
    if (targetIndex === undefined) return steps;
    return steps.map((step, i) => {
      if (i < targetIndex) return step.state === "done" ? step : { ...step, state: "done" as const };
      if (i === targetIndex) {
        return {
          ...step,
          state: effectiveLiveStatus === "Released" || effectiveLiveStatus === "Settled" ? ("done" as const) : ("active" as const),
          detail: effectivePending
            ? liveStatusDetail(effectiveLiveStatus, effectivePending, latestCheckpoint)
            : (LIVE_STATUS_LABEL[effectiveLiveStatus] ?? step.detail),
        };
      }
      return step.state === "pending" ? step : { ...step, state: "pending" as const, detail: undefined };
    });
  })();

  // Never declare "Done" while any step the user can see is still
  // pending/active — this exact contradiction ("Done" banner over an
  // incomplete step list) was reported live. displaySteps is the single
  // rendered source of truth, so gate on it directly rather than trusting
  // receipt/liveStatus alone to agree with what's on screen.
  // NOTE: "no pending yet" means escrow hasn't even locked — that is the
  // OPPOSITE of done, not a done state, so it must never appear in this
  // OR chain (a real bug this same file had until this fix: `|| !pending`
  // made a barely-started deal show "Done" before escrow even existed).
  const allStepsDone = displaySteps.length > 0 && displaySteps.every((s) => s.state === "done");
  const allDone = allStepsDone && (Boolean(receipt) || effectiveLiveStatus === "Released" || effectiveLiveStatus === "Settled");

  // Once a chain has moved past this leg (a later leg now exists), this
  // card is no longer the "current" thing happening — collapsing it is
  // what actually makes a leg transition read as a clear handoff instead
  // of every leg's full step-by-step log just piling up on screen at
  // once. Collapses immediately (no allDone requirement, no delay) the
  // moment isLatestUnadvancedLeg goes false, since by definition that only
  // happens after this leg's own proof already existed — there's nothing
  // further for the user to watch happen here.
  const supersededByLaterLeg = chain !== null && !isLatestUnadvancedLeg;

  useEffect(() => {
    if (allDone && !autoCollapsed) {
      const timer = setTimeout(() => {
        setExpanded(false);
        setAutoCollapsed(true);
      }, 1200);
      return () => clearTimeout(timer);
    }
  }, [allDone, autoCollapsed]);

  useEffect(() => {
    if (supersededByLaterLeg) {
      setExpanded(false);
      setAutoCollapsed(true);
    }
  }, [supersededByLaterLeg]);

  async function handleRelease() {
    if (!effectivePending) return;
    setReleasing(true);
    setReleaseError(null);
    try {
      const finalReceipt = await releaseDeal(effectivePending);
      // Hold the receipt here rather than opening the pop-out card
      // immediately — release finishing and the user actually being
      // ready to look at a receipt are two different moments. The card
      // now shows a real "View receipt" button; onReleased (which pops
      // the modal open in App.tsx) only fires once that's clicked.
      setReadyReceipt(finalReceipt);
    } catch (err) {
      setReleaseError(err instanceof Error ? err.message : String(err));
    } finally {
      setReleasing(false);
    }
  }

  const summary = failed
    ? "Something went wrong"
    : allDone
      ? "Done"
      : effectivePending && effectiveLiveStatus
        ? (effectiveLiveStatus === "Accepted" && latestCheckpoint
            ? latestCheckpoint.label
            : (LIVE_STATUS_LABEL[effectiveLiveStatus] ?? "Working…"))
        : displaySteps.find((s) => s.state === "active")?.label ?? "Working…";

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-2.5 px-4 py-3 text-left transition-colors hover:bg-surface-hover"
      >
        {!allDone && !failed && (
          <span
            className="inline-block h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-manifest border-t-vellum"
            role="status"
            aria-label="In progress"
          />
        )}
        {allDone && <span className="shrink-0 text-vellum">✓</span>}
        {failed && <span className="shrink-0 text-red-500">✕</span>}
        <span className="min-w-0 flex-1 truncate text-sm text-vellum">{summary}</span>
        <span className={`shrink-0 text-manifest transition-transform ${expanded ? "rotate-180" : ""}`}>⌄</span>
      </button>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
          >
            <div className="border-t border-border px-4 py-4">
              <p className="mb-4 text-xs text-manifest">Task: {task}</p>
              <StepList steps={displaySteps} />

              {checkpoints.length > 0 && (
                <div className="mt-4 space-y-3 border-t border-border pt-4">
                  {checkpoints.map((c) => (
                    <div key={c.checkpointId}>
                      <p className="text-[11px] uppercase tracking-wide text-manifest">Specialist update</p>
                      <div className="mt-0.5 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                        <p className="text-sm text-vellum">{c.label}</p>
                        <p className="shrink-0 text-xs text-manifest">{formatDateTime(c.createdAtMs)}</p>
                      </div>
                      {c.note && <p className="mt-1 text-sm text-manifest">{c.note}</p>}
                    </div>
                  ))}
                </div>
              )}

              {effectivePending && !receipt && !readyReceipt && liveStatus === "Delivered" && (
                <div className="mt-4 border-t border-border pt-4">
                  <button
                    type="button"
                    onClick={handleRelease}
                    disabled={releasing}
                    className="rounded-md bg-white px-4 py-2 text-sm font-medium text-black transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {releasing ? "Releasing…" : "Verify & Release Payment"}
                  </button>
                  {releaseError && <p className="mt-2 text-sm text-wax">{releaseError}</p>}
                </div>
              )}

              {readyReceipt && !receipt && (
                <div className="mt-4 border-t border-border pt-4">
                  <p className="mb-2 text-sm text-vellum">
                    Payment released — {readyReceipt.amount.toFixed(4)} SUI paid to {readyReceipt.counterpartyName}.
                  </p>
                  <button
                    type="button"
                    onClick={() => onReleased(readyReceipt)}
                    className="rounded-md bg-white px-4 py-2 text-sm font-medium text-black transition-opacity hover:opacity-90"
                  >
                    View receipt
                  </button>
                </div>
              )}

              {chain && !chain.ended && !allDone && (
                <div className="mt-4 border-t border-border pt-4">
                  <button
                    type="button"
                    onClick={() => {
                      onTurnsChange((prev) =>
                        prev.map((t) =>
                          t.kind === "deal" && t.chain?.chainId === chain.chainId ? { ...t, chain: { ...t.chain, ended: true } } : t,
                        ),
                      );
                    }}
                    className="rounded-md border border-border px-3 py-1.5 text-xs text-manifest transition-colors hover:border-white/30 hover:text-vellum"
                  >
                    End session
                  </button>
                  <p className="mt-1.5 text-xs text-manifest">
                    Stops this chain from creating any further legs. Any deal already escrowed on-chain is untouched — it still resolves
                    normally (accept/deliver/release, or refunds automatically if the specialist never responds).
                  </p>
                </div>
              )}

              {chain?.ended && (
                <div className="mt-4 border-t border-border pt-4">
                  <p className="text-xs text-manifest">Session ended — this chain will not create any further legs.</p>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function MessageBubble({
  role,
  text,
  isError,
  reveal = false,
  attachment,
}: {
  role: "user" | "assistant";
  text: string;
  isError?: boolean;
  /** Word-by-word reveal, applied only to the assistant turn that just
   * arrived — see mountedTurnCountRef in ChatPanel. */
  reveal?: boolean;
  attachment?: import("./types").AttachmentInfo;
}) {
  const isUser = role === "user";
  const displayText = useWordReveal(text, reveal);

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div className={`flex max-w-[85%] flex-col gap-2 ${isUser ? "items-end" : "items-start"}`}>
        {attachment && (
          <div className="flex items-center gap-2 rounded-xl border border-border bg-surface px-3 py-2">
            {attachment.previewUrl ? (
              <img src={attachment.previewUrl} alt="" className="h-8 w-8 rounded-md object-cover" />
            ) : (
              <span className="flex h-8 w-8 items-center justify-center rounded-md bg-surface-hover text-manifest">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M7 3h7l4 4v14H7V3ZM14 3v4h4" />
                </svg>
              </span>
            )}
            <span className="max-w-40 truncate text-xs text-manifest">{attachment.name}</span>
          </div>
        )}
        <div
          className={`min-w-0 break-words [overflow-wrap:anywhere] rounded-2xl px-4 py-2.5 text-sm ${
            isUser
              ? "bg-white text-black"
              : isError
                ? "border border-wax/40 bg-wax/10 text-vellum"
                : "border border-border bg-surface text-vellum"
          }`}
        >
          {isUser ? text : <Markdown>{displayText}</Markdown>}
        </div>
        {!isUser && !isError && <SpeakButton text={text} />}
      </div>
    </div>
  );
}

/** Read-aloud via the browser's built-in SpeechSynthesis API — no
 * external TTS service/dependency, works fully offline once the voice
 * list is loaded. Markdown syntax (**, #, |, etc.) is stripped first so
 * the model doesn't literally read out asterisks and pipe characters. */
function SpeakButton({ text }: { text: string }) {
  const [speaking, setSpeaking] = useState(false);

  function stripMarkdown(md: string): string {
    return md
      .replace(/```[\s\S]*?```/g, "") // fenced code blocks
      .replace(/`([^`]+)`/g, "$1")
      .replace(/^#{1,6}\s+/gm, "")
      .replace(/\*\*([^*]+)\*\*/g, "$1")
      .replace(/\*([^*]+)\*/g, "$1")
      .replace(/^\s*[-*+]\s+/gm, "")
      .replace(/^\s*\d+\.\s+/gm, "")
      .replace(/\|/g, " ")
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      .trim();
  }

  function handleClick() {
    if (!("speechSynthesis" in window)) return;
    if (speaking) {
      window.speechSynthesis.cancel();
      setSpeaking(false);
      return;
    }
    const utterance = new SpeechSynthesisUtterance(stripMarkdown(text));
    utterance.onend = () => setSpeaking(false);
    utterance.onerror = () => setSpeaking(false);
    window.speechSynthesis.cancel(); // stop any prior utterance first
    window.speechSynthesis.speak(utterance);
    setSpeaking(true);
  }

  if (typeof window === "undefined" || !("speechSynthesis" in window)) return null;

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label={speaking ? "Stop reading" : "Read aloud"}
      className="flex h-6 w-6 items-center justify-center rounded-md text-manifest transition-colors hover:bg-surface-hover hover:text-vellum"
    >
      {speaking ? (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
          <rect x="6" y="6" width="12" height="12" rx="1.5" />
        </svg>
      ) : (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
          <path d="M11 5 6 9H2v6h4l5 4V5Z" />
          <path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" />
        </svg>
      )}
    </button>
  );
}

/** Reveals `text` one markdown block (paragraph, list, table, heading —
 * split on blank lines) at a time when `active` is true — a lightweight
 * client-side typing effect, not a real token stream (Gemini's REST call
 * here isn't streaming; this just paces the already-complete reply back
 * out for the same visual effect). Block-level rather than word-by-word
 * so a table or bold span is never revealed mid-syntax, which would
 * render as broken markdown for a frame and then "pop" once complete.
 * Returns the full text immediately when `active` is false, so history
 * never replays the animation. */
function useWordReveal(text: string, active: boolean): string {
  const blocks = text.split(/\n{2,}/);
  const [revealedCount, setRevealedCount] = useState(active ? 0 : blocks.length);

  useEffect(() => {
    if (!active) return;
    if (revealedCount >= blocks.length) return;
    const timer = setTimeout(() => setRevealedCount((c) => c + 1), 220);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, revealedCount, blocks.length]);

  if (!active) return text;
  return blocks.slice(0, revealedCount).join("\n\n");
}
