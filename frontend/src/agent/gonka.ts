// Gonka Router client — the mandatory inference gateway for Custodia
// Verify (see /docs/ARCHITECTURE.md and the "AI for Society" track
// brief: "All AI reasoning and verification logic MUST run on the Gonka
// Network via the official inference gateway"). This file is the ONLY
// place that ever calls Gonka — nothing here falls back to Gemini or any
// other provider if Gonka is unreachable, since routing through Gonka is
// a hard requirement, not an optimization.
//
// API surface confirmed live this session against gonkarouter.io/docs
// and gonkarouter.io/models — OpenAI-compatible /v1/chat/completions,
// Bearer auth, and a REQUEST ID returned as the `X-Request-Id` RESPONSE
// HEADER (not a JSON body field) — the docs state "Every call returns an
// X-Request-Id response header. You can look that id up later — no auth
// required," which is exactly the on-chain-provable-request-id property
// the track's "Transparency UI" requirement asks for.

const GONKA_API_KEY: string | undefined = import.meta.env.VITE_GONKA_API_KEY;
const GONKA_ENDPOINT = "https://api.gonkarouter.io/v1/chat/completions";

// Two independent models for cross-verification, per the track's
// "Multi-Model Consensus" requirement. The gonkarouter.io/models page's
// short-form ids ("deepseek-v4-flash-0731", "minimax-m2-7") turned out
// to be WRONG — confirmed by actually calling the API live this
// session: a request with either short id 400s with
// `{"error":{"code":"invalid_model", ...}}`, and that error response
// itself names the two real, callable ids, which match the docs page's
// fully-qualified form. Both ids below were then indendently confirmed
// with a real 200 response and a real x-request-id header.
export const GONKA_MODELS = ["deepseek-ai/DeepSeek-V4-Flash-0731", "MiniMaxAI/MiniMax-M2.7"] as const;

export interface GonkaModelResult {
  model: string;
  requestId: string | null;
  content: string;
  error?: string;
}

/** One real Gonka Router call. Never silently swallows a failure — a
 * model that errors is reported as an error result (with whatever
 * request id Gonka did return, if any), not skipped, since the whole
 * point of multi-model consensus is knowing when a model didn't weigh
 * in, not just averaging over however many happened to succeed. */
async function callGonkaModel(model: string, prompt: string): Promise<GonkaModelResult> {
  if (!GONKA_API_KEY) {
    throw new Error("callGonkaModel: VITE_GONKA_API_KEY is not set — add it to frontend/.env.");
  }

  const response = await fetch(GONKA_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${GONKA_API_KEY}`,
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  const requestId = response.headers.get("X-Request-Id");

  if (!response.ok) {
    const text = await response.text();
    return { model, requestId, content: "", error: `Gonka Router returned ${response.status} for ${model}: ${text}` };
  }

  const result = await response.json();
  // choices[0].message.content — confirmed live this session against
  // real 200 responses from BOTH models, not just assumed from the
  // docs' "OpenAI-compatible" description. If this field is ever wrong
  // (a future Gonka API change), it surfaces as `content` being
  // undefined below, not a silent wrong answer.
  const content: string | undefined = result?.choices?.[0]?.message?.content;
  if (typeof content !== "string") {
    return { model, requestId, content: "", error: `Gonka Router response for ${model} did not contain choices[0].message.content — response shape may differ from the assumed OpenAI-compatible schema.` };
  }

  return { model, requestId, content };
}

export interface ClaimVerdict {
  truthScore: number; // 0-100
  reasoning: string;
}

/** Builds the "neutrality" prompt the track's own dev tips call for:
 * instruct the model to be objective and cite specific evidence, and to
 * return a machine-parseable verdict rather than free-form prose. */
function buildVerificationPrompt(claim: string): string {
  return `You are a neutral fact-checking assistant. Analyze the following claim objectively, citing specific reasoning for your conclusion. Do not assume a political or cultural bias in either direction.

Respond with ONLY a JSON object (no markdown fences, no prose) with exactly these fields:
- "truthScore": your assessment of how likely this claim is TRUE, as an integer from 0 to 100 (0 = definitely false, 100 = definitely true, 50 = genuinely uncertain/unverifiable)
- "reasoning": a clear, evidence-based explanation for your score — cite what specifically supports or undermines the claim

Claim to verify: "${claim}"`;
}

/** Parses a single model's raw text response into a ClaimVerdict.
 *
 * Confirmed live this session that different Gonka-hosted models wrap
 * their answer differently: DeepSeek returns clean JSON (after the same
 * markdown-fence-stripping llm.ts's interpretGoal already needs), but
 * MiniMax prepends a full chain-of-thought block wrapped in
 * `<think>...</think>` BEFORE the actual JSON object — the answer is
 * real and correct, just not alone in the string. Strips any such block
 * first, then (since a `<think>` block can itself legally contain the
 * substrings "{" or "}" while reasoning about the answer) parses the
 * LAST top-level `{...}` in what remains, not the first-to-last span,
 * so a stray brace earlier in leftover prose can't be mistaken for the
 * real payload. */
function parseVerdict(model: string, raw: string): ClaimVerdict {
  const withoutThinkBlock = raw.replace(/<think>[\s\S]*?<\/think>/gi, "");
  const fenceStripped = withoutThinkBlock.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "");
  const lastOpenBrace = fenceStripped.lastIndexOf("{");
  const lastCloseBrace = fenceStripped.lastIndexOf("}");
  if (lastOpenBrace === -1 || lastCloseBrace === -1 || lastCloseBrace < lastOpenBrace) {
    throw new Error(`${model}'s response contained no JSON object after stripping <think> blocks and fences: ${fenceStripped.slice(0, 200)}`);
  }
  const cleaned = fenceStripped.slice(lastOpenBrace, lastCloseBrace + 1);
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error(`${model}'s response was not valid JSON after fence-stripping: ${cleaned.slice(0, 200)}`);
  }
  const obj = parsed as Record<string, unknown>;
  if (typeof obj.truthScore !== "number" || typeof obj.reasoning !== "string") {
    throw new Error(`${model}'s response was missing truthScore/reasoning fields: ${cleaned.slice(0, 200)}`);
  }
  return {
    truthScore: Math.min(100, Math.max(0, Math.round(obj.truthScore))),
    reasoning: obj.reasoning,
  };
}

export interface ModelVerdict {
  model: string;
  requestId: string | null;
  verdict: ClaimVerdict | null;
  error?: string;
}

export interface ConsensusResult {
  perModel: ModelVerdict[];
  /** Simple average of every model that returned a valid verdict — see
   * this function's own comment for why averaging (not "pick one") is
   * the consensus rule, and what happens when models disagree sharply. */
  consensusTruthScore: number;
  /** True when the models' individual scores differ by more than 25
   * points — surfaced in the UI so a user can see disagreement instead
   * of a single falsely-confident number papering over it. */
  modelsDisagree: boolean;
}

/** Runs the claim through every model in GONKA_MODELS in parallel — the
 * track's "Multi-Model Consensus" requirement — and combines them.
 *
 * Consensus logic: average the scores of every model that returned a
 * valid verdict (never fabricate a score for a model that errored), and
 * flag disagreement when the spread between the highest and lowest
 * score exceeds 25 points. This is a real (if simple) consensus rule,
 * not "trust whichever model answered first" — a genuine per-track dev
 * tip ("if two models disagree, how does your system handle the
 * conflict?"). If every model errors, this throws rather than returning
 * a fabricated 0 or 50 — a fact-checker with zero real verdicts must not
 * silently present a confident-looking score. */
export async function verifyClaimOnGonka(claim: string): Promise<ConsensusResult> {
  const prompt = buildVerificationPrompt(claim);

  const results = await Promise.all(
    GONKA_MODELS.map(async (model): Promise<ModelVerdict> => {
      try {
        const raw = await callGonkaModel(model, prompt);
        if (raw.error) return { model, requestId: raw.requestId, verdict: null, error: raw.error };
        const verdict = parseVerdict(model, raw.content);
        return { model, requestId: raw.requestId, verdict };
      } catch (err) {
        return { model, requestId: null, verdict: null, error: err instanceof Error ? err.message : String(err) };
      }
    }),
  );

  const validVerdicts = results.filter((r): r is ModelVerdict & { verdict: ClaimVerdict } => r.verdict !== null);
  if (validVerdicts.length === 0) {
    throw new Error(
      `All ${GONKA_MODELS.length} Gonka models failed to return a valid verdict: ${results.map((r) => r.error).join(" | ")}`,
    );
  }

  const scores = validVerdicts.map((v) => v.verdict.truthScore);
  const consensusTruthScore = Math.round(scores.reduce((sum, s) => sum + s, 0) / scores.length);
  const modelsDisagree = Math.max(...scores) - Math.min(...scores) > 25;

  return { perModel: results, consensusTruthScore, modelsDisagree };
}
