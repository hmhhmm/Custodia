// A multi-agent chain (pickup -> repair -> return, etc.) has no single
// on-chain object of its own — deal.move's Deal is strictly two-party, so
// a chain is really just several ordinary Deals created in sequence (see
// chainAdvance.ts). Dashboard's chain group cards summarize that sequence
// in one card, but a real "open the whole chain" action needs somewhere
// to land: this page stacks each leg's full ProgressView content, in
// order, on one scrollable page, instead of forcing a click into any one
// leg's separate, unrelated-looking detail page.

import type { ConversationTurn, DealReceipt } from "./types";
import { ProgressView } from "./ProgressView";

export function ChainDetailView({
  legs,
  onBack,
  onReturnToChat,
  onReleased,
}: {
  /** Ordered legs to render, each with the real dealId to drive its own
   * ProgressView and (when this leg is still live in the current
   * session) the matching turn for the nicer pre-escrow step feed. */
  legs: { dealId: string; turn?: Extract<ConversationTurn, { kind: "deal" }>; label: string }[];
  onBack: () => void;
  onReturnToChat: () => void;
  onReleased: (receipt: DealReceipt) => void;
}) {
  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-10">
      <div className="mb-6 flex items-center justify-between">
        <button
          type="button"
          onClick={onBack}
          className="text-sm text-manifest transition-colors hover:text-vellum focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          ← Back to deals
        </button>
        <button
          type="button"
          onClick={onReturnToChat}
          className="rounded-md border border-border px-3 py-1.5 text-sm text-vellum transition-colors hover:border-white/30"
        >
          Return to chat
        </button>
      </div>

      <div className="flex flex-col gap-8">
        {legs.map((leg, i) => (
          <div key={leg.dealId}>
            <p className="mb-3 text-xs uppercase tracking-wide text-manifest">
              Part {i + 1} of {legs.length} — {leg.label}
            </p>
            <ProgressView
              dealId={leg.dealId}
              turn={leg.turn}
              onBack={onBack}
              onReturnToChat={onReturnToChat}
              onReleased={onReleased}
              embedded
            />
          </div>
        ))}
      </div>
    </div>
  );
}
