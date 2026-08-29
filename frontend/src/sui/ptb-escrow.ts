// Owner: Person 2 (transaction layer).
// STATUS: stub only — no working logic yet.
//
// PTB #1: lock-escrow-and-create-deal. Builds a Programmable Transaction
// Block that: checks the caller's Mandate, locks payment into escrow, and
// creates a Deal object. See /docs/ARCHITECTURE.md for the sequence this
// fits into.
//
// TBD — fill in exact Move function names/argument order once Person 1
// deploys warrant::deal and warrant::mandate to testnet. Do not guess
// them here.

// TODO: export function buildLockEscrowAndCreateDealTx(params: {
//   clientAgentId: string;
//   specialistAgentId: string;
//   mandateId: string;
//   amount: bigint;
// }): Transaction
//   VERIFY: current PTB builder API (e.g. `Transaction` class name/import
//   path) against the Sui TypeScript SDK docs before implementing.
