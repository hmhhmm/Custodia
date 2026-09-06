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
import { findOwnedAgentIdentities } from "../sui/onboarding-status";
import { discoverAgents } from "../agent/discovery";
import { MANDATE_CATEGORIES } from "./Onboarding";
import { SpecialistInbox } from "./SpecialistInbox";

// Debounce delay for the live name-availability check below — long enough
// that a fast typist doesn't trigger a GraphQL read per keystroke, short
// enough that the result still feels immediate.
const NAME_CHECK_DEBOUNCE_MS = 400;

export function SpecialistOnboarding() {
  const account = useCurrentAccount();
  const dAppKit = useDAppKit();

  const [suinsName, setSuinsName] = useState("");
  const [category, setCategory] = useState<(typeof MANDATE_CATEGORIES)[number]>(MANDATE_CATEGORIES[0]);
  const [existing, setExisting] = useState<RegisteredAgent | null>(null);
  const [status, setStatus] = useState<"loading" | "ready">("loading");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Real on-chain availability check for the typed display name — reads
  // the live AgentRegistry (same query discovery.ts already uses to rank
  // candidates) rather than letting a taken name fail only at submit time
  // with a raw Move abort ("MoveAbort ... ENameTaken") the user has no way
  // to interpret. Debounced, not per-keystroke.
  const [nameCheck, setNameCheck] = useState<"idle" | "checking" | "available" | "taken">("idle");

  // Checks whether this wallet owns ANY specialist identity already — not
  // filtered by the locally-selected `category` dropdown, which always
  // resets to MANDATE_CATEGORIES[0] on a fresh page load regardless of
  // what category was actually registered under. Filtering by that reset
  // default here was the exact bug: a wallet registered as e.g.
  // "research" looked unregistered after a refresh, because the check
  // asked "does this wallet own a LEGAL-REVIEW identity" (the default
  // category) instead of "does this wallet own ANY identity at all."
  useEffect(() => {
    if (!account) return;
    let cancelled = false;
    setStatus("loading");

    findOwnedAgentIdentities(account.address)
      .then((found) => {
        if (cancelled) return;
        setExisting(found[0] ?? null);
        setStatus("ready");
      })
      .catch(() => {
        if (!cancelled) setStatus("ready");
      });

    return () => {
      cancelled = true;
    };
  }, [account]);

  useEffect(() => {
    const trimmed = suinsName.trim();
    if (!trimmed) {
      setNameCheck("idle");
      return;
    }
    setNameCheck("checking");
    let cancelled = false;
    const timer = setTimeout(() => {
      // No capability filter — a name must be unique across the WHOLE
      // registry (agent_identity.move's is_name_taken checks every
      // agent, not just ones in this category), so this has to scan
      // everyone, same as discoverAgents({}) already does for the "no
      // filter" case elsewhere.
      discoverAgents({})
        .then((all) => {
          if (cancelled) return;
          const taken = all.some((a) => a.suinsName.toLowerCase() === trimmed.toLowerCase());
          setNameCheck(taken ? "taken" : "available");
        })
        .catch(() => {
          if (!cancelled) setNameCheck("idle");
        });
    }, NAME_CHECK_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [suinsName]);

  async function handleRegister() {
    if (!account || !suinsName.trim()) return;
    if (nameCheck === "taken") {
      setError(`"${suinsName.trim()}" is already taken — pick a different display name.`);
      return;
    }
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
      const raw = err instanceof Error ? err.message : String(err);
      // The live availability check above should catch this before
      // submit, but translate the raw Move abort into plain English as a
      // fallback (e.g. a name taken by someone else in the moment between
      // the check and the actual signed transaction) rather than showing
      // "MoveAbort ... agent_identity::register (line 169)" verbatim.
      setError(
        raw.includes("ENameTaken") || (raw.includes("agent_identity::register") && raw.includes("line 169"))
          ? `"${suinsName.trim()}" is already taken — pick a different display name.`
          : raw,
      );
    } finally {
      setBusy(false);
    }
  }

  if (!account) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-10 lg:px-8">
        <p className="text-sm text-manifest">Connect a wallet to register as a specialist.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-10 lg:px-8">
      <div className="mb-8 max-w-2xl">
        <h1 className="text-2xl font-semibold tracking-tight text-vellum">Become a specialist</h1>
        <p className="mt-2 text-sm text-manifest">
          Register this connected wallet as a real specialist agent — a genuine counterparty other clients'
          Envoys can find, deal with, and pay. This wallet signs every accept/deliver step itself, not a
          shared demo key.
        </p>
      </div>

      {status === "loading" && <p className="text-sm text-manifest">Checking this account…</p>}

      {status === "ready" && existing && (
        <div className="mb-10 rounded-xl border border-border bg-surface p-6 sm:flex sm:items-center sm:justify-between sm:gap-6">
          <div className="min-w-0">
            <p className="flex items-center gap-2 text-sm font-medium text-vellum">
              <span className="text-vellum">✓</span>
              You're already registered
            </p>
            <p className="mt-2 truncate font-data text-xs text-manifest">Agent ID: {existing.agentId}</p>
            <p className="mt-1 truncate font-data text-xs text-manifest">Reputation ID: {existing.reputationId}</p>
          </div>
        </div>
      )}

      {status === "ready" && !existing && (
        <div className="mb-10 max-w-2xl rounded-xl border border-border bg-surface p-6">
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
            className={`mt-3 w-full rounded-md border bg-ink px-3 py-2 font-data text-sm text-vellum focus:outline-none disabled:opacity-40 ${
              nameCheck === "taken" ? "border-wax focus:border-wax" : "border-border focus:border-accent"
            }`}
          />
          {nameCheck === "checking" && <p className="mt-1.5 text-xs text-manifest">Checking availability…</p>}
          {nameCheck === "taken" && (
            <p className="mt-1.5 text-xs text-wax">"{suinsName.trim()}" is already taken — try a different name.</p>
          )}
          {nameCheck === "available" && <p className="mt-1.5 text-xs text-vellum">Available.</p>}

          <label className="mt-4 block text-sm font-medium text-vellum" htmlFor="category">
            Category
          </label>
          <p className="mt-1 text-sm text-manifest">The kind of work this agent can be found and hired for.</p>
          <select
            id="category"
            value={category}
            onChange={(e) => setCategory(e.target.value as (typeof MANDATE_CATEGORIES)[number])}
            disabled={busy}
            className="mt-3 w-full rounded-md border border-border bg-ink px-3 py-2 text-sm text-vellum focus:border-accent focus:outline-none disabled:opacity-40"
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
            disabled={busy || !suinsName.trim() || nameCheck === "taken"}
            className="mt-5 rounded-md bg-white px-6 py-3 text-sm font-medium text-black transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? "Registering…" : "Register as specialist"}
          </button>

          {error && <p className="mt-3 text-sm text-wax">{error}</p>}
        </div>
      )}

      {status === "ready" && existing && <SpecialistInbox />}
    </div>
  );
}
