// Owner: Person 2 (transaction layer).
// STATUS: stub only — no working logic yet.
//
// PTB #2: verify-and-release-and-update-reputation. Builds a Programmable
// Transaction Block that: confirms delivered work was verified (proof_ref
// set via Person 3's verification flow), releases escrowed funds to the
// specialist agent, and updates both agents' Reputation objects.
//
// TBD — fill in exact Move function names/argument order once Person 1
// deploys escrow::deal and escrow::reputation to testnet. Do not guess
// them here.

// TODO: export function buildVerifyAndReleaseTx(params: {
//   dealId: string;
//   clientReputationId: string;
//   specialistReputationId: string;
// }): Transaction
//   VERIFY: current PTB builder API against the Sui TypeScript SDK docs
//   before implementing.
