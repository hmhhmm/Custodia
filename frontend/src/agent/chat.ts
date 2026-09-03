// General-purpose chat with a single tool: start_deal. Every message goes
// to Gemini first — most replies are conversational, but when the model
// judges a message describes a real task (something needing a specialist,
// escrow, and verification — the categories in mandate.move's
// allowed_categories), it calls start_deal instead of replying in text.
//
// Function-calling shape (tools/functionDeclarations/functionCall/
// functionResponse) and inline file attachments (inlineData/mimeType/data)
// verified against https://ai.google.dev/api/generate-content this
// session — see the tools array and toGeminiContents below. Field casing
// is camelCase throughout (systemInstruction, functionDeclarations,
// inlineData) — official docs describe the REST surface as snake_case,
// but this codebase's own working calls (system prompt + function-calling
// both demonstrably correct in testing) prove Gemini's endpoint accepts
// camelCase too, so inlineData follows the same convention rather than
// mixing the two within one request body.
//
// CATEGORY LIST IS NOT ARBITRARY — same constraint as llm.ts's
// interpretGoal: must match Onboarding.tsx's Mandate allowedCategories.

const GEMINI_API_KEY: string | undefined = import.meta.env.VITE_GEMINI_API_KEY;
const GEMINI_MODEL = "gemini-3.7-flash";
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

const SYSTEM_INSTRUCTION = `You are Envoy, the personal assistant inside Custodia — an on-chain trust and settlement layer on Sui. You can have a normal conversation about anything, the same as any capable AI assistant.

When a message describes something the user actually needs DONE by a specialist — legal review, courier/delivery, translation, logistics, design work, or research — and real payment should be held in escrow until it's verified, call start_deal instead of replying in text. Only call start_deal for genuine tasks with real stakes, never for hypothetical questions, small talk, or requests to explain how Custodia works.

For everything else — questions, chat, requests to explain something, brainstorming — just reply normally in text.`;

const TOOLS = [
  {
    functionDeclarations: [
      {
        name: "start_deal",
        description:
          "Starts a real on-chain deal: Envoy finds a specialist agent, locks payment in escrow, and pays out once the work is verified.",
        parameters: {
          type: "object",
          properties: {
            task: {
              type: "string",
              description: "The user's task, restated clearly enough for a specialist-matching search.",
            },
          },
          required: ["task"],
        },
      },
    ],
  },
];

export type ChatRole = "user" | "assistant";

export interface ChatAttachment {
  /** e.g. "image/png", "application/pdf" — passed straight through as
   * inlineData.mimeType. */
  mimeType: string;
  /** Base64-encoded file content, no data: URL prefix. */
  data: string;
  name: string;
}

export interface ChatMessage {
  role: ChatRole;
  text: string;
  attachment?: ChatAttachment;
}

export type ChatTurnResult =
  | { kind: "reply"; text: string }
  | { kind: "start_deal"; task: string };

interface GeminiPart {
  text?: string;
  functionCall?: { name: string; args: Record<string, unknown> };
  inlineData?: { mimeType: string; data: string };
}

function toGeminiContents(history: ChatMessage[]): { role: "user" | "model"; parts: GeminiPart[] }[] {
  return history.map((m) => {
    const parts: GeminiPart[] = [{ text: m.text }];
    if (m.attachment) {
      parts.push({ inlineData: { mimeType: m.attachment.mimeType, data: m.attachment.data } });
    }
    return { role: m.role === "user" ? "user" : "model", parts };
  });
}

/**
 * Sends the full conversation to Gemini and returns either a plain-text
 * reply or a start_deal tool call. Does not execute the deal itself — the
 * caller (ChatPanel.tsx) is responsible for invoking runOrchestratedDeal
 * and feeding progress back into the chat.
 */
export async function sendChatTurn(history: ChatMessage[]): Promise<ChatTurnResult> {
  if (!GEMINI_API_KEY) {
    throw new Error(
      "sendChatTurn: VITE_GEMINI_API_KEY is not set — add it to frontend/.env (see frontend/.env for the placeholder).",
    );
  }

  const response = await fetch(`${GEMINI_ENDPOINT}?key=${GEMINI_API_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
      contents: toGeminiContents(history),
      tools: TOOLS,
    }),
  });

  if (!response.ok) {
    throw new Error(`Gemini API returned ${response.status}: ${await response.text()}`);
  }

  const result = await response.json();
  const parts: GeminiPart[] | undefined = result?.candidates?.[0]?.content?.parts;
  if (!parts || parts.length === 0) {
    throw new Error("Gemini API response did not contain the expected candidates[0].content.parts field.");
  }

  const functionCall = parts.find((p) => p.functionCall)?.functionCall;
  if (functionCall?.name === "start_deal") {
    const task = functionCall.args?.task;
    if (typeof task !== "string" || task.trim().length === 0) {
      throw new Error(`start_deal was called without a valid "task" argument: ${JSON.stringify(functionCall.args)}`);
    }
    return { kind: "start_deal", task };
  }

  const text = parts.find((p) => p.text)?.text;
  if (!text) {
    throw new Error(`Gemini response contained neither a start_deal call nor text: ${JSON.stringify(parts)}`);
  }
  return { kind: "reply", text };
}
