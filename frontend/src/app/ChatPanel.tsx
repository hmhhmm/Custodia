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
import { runOrchestratedDeal } from "./orchestrator";
import type { OnboardingResult } from "./Onboarding";
import type { AttachmentInfo, ConversationTurn, DealReceipt } from "./types";
import { StepList } from "./StatusFeed";
import { Markdown } from "./components/Markdown";

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
  onDealComplete,
}: {
  connectedAddress: string | undefined;
  onboarding: OnboardingResult;
  turns: ConversationTurn[];
  onTurnsChange: (update: (prev: ConversationTurn[]) => ConversationTurn[]) => void;
  onDealComplete: (receipt: DealReceipt, task: string) => void;
}) {
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [pendingFile, setPendingFile] = useState<{ file: File; previewUrl?: string } | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const started = turns.length > 0;
  const speech = useSpeechToText((transcript) => {
    setInput((prev) => (prev.trim().length > 0 ? `${prev} ${transcript}` : transcript));
  });
  // Only the assistant turn that just arrived gets the word-reveal effect
  // — re-renders of older history (e.g. a deal turn's steps updating)
  // shouldn't replay it. mountedTurnCountRef freezes at first paint's
  // length, so anything already present when this component mounted
  // never animates; newTurnIndexRef tracks the single most-recently-
  // appended index so only that one bubble reveals.
  const mountedTurnCountRef = useRef(turns.length);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [turns]);

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
    return turns
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
    onTurnsChange((prev) => [
      ...prev,
      { kind: "text", role: "user", text: sentText, attachment: turnAttachment },
    ]);
    setBusy(true);

    try {
      const result = await sendChatTurn([
        ...history(),
        { role: "user", text: sentText, attachment: chatAttachment },
      ]);

      if (result.kind === "reply") {
        onTurnsChange((prev) => [...prev, { kind: "text", role: "assistant", text: result.text }]);
        setBusy(false);
        return;
      }

      // result.kind === "start_deal" — hand off to the real orchestrator,
      // rendering its live steps inline as this turn progresses.
      const dealId = crypto.randomUUID();
      onTurnsChange((prev) => [...prev, { kind: "deal", id: dealId, task: result.task, steps: [], receipt: null }]);

      runOrchestratedDeal(result.task, connectedAddress, onboarding, {
        onStepsChange: (nextSteps) => {
          onTurnsChange((prev) =>
            prev.map((t) => (t.kind === "deal" && t.id === dealId ? { ...t, steps: nextSteps } : t)),
          );
        },
        onComplete: (receipt) => {
          onTurnsChange((prev) =>
            prev.map((t) => (t.kind === "deal" && t.id === dealId ? { ...t, receipt } : t)),
          );
          onDealComplete(receipt, result.task);
          setBusy(false);
        },
      }).catch((err) => {
        // The failing step's own detail already carries the specific
        // reason (see fail() in orchestrator.ts and StepList's rendering
        // of it) — this just unblocks the input again rather than
        // leaving the chat stuck mid-turn.
        onTurnsChange((prev) => [
          ...prev,
          {
            kind: "text",
            role: "assistant",
            text: `That didn't go through: ${err instanceof Error ? err.message : String(err)}`,
          },
        ]);
        setBusy(false);
      });
    } catch (err) {
      onTurnsChange((prev) => [
        ...prev,
        { kind: "error", text: err instanceof Error ? err.message : String(err) },
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
    <LayoutGroup>
      <div className="flex h-full flex-col">
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
                    {turns.map((turn, i) => (
                      <motion.div
                        key={i}
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
                        {turn.kind === "deal" && <DealProgress task={turn.task} steps={turn.steps} />}
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
  );
}

/** ChatGPT-style collapsible tool-call indicator: expanded with full step
 * detail while a deal is running or just failed, auto-collapses to a
 * one-line summary a moment after it finishes successfully. Always
 * re-openable by clicking the summary line. */
function DealProgress({ task, steps }: { task: string; steps: import("./types").StatusStep[] }) {
  const [expanded, setExpanded] = useState(true);
  const [autoCollapsed, setAutoCollapsed] = useState(false);
  const allDone = steps.length > 0 && steps.every((s) => s.state === "done");
  const failed = steps.some((s) => s.state === "failed");
  const active = steps.find((s) => s.state === "active");

  useEffect(() => {
    if (allDone && !autoCollapsed) {
      const timer = setTimeout(() => {
        setExpanded(false);
        setAutoCollapsed(true);
      }, 1200);
      return () => clearTimeout(timer);
    }
  }, [allDone, autoCollapsed]);

  const summary = failed
    ? "Something went wrong"
    : allDone
      ? "Done"
      : active
        ? active.label
        : "Working…";

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-2.5 px-4 py-3 text-left transition-colors hover:bg-surface-hover"
      >
        {!allDone && !failed && (
          <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-vellum" aria-hidden="true" />
        )}
        {allDone && <span className="shrink-0 text-emerald-500">✓</span>}
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
              <StepList steps={steps} />
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
