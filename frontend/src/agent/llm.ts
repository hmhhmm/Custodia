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
export async function interpretGoal(goal: string, maxBudgetSui: number): Promise<InterpretedGoal> {
  if (!GEMINI_API_KEY) {
    throw new Error(
      "interpretGoal: VITE_GEMINI_API_KEY is not set — add it to frontend/.env (see frontend/.env for the placeholder).",
    );
  }

  const prompt = `You are a task classifier for an on-chain escrow system. Given a user's plain-language goal, respond with ONLY a JSON object (no markdown fences, no prose) with exactly these fields:
- "category": must be exactly one of ${JSON.stringify(MANDATE_CATEGORIES)} — pick whichever fits best, even if imperfect
- "maxBudget": your best-guess reasonable budget in SUI as a plain number. This is a testnet demo with a hard cap of ${maxBudgetSui} SUI total — never return a number above ${maxBudgetSui}, even if a real-world price for this task would normally be higher.
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
  if (
    typeof obj.category !== "string" ||
    !MANDATE_CATEGORIES.includes(obj.category as (typeof MANDATE_CATEGORIES)[number]) ||
    typeof obj.maxBudget !== "number" ||
    typeof obj.description !== "string"
  ) {
    throw new Error(`Gemini response did not match the expected shape: ${JSON.stringify(obj)}`);
  }

  return {
    category: obj.category as (typeof MANDATE_CATEGORIES)[number],
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
