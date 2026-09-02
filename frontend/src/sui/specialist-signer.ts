// The demo specialist stand-in's signing key — same reasoning as
// envoy-signer.ts. deal.move's accept()/mark_delivered() require the
// specialist AgentIdentity's actual owner to sign (specialist.owner() ==
// ctx.sender()), so the scripted specialist (specialist-stand-ins.ts)
// needs one consistent, real, signable address rather than whatever
// wallet happens to be connected when it's registered.
//
// SECURITY: same caveat as envoy-signer.ts — client-side only because this
// holds fractional testnet SUI for a hackathon demo. Never do this with a
// key that holds anything of real value.

import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";

const secretKey = import.meta.env.VITE_SPECIALIST_SECRET_KEY;
const address = import.meta.env.VITE_SPECIALIST_ADDRESS;

if (!secretKey || !address) {
  throw new Error(
    "VITE_SPECIALIST_SECRET_KEY / VITE_SPECIALIST_ADDRESS are not set — see frontend/.env. " +
      "The demo specialist needs a real signing key to act as its AgentIdentity's owner.",
  );
}

export const specialistKeypair = Ed25519Keypair.fromSecretKey(secretKey);

if (specialistKeypair.getPublicKey().toSuiAddress() !== address) {
  throw new Error("VITE_SPECIALIST_ADDRESS does not match the address derived from VITE_SPECIALIST_SECRET_KEY.");
}

export const SPECIALIST_ADDRESS: string = address;
