// Owner: Person 3 (verification/storage).
// STATUS: stub only — HIGHEST RISK item in the project. No working logic
// yet, and a mocked fallback is REQUIRED per /CLAUDE.md rule 6 if the real
// integration isn't reliable in time for the demo.
//
// Nautilus attestation flow: produces a verifiable attestation that
// delivered work matches what was promised, feeding Deal.proof_ref.
// VERIFY exact Nautilus API/attestation format against current Sui/Mysten
// Nautilus docs before implementing — this is new enough that guessing is
// especially likely to be wrong.

// TODO: export async function requestAttestation(params: {
//   dealId: string;
//   artifactBlobId: string;
// }): Promise<{ attestationId: string }>

// TODO: export async function verifyAttestation(attestationId: string): Promise<boolean>

// TODO: export async function mockAttestation(params: {
//   dealId: string;
//   artifactBlobId: string;
// }): Promise<{ attestationId: string }>
//   Simulated fallback. Must be clearly labeled as simulated wherever it
//   is used (UI copy, commit messages) per /CLAUDE.md rule 6 — never let
//   it look indistinguishable from a real attestation in the demo.
