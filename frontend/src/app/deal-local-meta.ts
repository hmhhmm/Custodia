// Per-device UI conveniences for deal cards — hiding a card and adding a
// personal note. Deliberately NOT a database and NEVER a source of truth
// for deal state: the real Deal object on-chain is unaffected by anything
// here. "Hide" cannot delete an on-chain Deal (Move has no such function —
// once escrowed, funds are real and the state machine is permanent), so
// this only ever changes what's shown in THIS browser. Keyed by dealId in
// localStorage so it survives a refresh (that's the whole point — the
// on-chain deal list is refresh-proof already; this makes the "I hid this
// one" preference refresh-proof too).

const STORAGE_KEY = "custodia:deal-local-meta";

interface LocalMeta {
  hidden: Record<string, true>;
  notes: Record<string, string>;
  /** Gemini-generated deal titles (see llm.ts's summarizeDealTitle),
   * cached by dealId. Once a title is generated for a deal it can never
   * meaningfully change (the category/amount it was built from are fixed
   * at creation), so there's no reason to keep re-asking Gemini for the
   * same text on every page load — this was a real, wasteful gap before
   * (an in-memory-only Map that reset on every refresh). */
  titles: Record<string, string>;
}

function readAll(): LocalMeta {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { hidden: {}, notes: {}, titles: {} };
    const parsed = JSON.parse(raw);
    return { hidden: parsed.hidden ?? {}, notes: parsed.notes ?? {}, titles: parsed.titles ?? {} };
  } catch {
    return { hidden: {}, notes: {}, titles: {} };
  }
}

function writeAll(meta: LocalMeta): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(meta));
  } catch {
    // Private browsing / storage disabled — hide/note just won't persist
    // across reloads. Not worth surfacing an error for a local convenience.
  }
}

export function isDealHidden(dealId: string): boolean {
  return Boolean(readAll().hidden[dealId]);
}

export function hideDeal(dealId: string): void {
  const meta = readAll();
  meta.hidden[dealId] = true;
  writeAll(meta);
}

export function unhideDeal(dealId: string): void {
  const meta = readAll();
  delete meta.hidden[dealId];
  writeAll(meta);
}

export function getDealNote(dealId: string): string {
  return readAll().notes[dealId] ?? "";
}

export function setDealNote(dealId: string, note: string): void {
  const meta = readAll();
  if (note.trim().length === 0) {
    delete meta.notes[dealId];
  } else {
    meta.notes[dealId] = note;
  }
  writeAll(meta);
}

export function listHiddenDealIds(): string[] {
  return Object.keys(readAll().hidden);
}

export function getCachedDealTitle(dealId: string): string | null {
  return readAll().titles[dealId] ?? null;
}

export function setCachedDealTitle(dealId: string, title: string): void {
  const meta = readAll();
  meta.titles[dealId] = title;
  writeAll(meta);
}
