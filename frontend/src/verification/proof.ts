// Owner: Person 3 (verification/storage).
// STATUS: PROPOSED — confirm with Person 1.
//
// /docs/ARCHITECTURE.md's "TBD — fill in once Person 1 deploys" section
// does not yet specify what Deal.proof_ref (currently `Option<ID>` in
// /move/sources/deal.move) should point at. Rather than guess, this file
// proposes a format and flags it for confirmation.
//
// PROPOSED format: proof_ref should point at an on-chain `DealProof`
// object (not encode data directly in the ID) containing:
//   - walrus_blob_id: String       (from walrus.ts storeBlob)
//   - attestation_id: String       (from nautilus.mock.ts, or real
//                                    Nautilus once/if built)
//   - attestation_mocked: bool     (mirrors MockAttestation.mocked —
//                                    MUST be carried on-chain so a client
//                                    reading a Deal can tell a real
//                                    attestation from a simulated one,
//                                    not just infer it from off-chain data)
// This keeps proof_ref as a small on-chain ID (cheap, matches Sui's
// object-reference conventions) while the actual artifact stays off-chain
// in Walrus, consistent with how the rest of the project uses Walrus.
//
// ALTERNATIVE considered: encode blobId + attestationId as a
// delimited String directly and skip the extra object. Rejected here
// because Deal.proof_ref is typed as Option<ID>, not Option<String>, in
// the current (also-PROPOSED) Deal struct — if Person 1 changes proof_ref
// to a String, this file's `buildProofPointer` return shape changes too.
// Flag this dependency when confirming with Person 1.

import type { MockAttestation } from "./nautilus.mock";

export interface ProofPointer {
  walrusBlobId: string;
  attestationId: string;
  attestationMocked: boolean;
}

/**
 * Shapes verification outputs into the PROPOSED proof_ref pointer format.
 * Does NOT itself submit a transaction — that belongs in Person 2's
 * frontend/src/sui/ptb-release.ts once escrow::deal::mark_delivered's
 * exact argument order is confirmed (see /docs/ARCHITECTURE.md TBD list).
 */
export function buildProofPointer(
  walrusBlobId: string,
  attestation: MockAttestation,
): ProofPointer {
  return {
    walrusBlobId,
    attestationId: attestation.attestationId,
    attestationMocked: attestation.mocked,
  };
}

/**
 * TODO: once escrow::deal::mark_delivered and a proof-object-creation
 * function (if Person 1 adds one — see PROPOSED format above) are
 * deployed, implement:
 *
 *   export async function attachProofToDeal(
 *     dealId: string,
 *     proof: ProofPointer,
 *   ): Promise<{ txDigest: string }>
 *
 * This will hand off to Person 2's PTB layer rather than building a
 * transaction directly here — confirm that division of responsibility
 * with Person 2 before implementing, since ptb-release.ts is explicitly
 * their owned file per /docs/ARCHITECTURE.md.
 */
