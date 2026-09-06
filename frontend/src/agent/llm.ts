// Parses a plain-language goal into a structured task via the Gemini REST
// API (POST .../v1beta/{model}:generateContent).
//
// CATEGORY LIST IS NOT ARBITRARY: it must exact-match, case-sensitively,
// whatever a real on-chain Mandate's `allowed_categories` contains —
// `mandate::assert_within_mandate` aborts with ECategoryNotAllowed on any
// mismatch. MANDATE_CATEGORIES is re-exported from Onboarding.tsx's own
// constant (not duplicated) so the two can never drift the way they once
// did (this list used to hardcode only 2 of the Mandate's 6 real allowed
// categories).

import { MANDATE_CATEGORIES } from "../app/Onboarding";

const GEMINI_API_KEY: string | undefined = import.meta.env.VITE_GEMINI_API_KEY;
const GEMINI_MODEL = "gemini-3.7-flash";
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

export interface InterpretedGoal {
  category: (typeof MANDATE_CATEGORIES)[number];
  maxBudget: number;
  description: string;
}

/**
 * Parses a plain-language goal into a structured task. Calls the real
 * Gemini API — requires VITE_GEMINI_API_KEY to be set (see frontend/.env,
 * gitignored; add your own key there, it is never committed).
 *
 * `maxBudgetSui` is a hard ceiling, not a hint the model can ignore: told
 * to Gemini in the prompt for a better first guess, then clamped in code
 * regardless of what it returns. Without this, Gemini guesses a
 * real-world-realistic fee (e.g. 5-50 SUI for a legal review) with no
 * awareness of the connected wallet's actual on-chain Mandate cap, and
 * `mandate::assert_within_mandate` aborts with ESpendLimitExceeded on
 * almost every real task.
 */
/**
 * `forcedCategory`: when set, this leg's category is ALREADY decided —
 * e.g. one leg of a multi-agent chain, where start_deal_chain (chat.ts)
 * already chose the category for this exact leg. Without this, each
 * leg's own taskDescription got re-classified independently here, and
 * Gemini could genuinely land on a DIFFERENT category than the one the
 * chain actually escrowed against — a real bug this session: a leg
 * whose task was literally "repair the laptop screen" got reclassified
 * as "logistics" on a later, independent call, so discoverAgents()
 * matched the wrong specialist type entirely. When forced, Gemini is
 * only asked for budget/description, and the RETURNED category is
 * discarded and replaced with forcedCategory regardless of what comes
 * back — the same "never trust the prompt alone" principle already
 * applied to the budget clamp below.
 */
export async function interpretGoal(
  goal: string,
  maxBudgetSui: number,
  forcedCategory?: (typeof MANDATE_CATEGORIES)[number],
): Promise<InterpretedGoal> {
  if (!GEMINI_API_KEY) {
    throw new Error(
      "interpretGoal: VITE_GEMINI_API_KEY is not set — add it to frontend/.env (see frontend/.env for the placeholder).",
    );
  }

  const prompt = forcedCategory
    ? `You are a task classifier for an on-chain escrow system. The category for this task is already fixed: "${forcedCategory}". Given a user's plain-language goal, respond with ONLY a JSON object (no markdown fences, no prose) with exactly these fields:
- "category": always exactly "${forcedCategory}" (already decided, just echo it back)
- "maxBudget": a SMALL, realistic testnet-demo budget in SUI as a plain number — think in the range of 0.01-0.2 SUI for a typical task, scaling only slightly for genuinely larger/more complex work. This is testnet play-money, not a real-world price estimate: do NOT scale your answer up just because a larger amount happens to be allowed. ${maxBudgetSui} SUI is ONLY an upper ceiling this account currently has room for — it is NOT a target, a suggestion, or a sign that a bigger number is expected; propose the smallest reasonable amount for the task first, and only approach ${maxBudgetSui} if the task is genuinely large in scope. Never return a number above ${maxBudgetSui}.
- "description": a one-sentence restatement of what the user needs, in plain language

User's goal: "${goal}"`
    : `You are a task classifier for an on-chain escrow system. Given a user's plain-language goal, respond with ONLY a JSON object (no markdown fences, no prose) with exactly these fields:
- "category": must be exactly one of ${JSON.stringify(MANDATE_CATEGORIES)} — pick whichever fits best, even if imperfect
- "maxBudget": a SMALL, realistic testnet-demo budget in SUI as a plain number — think in the range of 0.01-0.2 SUI for a typical task, scaling only slightly for genuinely larger/more complex work. This is testnet play-money, not a real-world price estimate: do NOT scale your answer up just because a larger amount happens to be allowed. ${maxBudgetSui} SUI is ONLY an upper ceiling this account currently has room for — it is NOT a target, a suggestion, or a sign that a bigger number is expected; propose the smallest reasonable amount for the task first, and only approach ${maxBudgetSui} if the task is genuinely large in scope. Never return a number above ${maxBudgetSui}.
- "description": a one-sentence restatement of what the user needs, in plain language

User's goal: "${goal}"`;

  const response = await fetch(`${GEMINI_ENDPOINT}?key=${GEMINI_API_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
    }),
  });

  if (!response.ok) {
    throw new Error(`Gemini API returned ${response.status}: ${await response.text()}`);
  }

  const result = await response.json();
  const text: string | undefined = result?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    throw new Error("Gemini API response did not contain the expected candidates[0].content.parts[0].text field — response shape may have changed.");
  }

  // Gemini sometimes wraps JSON in ```json fences despite being asked not
  // to — strip them defensively rather than letting JSON.parse throw on
  // well-formed-but-fenced output.
  const cleaned = text.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "");

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error(`Gemini response was not valid JSON after fence-stripping: ${cleaned.slice(0, 200)}`);
  }

  const obj = parsed as Record<string, unknown>;
  // When forced, obj.category is never trusted or even required to be
  // valid — forcedCategory is the single enforcement point regardless of
  // whatever Gemini echoed back, same "never trust the prompt alone"
  // principle as the hard maxBudget clamp below.
  if (
    (!forcedCategory &&
      (typeof obj.category !== "string" || !MANDATE_CATEGORIES.includes(obj.category as (typeof MANDATE_CATEGORIES)[number]))) ||
    typeof obj.maxBudget !== "number" ||
    typeof obj.description !== "string"
  ) {
    throw new Error(`Gemini response did not match the expected shape: ${JSON.stringify(obj)}`);
  }

  return {
    category: forcedCategory ?? (obj.category as (typeof MANDATE_CATEGORIES)[number]),
    // Hard clamp — the prompt asks Gemini to respect the cap, but nothing
    // stops it from ignoring that instruction, so this is the real
    // enforcement point. Math.min is applied LAST and outermost, so the
    // 0.000001 floor (keeps a 0-or-negative guess from producing a
    // zero-amount PTB — deal.move's EZeroAmount) can never push the
    // result above maxBudgetSui even when the ceiling itself is very
    // small — orchestrator.ts had exactly this bug the other way around
    // (a 0.01 floor on the ceiling, not the value, which raised the
    // ceiling above what was actually spendable).
    maxBudget: Math.min(Math.max(obj.maxBudget, 0.000001), maxBudgetSui),
    description: obj.description,
  };
}

/**
 * Turns a deal's raw category + escrowed amount into a short, human title
 * for the Deals tab card — e.g. "Rental Lease Review" instead of a bare
 * category tag + a wall of hex addresses. Falls back to the category
 * itself (still real, just less polished) if Gemini isn't reachable —
 * never blocks the card from rendering on a network hiccup.
 */
export async function summarizeDealTitle(category: string, amountSui: number): Promise<string> {
  if (!GEMINI_API_KEY) return category;

  const prompt = `Give a short, professional title (4-6 words, title case, no quotes, no trailing punctuation) for a paid task in the category "${category}" with a budget of ${amountSui} SUI. Respond with ONLY the title text, nothing else.`;

  try {
    const response = await fetch(`${GEMINI_ENDPOINT}?key=${GEMINI_API_KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
    });
    if (!response.ok) return category;

    const result = await response.json();
    const text: string | undefined = result?.candidates?.[0]?.content?.parts?.[0]?.text;
    const cleaned = text?.trim().replace(/^["']|["']$/g, "");
    return cleaned || category;
  } catch {
    return category;
  }
}

/**
 * Summarizes a real decrypted deliverable (deal proof text, e.g. a
 * specialist's pickup/repair/delivery notes) into one plain-language
 * paragraph for the client, posted back into chat once that leg of a
 * multi-agent chain releases — see chainAdvance.ts's
 * summarizeAndPostProof.
 *
 * Soft-degrading like summarizeDealTitle above, NOT a hard JSON contract
 * like interpretGoal: this is prose with no schema to violate, so a
 * failure here must never be presented as a summary — it falls back to
 * the raw deliverable text itself (truncated), never a fabricated
 * paraphrase, per this codebase's rule against ever making a simulated
 * or degraded result look indistinguishable from a real one.
 */
export async function summarizeProofContent(deliverableText: string, legDescription: string): Promise<string> {
  const RAW_FALLBACK_CHARS = 500;
  const rawFallback = () =>
    `${deliverableText.slice(0, RAW_FALLBACK_CHARS)}${deliverableText.length > RAW_FALLBACK_CHARS ? "…" : ""} (showing raw delivery notes — summarization unavailable)`;

  if (!GEMINI_API_KEY) return rawFallback();

  const prompt = `A specialist just completed and delivered this task: "${legDescription}". Their delivery notes are below. Write ONE short plain-language paragraph (2-3 sentences) telling the client what was done, in a professional but warm tone, as if reporting back after completing their job. Do not invent details not present in the notes. Respond with ONLY the paragraph, nothing else.

Delivery notes:
"""
${deliverableText}
"""`;

  try {
    const response = await fetch(`${GEMINI_ENDPOINT}?key=${GEMINI_API_KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
    });
    if (!response.ok) return rawFallback();

    const result = await response.json();
    const text: string | undefined = result?.candidates?.[0]?.content?.parts?.[0]?.text;
    const cleaned = text?.trim();
    return cleaned || rawFallback();
  } catch {
    return rawFallback();
  }
}
