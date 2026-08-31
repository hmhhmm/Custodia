// Owner: Person 1 (Move/contracts), designed against Person 3's proposed shape
// in frontend/src/verification/proof.ts — needs their sign-off.
//
// DealProof is the on-chain object `Deal.proof_ref` points at. Before this
// module existed, `mark_delivered` took a bare `ID` that nothing validated: a
// specialist could point it at another deal's proof, at a random shared
// object, at the Deal's own ID, or at an ID that will never exist. The
// `proof_ref.is_some()` check in `verify_and_release` was satisfied by any of
// those, so it verified nothing.
//
// Two bindings close that, and they live in `deal::mark_delivered`:
//   * `proof.deal_id == object::id(deal)`  — no reusing one proof across many
//     deals, which otherwise let a specialist do the work once and cite it to
//     N different clients.
//   * `proof.created_by == specialist.owner()` — no replaying a third party's
//     genuine, high-quality attestation as your own.
module escrow::proof;

use std::string::String;
use sui::clock::Clock;
use sui::event;

/// Bump when the meaning of `extra` changes. Consumers MUST check this before
/// interpreting `extra`.
const PROOF_FORMAT_VERSION: u16 = 1;

#[error]
const EEmptyStorageId: vector<u8> = b"Proof must reference a stored artifact";

/// How the attestation over the referenced artifact was produced.
///
/// This is an ENUM rather than an `attestation_mocked: bool`, and that choice
/// is the whole point of /CLAUDE.md rule 6 ("say explicitly when something is
/// simulated vs. real"). A bool defaults to `false` and every consumer can
/// silently ignore it. A variant forces every `match` to name the simulated
/// case — and, more importantly, there is NO CONSTRUCTOR for `Enclave`
/// anywhere in this package, so an on-chain proof claiming a real enclave
/// attestation is currently UNCONSTRUCTIBLE. That is a guarantee the chain
/// enforces, not a promise to set a flag honestly.
public enum AttestationKind has copy, drop, store {
    /// No attestation. The artifact is stored; nothing vouches for it.
    None,
    /// Produced by a labeled simulation — see
    /// frontend/src/verification/nautilus.mock.ts. This is NOT a TEE.
    /// `simulator` records which simulation produced it.
    Simulated { simulator: String },
    /// Produced by a real enclave whose measurement is registered on-chain.
    ///
    /// DELIBERATELY UNREACHABLE — no constructor exists, by design.
    /// VERIFY before adding one: whether Nautilus exposes a PCR-measurement
    /// registry, and whether an AWS certificate chain can actually be verified
    /// on-chain in Move against it. No installed skill covers Nautilus, so
    /// nothing about its API is assumed here.
    /// See https://docs.sui.io/concepts/cryptography/nautilus
    Enclave { measurement: vector<u8> },
}

public struct DealProof has key, store {
    id: UID,
    format_version: u16,
    deal_id: ID,
    /// Names the storage system, so moving off Walrus later does not require a
    /// new object type. e.g. b"walrus/testnet".
    storage_scheme: String,
    /// The Walrus blob ID, as a String — the shape the `accessing-data` skill
    /// documents for storing a blob reference in a Move object.
    storage_id: String,
    attestation: AttestationKind,
    attestation_id: String,
    /// Versioned by `format_version`. Anything not yet designed goes HERE
    /// rather than forcing a new struct type after publish, because struct
    /// fields freeze at publish and Person 3's format is not final.
    extra: vector<u8>,
    created_by: address,
    created_at_ms: u64,
}

public struct ProofCreated has copy, drop {
    proof_id: ID,
    deal_id: ID,
    created_by: address,
    simulated: bool,
}

/// A proof carrying a SIMULATED attestation. This is the constructor the demo
/// uses, and the resulting object says so permanently and on-chain.
public fun new_simulated(
    deal_id: ID,
    storage_scheme: String,
    storage_id: String,
    attestation_id: String,
    simulator: String,
    extra: vector<u8>,
    clock: &Clock,
    ctx: &mut TxContext,
): DealProof {
    new_internal(
        deal_id,
        storage_scheme,
        storage_id,
        AttestationKind::Simulated { simulator },
        attestation_id,
        extra,
        clock,
        ctx,
    )
}

/// A proof with no attestation at all — the artifact is stored, nothing
/// vouches for it. Honest for a Walrus-only flow with no Nautilus step.
public fun new_unattested(
    deal_id: ID,
    storage_scheme: String,
    storage_id: String,
    extra: vector<u8>,
    clock: &Clock,
    ctx: &mut TxContext,
): DealProof {
    new_internal(
        deal_id,
        storage_scheme,
        storage_id,
        AttestationKind::None,
        b"".to_string(),
        extra,
        clock,
        ctx,
    )
}

// NO `new_enclave`. See AttestationKind::Enclave.

fun new_internal(
    deal_id: ID,
    storage_scheme: String,
    storage_id: String,
    attestation: AttestationKind,
    attestation_id: String,
    extra: vector<u8>,
    clock: &Clock,
    ctx: &mut TxContext,
): DealProof {
    assert!(!storage_id.is_empty(), EEmptyStorageId);

    let proof = DealProof {
        id: object::new(ctx),
        format_version: PROOF_FORMAT_VERSION,
        deal_id,
        storage_scheme,
        storage_id,
        attestation,
        attestation_id,
        extra,
        created_by: ctx.sender(),
        created_at_ms: clock.timestamp_ms(),
    };

    event::emit(ProofCreated {
        proof_id: object::id(&proof),
        deal_id,
        created_by: proof.created_by,
        simulated: proof.is_simulated(),
    });

    proof
}

/// Consume path. A `DealProof` is write-once reference data: this module
/// deliberately exposes NO function that mutates one, so once created it can
/// never change, and the specialist cannot alter a proof after the client has
/// begun reviewing it.
///
/// Freezing would be the more precise expression of that (frozen objects also
/// skip consensus, so reads are cheaper). It is not used because
/// `transfer::public_freeze_object` on this type triggers a compiler ICE in
/// Sui 1.78.1 — "ICE should have failed in naming" — which reproduces on a
/// minimal module and disappears if the call is swapped for
/// `public_share_object`. Suppressing `lint(freeze_wrapped)` reduces but does
/// not eliminate the panic, so the lint is only part of it.
///
/// Sharing is behaviourally equivalent here precisely BECAUSE there are no
/// mutators. If a future version adds one, this must become a freeze, or a
/// shared proof becomes mutable-by-anyone.
/// VERIFY on the next toolchain bump whether the freeze path compiles again.
public fun share_proof(proof: DealProof) {
    transfer::public_share_object(proof);
}

public fun deal_id(proof: &DealProof): ID {
    proof.deal_id
}

public fun created_by(proof: &DealProof): address {
    proof.created_by
}

public fun attestation(proof: &DealProof): AttestationKind {
    proof.attestation
}

/// Convenience for Person 4's "simulated" badge. Never let a simulated
/// attestation render indistinguishably from a real one.
public fun is_simulated(proof: &DealProof): bool {
    match (&proof.attestation) {
        AttestationKind::Simulated { simulator: _ } => true,
        AttestationKind::None => false,
        AttestationKind::Enclave { measurement: _ } => false,
    }
}

public fun storage_scheme(proof: &DealProof): String {
    proof.storage_scheme
}

public fun storage_id(proof: &DealProof): String {
    proof.storage_id
}

public fun attestation_id(proof: &DealProof): String {
    proof.attestation_id
}

public fun format_version(proof: &DealProof): u16 {
    proof.format_version
}

public fun created_at_ms(proof: &DealProof): u64 {
    proof.created_at_ms
}
