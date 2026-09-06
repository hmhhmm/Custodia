// Custodia Verify's on-chain "Verifier" identity signing key. Deliberately
// the SAME keypair as specialist-signer.ts, not a new one — that file's
// original stand-in role (a demo specialist accepting/delivering deals)
// is orphaned in the main product now that real specialists use their
// own connected wallets (see /docs/ARCHITECTURE.md's wiring status), so
// this reuses that already-registered, already-funded testnet address
// for a real new purpose rather than minting a redundant throwaway key.
//
// factcheck.ts uses this keypair to sign BOTH sides of a fact-check
// Deal: Envoy's own key (envoy-signer.ts) already signs the client-side
// escrow lock; this key signs the specialist-side accept() and
// mark_delivered() calls, acting as the automated Gonka-backed
// verification service — NOT a second human party. deal.move does not
// forbid a Deal's client_agent and specialist_agent being controlled by
// the same address (confirmed by reading assert_within_mandate/accept/
// mark_delivered's own assertions — they check identity-ownership
// independently, with no cross-check that the two differ), so this is a
// real, structurally valid use of the existing contract, not a bypass —
// but it must always be presented plainly as "Envoy verifying its own
// automated fact-check work," never disguised as a peer marketplace
// match between two independent parties.
//
// SECURITY: same caveat as specialist-signer.ts/envoy-signer.ts —
// client-side only because this holds fractional testnet SUI for a
// hackathon demo. Never do this with a key that holds anything of real
// value.

import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";

const secretKey = import.meta.env.VITE_SPECIALIST_SECRET_KEY;
const address = import.meta.env.VITE_SPECIALIST_ADDRESS;

if (!secretKey || !address) {
  throw new Error(
    "VITE_SPECIALIST_SECRET_KEY / VITE_SPECIALIST_ADDRESS are not set — see frontend/.env. " +
      "Custodia Verify's on-chain Verifier identity needs a real signing key to act as its AgentIdentity's owner.",
  );
}

export const verifierKeypair = Ed25519Keypair.fromSecretKey(secretKey);

if (verifierKeypair.getPublicKey().toSuiAddress() !== address) {
  throw new Error("VITE_SPECIALIST_ADDRESS does not match the address derived from VITE_SPECIALIST_SECRET_KEY.");
}

export const VERIFIER_ADDRESS: string = address;
