// Chat conversation history — per-device, per-wallet-address persistence
// via localStorage. Without this, ConversationTurn state lived only in
// React memory (App.tsx's useState), so any page refresh — or simply
// closing and reopening the tab — silently wiped the entire chat
// transcript AND every in-progress deal's live step history, even though
// the underlying Deal objects were untouched on-chain. "Return to chat"
// from the Deals tab landing on an empty conversation was a direct
// symptom of this.
//
// Same honesty rule as deal-local-meta.ts: this is a per-device UI
// convenience, not a source of truth. It never contains anything that
// doesn't already exist on-chain in more authoritative form (deal status,
// amounts) — the ONLY thing genuinely at risk of being lost here is plain
// conversational text, which was never on-chain to begin with.
//
// Keyed by wallet address (not a single global key) so switching accounts
// in the same browser shows that account's own history, not another
// wallet's.

import type { ConversationTurn } from "./types";

const STORAGE_PREFIX = "custodia:chat-history:";

// AttachmentInfo.previewUrl is a blob: object URL — valid only for the
// tab session that created it via URL.createObjectURL. Persisting it
// verbatim would restore a dead URL after reload (broken image icon), so
// it's stripped on save; ChatPanel already treats a missing previewUrl as
// "no thumbnail, just show the filename" for non-image attachments, which
// degrades correctly rather than breaking.
function stripEphemeralFields(turns: ConversationTurn[]): ConversationTurn[] {
  return turns.map((turn) => {
    if (turn.kind === "text" && turn.attachment?.previewUrl) {
      const { previewUrl: _previewUrl, ...rest } = turn.attachment;
      return { ...turn, attachment: rest };
    }
    return turn;
  });
}

// Turns saved before every ConversationTurn variant carried a stable
// `id` (see types.ts's own comment on why the array-index React key it
// replaced was a real bug) have no `id` field in old localStorage data.
// Backfilling one on load keeps that old history usable instead of
// producing turns with `id: undefined` — which would silently reintroduce
// the exact React-key bug this schema change fixed, just for restored
// history instead of freshly-created turns.
function backfillMissingIds(turns: unknown[]): ConversationTurn[] {
  return turns.map((turn) => {
    if (turn && typeof turn === "object" && !("id" in turn)) {
      return { ...turn, id: crypto.randomUUID() } as ConversationTurn;
    }
    return turn as ConversationTurn;
  });
}

export function loadChatHistory(walletAddress: string): ConversationTurn[] {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + walletAddress);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? backfillMissingIds(parsed) : [];
  } catch {
    return [];
  }
}

export function saveChatHistory(walletAddress: string, turns: ConversationTurn[]): void {
  try {
    localStorage.setItem(STORAGE_PREFIX + walletAddress, JSON.stringify(stripEphemeralFields(turns)));
  } catch {
    // Private browsing / storage disabled / quota exceeded (a long chat
    // history with many turns) — history just won't persist across
    // reloads. Not worth surfacing an error for a local convenience.
  }
}

export function clearChatHistory(walletAddress: string): void {
  try {
    localStorage.removeItem(STORAGE_PREFIX + walletAddress);
  } catch {
    // Same as above — nothing to do if storage is unavailable.
  }
}
