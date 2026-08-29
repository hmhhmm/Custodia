// Owner: Person 2 (transaction layer).
// STATUS: stub only — no working logic yet.
//
// Enoki sponsored-transaction setup: lets users transact without holding
// SUI for gas. VERIFY exact @mysten/enoki API surface (client init,
// sponsor + execute flow) against current Mysten docs before implementing.

// TODO: export function createEnokiClient(apiKey: string): ...
//   VERIFY: exact client constructor name/signature.

// TODO: export async function sponsorAndExecute(txb: ..., ...): Promise<...>
//   Wraps a Programmable Transaction Block for sponsorship + execution.
//   Confirm with Person 4 what shape the txb arrives in from
//   src/agent before finalizing this signature.
