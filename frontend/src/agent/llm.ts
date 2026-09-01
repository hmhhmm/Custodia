// Owner: Person 4 (frontend + orchestration).
// STATUS: real implementation against the Gemini REST API.
//
// Verified this session against https://ai.google.dev/api/generate-content
// and https://ai.google.dev/gemini-api/docs/models — confirmed the exact
// REST shape (POST .../v1beta/{model}:generateContent, body
// { contents: [{ parts: [{ text }] }] }) and the current model name
// (gemini-3.7-flash) against official docs, cross-checked across three
// separate fetches after one fetch returned an inconsistent/implausible
// endpoint shape on the first try — do not trust a single fetch for an
// API surface, especially one this easy to hallucinate plausibly.
//
// CATEGORY LIST IS NOT ARBITRARY: it must exact-match, case-sensitively,
// whatever a real on-chain Mandate's `allowed_categories` contains —
// `mandate::assert_within_mandate` aborts with ECategoryNotAllowed on any
// mismatch (verified against move/tests/mandate_tests.move, which uses
// "legal-review" and "courier"). The categories below match the demo
// Mandate's categories in demoStatusSequence.ts — if that list changes,
// this one must change with it, or every real PTB #1 call aborts.

const GEMINI_API_KEY: string | undefined = import.meta.env.VITE_GEMINI_API_KEY;
const GEMINI_MODEL = "gemini-3.7-flash";
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

const ALLOWED_CATEGORIES = ["legal-review", "courier"] as const;

export interface InterpretedGoal {
  category: (typeof ALLOWED_CATEGORIES)[number];
  maxBudget: number;
  description: string;
}

/**
 * Parses a plain-language goal into a structured task. Calls the real
 * Gemini API — requires VITE_GEMINI_API_KEY to be set (see frontend/.env,
 * gitignored; add your own key there, it is never committed).
 */
export async function interpretGoal(goal: string): Promise<InterpretedGoal> {
  if (!GEMINI_API_KEY) {
    throw new Error(
      "interpretGoal: VITE_GEMINI_API_KEY is not set — add it to frontend/.env (see frontend/.env for the placeholder).",
    );
  }

  const prompt = `You are a task classifier for an on-chain escrow system. Given a user's plain-language goal, respond with ONLY a JSON object (no markdown fences, no prose) with exactly these fields:
- "category": must be exactly one of ${JSON.stringify(ALLOWED_CATEGORIES)} — pick whichever fits best, even if imperfect
- "maxBudget": your best-guess reasonable budget in SUI as a plain number, based on the complexity implied by the goal
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
    !ALLOWED_CATEGORIES.includes(obj.category as (typeof ALLOWED_CATEGORIES)[number]) ||
    typeof obj.maxBudget !== "number" ||
    typeof obj.description !== "string"
  ) {
    throw new Error(`Gemini response did not match the expected shape: ${JSON.stringify(obj)}`);
  }

  return {
    category: obj.category as (typeof ALLOWED_CATEGORIES)[number],
    maxBudget: obj.maxBudget,
    description: obj.description,
  };
}
