// Owner: Person 3 (verification/storage).
// STATUS: stub only — no working logic yet.
//
// Walrus SDK calls: stores delivered-work artifacts (or references to
// them) as blobs, producing a blob ID used as Deal.proof_ref material.
// VERIFY exact Walrus SDK/HTTP API (publisher/aggregator endpoints,
// upload/read function names) against current Walrus docs before
// implementing — do not hardcode a publisher URL from memory.

// TODO: export async function uploadProofArtifact(data: Uint8Array): Promise<{ blobId: string }>
// TODO: export async function readProofArtifact(blobId: string): Promise<Uint8Array>

// NOTE: if a standalone Node service turns out cleaner for these calls
// than running them in the browser (e.g. to keep publisher credentials
// server-side), propose moving this to a new /services/verification
// package and update pnpm-workspace.yaml + /docs/ARCHITECTURE.md
// accordingly — flag this decision to the team rather than doing it
// silently.
