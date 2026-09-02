// One-time seed script: registers the demo specialist's on-chain
// AgentIdentity using its own dedicated keypair (see specialist-signer.ts
// for why it needs a consistent, real signer — deal.move requires the
// specialist AgentIdentity's actual owner to sign accept()/mark_delivered(),
// so re-registering it from whatever wallet happens to be testing the app
// breaks that). Run this once per fresh testnet deployment, not per user —
// the running app's UI never registers a specialist.
//
// Usage: node scripts/seed-specialist.mjs
// Reads VITE_SPECIALIST_SECRET_KEY, VITE_CUSTODIA_PACKAGE_ID,
// VITE_AGENT_REGISTRY_ID from frontend/.env.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { SuiGrpcClient } from "@mysten/sui/grpc";
import { Transaction } from "@mysten/sui/transactions";

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadEnv(path) {
  const env = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    env[trimmed.slice(0, eq)] = trimmed.slice(eq + 1);
  }
  return env;
}

const env = loadEnv(join(__dirname, "..", ".env"));
const PACKAGE_ID = env.VITE_CUSTODIA_PACKAGE_ID;
const AGENT_REGISTRY_ID = env.VITE_AGENT_REGISTRY_ID;
const SPECIALIST_SECRET_KEY = env.VITE_SPECIALIST_SECRET_KEY;

if (!PACKAGE_ID || !AGENT_REGISTRY_ID || !SPECIALIST_SECRET_KEY) {
  throw new Error("Missing VITE_CUSTODIA_PACKAGE_ID / VITE_AGENT_REGISTRY_ID / VITE_SPECIALIST_SECRET_KEY in .env");
}

const keypair = Ed25519Keypair.fromSecretKey(SPECIALIST_SECRET_KEY);
const address = keypair.getPublicKey().toSuiAddress();
const client = new SuiGrpcClient({ network: "testnet", baseUrl: "https://fullnode.testnet.sui.io:443" });

console.log(`Registering demo specialist as ${address}...`);

const tx = new Transaction();
tx.moveCall({
  target: `${PACKAGE_ID}::agent_identity::register_and_keep`,
  arguments: [
    tx.object(AGENT_REGISTRY_ID),
    tx.pure.string(`legal-review-${Date.now()}.sui`),
    tx.pure.vector("string", ["legal-review"]),
  ],
});

const result = await keypair.signAndExecuteTransaction({ transaction: tx, client });

if (result.$kind === "FailedTransaction") {
  console.error("Registration failed:", result.FailedTransaction.status.error?.message);
  process.exit(1);
}

console.log(`Registered. Digest: ${result.Transaction.digest}`);
console.log("Fund this address with testnet SUI (faucet.sui.io) if accept()/mark_delivered() will run gas costs:");
console.log(address);
