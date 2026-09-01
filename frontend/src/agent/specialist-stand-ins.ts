// Owner: Person 4 (frontend + orchestration).
// STATUS: real implementation — these are genuinely-callable functions
// (not stubs), but their OUTPUT is deliberately scripted/simulated,
// clearly labeled as such, since there is no real autonomous specialist
// agent running in this hackathon build. Do not confuse "scripted" with
// "not implemented" — every function here is a real, working function
// that a caller can invoke and get a real return value from; it is the
// simulated persona's content that is fake, not the code.
//
// Three stand-ins, matching the "legal-review" / "courier" categories
// this app's Mandate/LLM layer actually uses (see llm.ts's
// ALLOWED_CATEGORIES) plus a general-purpose fallback, so every category
// interpretGoal() can emit has a matching specialist.

export interface SpecialistPersona {
  suinsName: string;
  category: string;
}

export interface SpecialistReply {
  persona: SpecialistPersona;
  message: string;
  /** Always true — see file header. Every consumer must surface this,
   * matching the same honesty convention as MockAttestation.mocked. */
  scripted: true;
}

export interface SpecialistDeliverable {
  persona: SpecialistPersona;
  content: string;
  scripted: true;
}

const PERSONAS: Record<string, SpecialistPersona> = {
  "legal-review": { suinsName: "legal-review.sui", category: "legal-review" },
  courier: { suinsName: "courier-dispatch.sui", category: "courier" },
  general: { suinsName: "general-assist.sui", category: "general" },
};

function personaFor(category: string): SpecialistPersona {
  return PERSONAS[category] ?? PERSONAS.general;
}

/**
 * Simulates a specialist agent's negotiation reply to a goal. Scripted:
 * the content is a template, not a real agent's actual response.
 */
export function scriptedSpecialistReply(goal: string, category: string): SpecialistReply {
  const persona = personaFor(category);
  return {
    persona,
    message: `${persona.suinsName} can take this on: "${goal}". Proposing standard terms — payment held in escrow until delivery is verified.`,
    scripted: true,
  };
}

/**
 * Simulates a specialist agent completing the work and returning a
 * deliverable. Scripted: the content is template text describing what a
 * real deliverable would contain, not actual completed work.
 */
export function scriptedDeliverable(goal: string, category: string): SpecialistDeliverable {
  const persona = personaFor(category);
  const templates: Record<string, string> = {
    "legal-review": `Reviewed: "${goal}". Findings: no unusual liability clauses identified; standard termination and indemnity language present. Recommend proceeding with minor clarification on the payment-terms section.`,
    courier: `Completed: "${goal}". Pickup and delivery confirmed, proof of delivery attached, delivered within the agreed window.`,
    general: `Completed: "${goal}". Work delivered as scoped.`,
  };
  return {
    persona,
    content: templates[category] ?? templates.general,
    scripted: true,
  };
}
