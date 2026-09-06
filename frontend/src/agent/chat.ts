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
// start_deal_chain's `category` enum below imports MANDATE_CATEGORIES
// directly rather than re-listing it, so the two can never drift the way
// this project has already been bitten by once (see llm.ts's own header
// note on the same constraint).

import { MANDATE_CATEGORIES } from "../app/Onboarding";

const GEMINI_API_KEY: string | undefined = import.meta.env.VITE_GEMINI_API_KEY;
const GEMINI_MODEL = "gemini-3.7-flash";
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

const SYSTEM_INSTRUCTION = `You are Envoy, the personal assistant inside Custodia — an on-chain trust and settlement layer on Sui. You can have a normal conversation about anything, the same as any capable AI assistant.

When a message describes something the user actually needs DONE by a specialist — legal review, courier/delivery, translation, logistics, design work, or research — and real payment should be held in escrow until it's verified, call start_deal instead of replying in text. Only call start_deal for genuine tasks with real stakes, never for hypothetical questions, small talk, or requests to explain how Custodia works.

Before calling start_deal or start_deal_chain, act like a professional operations assistant, not a form-filler: if the task as described is genuinely ambiguous in a way that would materially change what gets escrowed or who gets matched — e.g. no indication of scope/urgency/budget expectations, or the request could reasonably mean two different things — ask ONE concise clarifying question in plain text instead of calling start_deal immediately. Once the user replies, use their answer (plus the rest of the conversation) to call start_deal. Do not ask a clarifying question if the task is already reasonably clear — most real requests are; over-asking is as unprofessional as under-asking.

For any task involving a PHYSICAL item a specialist will actually handle, inspect, repair, or deliver (a device, a package, a document, anything physically real) — always confirm you have enough concrete detail for a specialist to act on without guessing, before calling start_deal or start_deal_chain: what the item specifically is (make/model if it's a device, or a clear description otherwise), and, for any leg that involves physical pickup or delivery, the actual address/location and a way to reach the person there. If any of this is missing from what the user already said, ask for it in ONE combined clarifying question rather than proceeding with vague placeholders like "the laptop" or "the item" — a specialist receiving a task description with no real specifics cannot actually do the work. Once you have real specifics, weave them into a proper written brief (see taskDescription below), not just a restated one-liner.

Some requests genuinely need MULTIPLE different specialists working in sequence, where a later phase cannot even begin until an earlier phase's real work is done — for example "pick up my broken laptop, get it repaired, and send it back" needs a logistics specialist for pickup, then a separate repair specialist, then a courier for return, in that order, each waiting on the last. For a request like that, call start_deal_chain instead of start_deal, with 2-3 ordered legs (each its own category and task description). Only use start_deal_chain when the phases are truly sequential and handled by genuinely different kinds of specialists — do not use it for a task one specialist could do in a single engagement, even if it has multiple steps; that is still start_deal.

Each leg's category must be chosen carefully — the allowed categories are legal-review, courier, translation, logistics, design, research, and there is deliberately no "repair" category. A physical pickup or drop-off leg (collecting an item, delivering it somewhere) is logistics; a courier leg is specifically the FINAL return-delivery step back to the original requester; any leg where a specialist inspects, diagnoses, fixes, or repairs a physical item (e.g. "repair the laptop screen", "fix the appliance") is research, since that is the closest category to hands-on diagnostic/repair work, NOT logistics — logistics is for movement of the item, not work performed on it. Getting this wrong sends the deal to the wrong kind of specialist entirely.

Specialist selection is driven entirely by real on-chain reputation, not by you: for each deal, Envoy queries every specialist registered on-chain under that leg's category and picks the single highest-reputation-score candidate — there is no negotiation and no manual choice on your part. A specialist's reputation score is itself real on-chain history (a count of completed vs. disputed deals), not a static rating — completing this deal successfully raises the specialist's score for future selections, and both the client's and the specialist's reputation update atomically in the same transaction that releases payment. If the user asks why a particular specialist was picked, how specialists are ranked, or what happens to reputation after a deal completes, answer plainly from these real mechanics — never invent a scoring detail you're not sure of.

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
              description:
                "A real written brief the specialist will receive as their actual work order — not a one-line restatement. Include every concrete detail already known: what the item/task specifically is (make/model for a device, exact document/subject for legal or translation work, etc.), the location/address for any physical pickup or delivery, and any other specifics the user gave. Write it as a specialist would expect to read it, e.g. 'Pick up a MacBook Pro 14-inch (cracked screen) from 123 Example St, Apt 4B — contact John at +1-555-0100 — and deliver it to the repair specialist.' Never use vague placeholders like 'the laptop' or 'the item' when the user has already given specifics.",
            },
          },
          required: ["task"],
        },
      },
      {
        name: "start_deal_chain",
        description:
          "Starts a SEQUENCE of 2-3 real on-chain deals for a task with genuinely separate sequential phases handled by DIFFERENT specialists, where each phase can only begin once the prior phase's delivery proof exists on-chain (e.g. pick up an item, then repair it, then return it). Do not use this for a single-phase task, even a multi-step one a single specialist could handle — call start_deal instead.",
        parameters: {
          type: "object",
          properties: {
            legs: {
              type: "array",
              minItems: 2,
              maxItems: 3,
              items: {
                type: "object",
                properties: {
                  category: {
                    type: "string",
                    enum: [...MANDATE_CATEGORIES],
                    description: "Must be exactly one of the allowed Mandate categories.",
                  },
                  taskDescription: {
                    type: "string",
                    description:
                      "This leg's real written brief — the specific specialist for this leg will receive exactly this text as their work order, not a one-line restatement. Include every concrete detail already known and relevant to THIS leg: what the item specifically is (make/model for a device, etc.), the location/address for a pickup or delivery leg, and any other specifics the user gave. Never use vague placeholders like 'the laptop' or 'the item' when the user has already given specifics — e.g. for a pickup leg: 'Pick up a MacBook Pro 14-inch (cracked screen) from 123 Example St, Apt 4B — contact John at +1-555-0100.'",
                  },
                },
                required: ["category", "taskDescription"],
              },
              description: "The ordered legs, in the order they must be performed.",
            },
          },
          required: ["legs"],
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

export interface ChatChainLeg {
  category: (typeof MANDATE_CATEGORIES)[number];
  taskDescription: string;
}

export type ChatTurnResult =
  | { kind: "reply"; text: string }
  | { kind: "start_deal"; task: string }
  | { kind: "start_deal_chain"; legs: ChatChainLeg[] };

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
 * caller (ChatPanel.tsx) is responsible for invoking createDealAndEscrow
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

  if (functionCall?.name === "start_deal_chain") {
    const rawLegs = functionCall.args?.legs;
    if (!Array.isArray(rawLegs) || rawLegs.length < 2 || rawLegs.length > 3) {
      throw new Error(`start_deal_chain was called with an invalid "legs" argument: ${JSON.stringify(functionCall.args)}`);
    }
    // Re-validate against MANDATE_CATEGORIES even though the tool schema
    // already constrains it via `enum` — the schema is a hint to Gemini,
    // not an enforced contract, same reasoning as interpretGoal's own
    // hard clamp on maxBudget after asking nicely in the prompt.
    const legs: ChatChainLeg[] = rawLegs.map((raw, i) => {
      const category = (raw as Record<string, unknown>)?.category;
      const taskDescription = (raw as Record<string, unknown>)?.taskDescription;
      if (
        typeof category !== "string" ||
        !MANDATE_CATEGORIES.includes(category as (typeof MANDATE_CATEGORIES)[number]) ||
        typeof taskDescription !== "string" ||
        taskDescription.trim().length === 0
      ) {
        throw new Error(`start_deal_chain leg ${i} did not match the expected shape: ${JSON.stringify(raw)}`);
      }
      return { category: category as (typeof MANDATE_CATEGORIES)[number], taskDescription };
    });
    return { kind: "start_deal_chain", legs };
  }

  const text = parts.find((p) => p.text)?.text;
  if (!text) {
    throw new Error(`Gemini response contained neither a start_deal call nor text: ${JSON.stringify(parts)}`);
  }
  return { kind: "reply", text };
}
