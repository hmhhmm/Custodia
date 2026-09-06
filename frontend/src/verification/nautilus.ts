// =============================================================================
// SIMULATED / MOCKED — this file does NOT talk to real Nautilus infrastructure.
// =============================================================================
//
// This is the primary deliverable for Nautilus in this hackathon, not a
// last-resort fallback. Real Nautilus requires standing up an actual AWS
// Nitro Enclave (or Marlin Oyster for Dockerized deployment), registering
// the enclave's PCR measurements via a Move contract, and having a Move
// contract verify the AWS certificate chain + attestation on-chain before
// accepting the enclave's signed output. See:
//   https://docs.sui.io/concepts/cryptography/nautilus
//   https://docs.sui.io/concepts/cryptography/nautilus/nautilus-design
// Mysten Labs' own reproducible-build template is explicitly described as
// not feature-complete and not security-audited. Attempting real enclave
// deployment in a hackathon window is a genuine infrastructure project on
// its own — only pursue it as a stretch goal if a team member has prior
// hands-on AWS Nitro Enclave / TEE experience, and only after everything
// below is working end-to-end with the mock.
//
// This module's return shape is designed as a drop-in replacement for what
// a real Nautilus attestation reference would look like structurally, so
// swapping in a real implementation later should not require changing
// Deal.proof_ref's format — see sui/ptb-deliver.ts, which writes this
// attestation's id into the on-chain DealProof.

export interface MockAttestation {
  attestationId: string;
  taskId: string;
  resultHash: string;
  timestamp: string;
  verified: true;
  /** Always true. Never omit or rename this field — every consumer of a
   * MockAttestation (UI, logs) must check it and render/label the result
   * as simulated. */
  mocked: true;
}

async function sha256Hex(data: Uint8Array): Promise<string> {
  // Copy into a plain ArrayBuffer-backed Uint8Array — SubtleCrypto's
  // BufferSource type rejects a Uint8Array typed over
  // ArrayBufferLike/SharedArrayBuffer under newer DOM lib typings.
  const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(data));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * SIMULATED verification — computes a hash of the result data and wraps it
 * in a mock attestation reference. Does not involve any enclave, does not
 * prove anything about how resultData was produced, and must never be
 * presented to a user as equivalent to a real attestation.
 *
 * Any UI displaying this MUST show text such as:
 *   "Verification: simulated for demo — see README for real Nautilus
 *   integration path."
 */
export async function mockNautilusAttest(
  taskId: string,
  resultData: Uint8Array,
): Promise<MockAttestation> {
  const resultHash = await sha256Hex(resultData);

  return {
    attestationId: `mock-attest-${crypto.randomUUID()}`,
    taskId,
    resultHash,
    timestamp: new Date().toISOString(),
    verified: true,
    mocked: true,
  };
}
