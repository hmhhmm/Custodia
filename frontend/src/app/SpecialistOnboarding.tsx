// Specialist sign-up screen — a real counterparty on the other side of a
// Deal, logged in with their own connected wallet (same ConnectButton flow
// as the client side), not the fixed specialist-signer.ts keypair the demo
// used before. Registers a real AgentIdentity + Reputation via
// agent_identity::register_and_keep, signed by whichever wallet is
// currently connected — so testing with multiple real accounts (one client,
// several specialists) works exactly as it would for real users.
//
// Reuses buildRegisterAgentTx/extractRegisteredAgentFromResult — the same
// verified PTB Onboarding.tsx already uses for Envoy's own identity.

import { useEffect, useState } from "react";
import { useCurrentAccount, useDAppKit } from "@mysten/dapp-kit-react";
import { buildRegisterAgentTx, extractRegisteredAgentFromResult, type RegisteredAgent } from "../sui/ptb-register-agent";
import { findOwnedAgentIdentity } from "../sui/onboarding-status";
import { MANDATE_CATEGORIES } from "./Onboarding";

export function SpecialistOnboarding() {
  const account = useCurrentAccount();
  const dAppKit = useDAppKit();

  const [suinsName, setSuinsName] = useState("");
  const [category, setCategory] = useState<(typeof MANDATE_CATEGORIES)[number]>(MANDATE_CATEGORIES[0]);
  const [existing, setExisting] = useState<RegisteredAgent | null>(null);
  const [status, setStatus] = useState<"loading" | "ready">("loading");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!account) return;
    let cancelled = false;
    setStatus("loading");

    findOwnedAgentIdentity(account.address, category)
      .then((found) => {
        if (cancelled) return;
        setExisting(found);
        setStatus("ready");
      })
      .catch(() => {
        if (!cancelled) setStatus("ready");
      });

    return () => {
      cancelled = true;
    };
  }, [account, category]);

  async function handleRegister() {
    if (!account || !suinsName.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const tx = buildRegisterAgentTx({
        suinsName: suinsName.trim(),
        capabilities: [category],
      });
      const result = await dAppKit.signAndExecuteTransaction({ transaction: tx });
      if (result.FailedTransaction) {
        throw new Error(result.FailedTransaction.status.error?.message ?? "Registration failed");
      }
      const registered = await extractRegisteredAgentFromResult(dAppKit.getClient(), result);
      if (!registered) throw new Error("Registered, but no AgentRegistered event was found to read IDs from.");
      setExisting(registered);
    } catch (err) {
      console.error("Specialist registration failed:", err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  if (!account) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6 sm:py-10">
        <p className="text-sm text-manifest">Connect a wallet to register as a specialist.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4 px-4 py-8 sm:px-6 sm:py-10">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-vellum">Become a specialist</h1>
        <p className="mt-2 text-sm text-manifest">
          Register this connected wallet as a real specialist agent — a genuine counterparty other clients'
          Envoys can find, deal with, and pay. This wallet signs every accept/deliver step itself, not a
          shared demo key.
        </p>
      </div>

      {status === "loading" && <p className="text-sm text-manifest">Checking this account…</p>}

      {status === "ready" && existing && (
        <div className="rounded-lg border border-border p-5">
          <p className="text-sm font-medium text-vellum">You're already registered</p>
          <p className="mt-2 font-data text-xs text-manifest">Agent ID: {existing.agentId}</p>
          <p className="mt-1 font-data text-xs text-manifest">Reputation ID: {existing.reputationId}</p>
          <p className="mt-3 text-sm text-manifest">
            Incoming deal requests naming this agent will show up here once the specialist inbox is built —
            for now, this confirms the account is live on-chain and discoverable.
          </p>
        </div>
      )}

      {status === "ready" && !existing && (
        <div className="rounded-lg border border-border p-5">
          <label className="text-sm font-medium text-vellum" htmlFor="suins-name">
            Display name
          </label>
          <p className="mt-1 text-sm text-manifest">Shown to clients searching for a specialist — must be unique.</p>
          <input
            id="suins-name"
            type="text"
            value={suinsName}
            onChange={(e) => setSuinsName(e.target.value)}
            placeholder="legal-review-yourname.sui"
            disabled={busy}
            className="mt-3 w-full rounded-md border border-border bg-surface px-3 py-2 font-data text-sm text-vellum focus:border-accent focus:outline-none disabled:opacity-40"
          />

          <label className="mt-4 block text-sm font-medium text-vellum" htmlFor="category">
            Category
          </label>
          <p className="mt-1 text-sm text-manifest">The kind of work this agent can be found and hired for.</p>
          <select
            id="category"
            value={category}
            onChange={(e) => setCategory(e.target.value as (typeof MANDATE_CATEGORIES)[number])}
            disabled={busy}
            className="mt-3 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-vellum focus:border-accent focus:outline-none disabled:opacity-40"
          >
            {MANDATE_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={handleRegister}
            disabled={busy || !suinsName.trim()}
            className="mt-5 rounded-md bg-white px-6 py-3 text-sm font-medium text-black transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? "Registering…" : "Register as specialist"}
          </button>

          {error && <p className="mt-3 text-sm text-wax">{error}</p>}
        </div>
      )}
    </div>
  );
}
