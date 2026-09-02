// Envoy's demo signing key — a stand-in for "the user's personal agent"
// signer, needed because mandate.move requires the Mandate's `delegate`
// address to literally be the transaction sender (see mandate.move's
// `assert_is_delegate`). A Mandate cannot delegate to its own owner
// (`EDelegateIsOwner`), so the connected wallet can never be its own
// delegate — some other real, signable address has to be.
//
// SECURITY: this loads a private key into the browser bundle via a Vite
// env var. That is only acceptable because this keypair holds fractional
// testnet SUI for a hackathon demo, nothing of real value. Never do this
// for a production signer — a real "Envoy" needs its key held server-side
// (see the open question logged in ARCHITECTURE.md / wiring-status about
// the Move-level delegate model) or in a user-controlled secure enclave,
// not shipped to every browser that loads this app.

import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";

const secretKey = import.meta.env.VITE_ENVOY_SECRET_KEY;
const address = import.meta.env.VITE_ENVOY_ADDRESS;

if (!secretKey || !address) {
  throw new Error(
    "VITE_ENVOY_SECRET_KEY / VITE_ENVOY_ADDRESS are not set — see frontend/.env. " +
      "Envoy needs a real signing key to act as a Mandate's delegate.",
  );
}

export const envoyKeypair = Ed25519Keypair.fromSecretKey(secretKey);

if (envoyKeypair.getPublicKey().toSuiAddress() !== address) {
  throw new Error("VITE_ENVOY_ADDRESS does not match the address derived from VITE_ENVOY_SECRET_KEY.");
}

export const ENVOY_ADDRESS: string = address;
