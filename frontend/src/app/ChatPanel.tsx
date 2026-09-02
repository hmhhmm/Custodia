// Replaces GoalInput + the standalone StatusFeed screen with a single
// ongoing conversation: an OpenAI-style input box, plain assistant/user
// message bubbles for normal chat, and — when the LLM's start_deal tool
// fires — the live StatusFeed progress list rendered inline as part of
// that assistant turn. A failed deal shows its error directly in the
// chat instead of stranding the user on a dead-end screen.

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { sendChatTurn, type ChatMessage } from "../agent/chat";
import { runOrchestratedDeal } from "./orchestrator";
import type { OnboardingResult } from "./Onboarding";
import type { DealReceipt, StatusStep } from "./types";
import { StatusFeed } from "./StatusFeed";

type Turn =
  | { kind: "text"; role: "user" | "assistant"; text: string }
  | { kind: "deal"; task: string; steps: StatusStep[]; receipt: DealReceipt | null }
  | { kind: "error"; text: string };

export function ChatPanel({
  connectedAddress,
  onboarding,
  onDealComplete,
  onBack,
}: {
  connectedAddress: string | undefined;
  onboarding: OnboardingResult;
  onDealComplete: (receipt: DealReceipt, task: string) => void;
  onBack: () => void;
}) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [turns]);

  function history(): ChatMessage[] {
    return turns
      .filter((t): t is Extract<Turn, { kind: "text" }> => t.kind === "text")
      .map((t) => ({ role: t.role, text: t.text }));
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = input.trim();
    if (trimmed.length === 0 || busy) return;

    setInput("");
    setTurns((prev) => [...prev, { kind: "text", role: "user", text: trimmed }]);
    setBusy(true);

    try {
      const result = await sendChatTurn([...history(), { role: "user", text: trimmed }]);

      if (result.kind === "reply") {
        setTurns((prev) => [...prev, { kind: "text", role: "assistant", text: result.text }]);
        setBusy(false);
        return;
      }

      // result.kind === "start_deal" — hand off to the real orchestrator,
      // rendering its live steps inline as this turn progresses.
      const dealTurnIndex = turns.length + 1; // +1 for the user turn just pushed
      setTurns((prev) => [...prev, { kind: "deal", task: result.task, steps: [], receipt: null }]);

      runOrchestratedDeal(result.task, connectedAddress, onboarding, {
        onStepsChange: (nextSteps) => {
          setTurns((prev) => {
            const copy = [...prev];
            const turn = copy[dealTurnIndex];
            if (turn?.kind === "deal") copy[dealTurnIndex] = { ...turn, steps: nextSteps };
            return copy;
          });
        },
        onComplete: (receipt) => {
          setTurns((prev) => {
            const copy = [...prev];
            const turn = copy[dealTurnIndex];
            if (turn?.kind === "deal") copy[dealTurnIndex] = { ...turn, receipt };
            return copy;
          });
          onDealComplete(receipt, result.task);
          setBusy(false);
        },
      }).catch((err) => {
        // The failing step's own detail already carries the specific
        // reason (see fail() in orchestrator.ts and StatusFeed's
        // rendering of it) — this just unblocks the input again rather
        // than leaving the chat stuck mid-turn.
        setTurns((prev) => [
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
      setTurns((prev) => [
        ...prev,
        { kind: "error", text: err instanceof Error ? err.message : String(err) },
      ]);
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex h-[calc(100vh-9rem)] max-w-3xl flex-col">
      <button
        type="button"
        onClick={onBack}
        className="mb-2 self-start text-sm text-manifest transition-colors hover:text-vellum focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        ← Back to deals
      </button>

      <div className="flex-1 overflow-y-auto pr-1">
        {turns.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <p className="text-lg font-medium text-vellum">What do you need done?</p>
            <p className="mt-2 max-w-sm text-sm text-manifest">
              Ask a question, or describe a task — Envoy finds a specialist, escrows payment, and pays
              out once the work is verified.
            </p>
          </div>
        )}

        <AnimatePresence initial={false}>
          <div className="flex flex-col gap-4 py-4">
            {turns.map((turn, i) => (
              <motion.div
                key={i}
                layout
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2, ease: "easeOut" }}
              >
                {turn.kind === "text" && <MessageBubble role={turn.role} text={turn.text} />}
                {turn.kind === "error" && <MessageBubble role="assistant" text={turn.text} isError />}
                {turn.kind === "deal" && (
                  <div className="rounded-lg border border-border bg-surface p-5">
                    <p className="mb-4 text-sm text-manifest">Task: {turn.task}</p>
                    <StatusFeed steps={turn.steps} onBack={() => {}} embedded />
                  </div>
                )}
              </motion.div>
            ))}
          </div>
        </AnimatePresence>
        <div ref={bottomRef} />
      </div>

      <form onSubmit={handleSubmit} className="border-t border-border pt-4">
        <div className="flex items-end gap-2 rounded-xl border border-border bg-surface p-2 focus-within:border-accent">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSubmit(e);
              }
            }}
            placeholder="Message Envoy…"
            rows={1}
            className="max-h-40 flex-1 resize-none bg-transparent px-2 py-2 text-sm text-vellum placeholder:text-manifest focus:outline-none"
          />
          <button
            type="submit"
            disabled={busy || input.trim().length === 0}
            className="shrink-0 rounded-lg bg-white px-4 py-2 text-sm font-medium text-black transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? "…" : "Send"}
          </button>
        </div>
      </form>
    </div>
  );
}

function MessageBubble({ role, text, isError }: { role: "user" | "assistant"; text: string; isError?: boolean }) {
  const isUser = role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[85%] rounded-xl px-4 py-2.5 text-sm ${
          isUser
            ? "bg-white text-black"
            : isError
              ? "border border-wax/40 bg-wax/10 text-vellum"
              : "border border-border bg-surface text-vellum"
        }`}
      >
        {text}
      </div>
    </div>
  );
}
