// One-time onboarding flow. Only one real signature is required from the
// connected wallet: create and fund a Mandate delegating to Envoy
// (envoy-signer.ts's fixed demo keypair). Envoy also needs its own
// on-chain AgentIdentity — registered once, by Envoy itself, no signature
// from the human — because deal.move's create_and_lock_escrow requires the
// SAME signer to both own the client AgentIdentity used in a Deal and be
// the Mandate's delegate:
//   - Sui itself only lets an owned object's OWNER include it as a
//     transaction input — an AgentIdentity you own can never be passed by
//     a transaction Envoy signs.
//   - mandate.move separately forbids delegate == owner on the Mandate
//     itself, so "delegate to yourself" isn't an option either.
// The only shape that satisfies both constraints: Envoy owns its own
// client-role AgentIdentity, and Envoy is the Mandate's delegate — the
// human only ever funds and caps the Mandate, never touches deal creation
// directly. See ARCHITECTURE.md / the Move contracts for the full picture.
//
// Registering a demo specialist is NOT part of this flow — a real user
// should never have to seed the marketplace themselves; see the
// discoverAgents() call in orchestrator.ts.

import { useEffect, useState } from "react";
import { useCurrentAccount } from "@mysten/dapp-kit-react";
import { dAppKit } from "../sui/dapp-kit";
import { buildRegisterAgentTx, extractRegisteredAgentFromResult, type RegisteredAgent } from "../sui/ptb-register-agent";
import { buildCreateFundedMandateTx, extractMandateIdFromResult } from "../sui/ptb-mandate";
import { findOwnedAgentIdentity, findOwnedMandate } from "../sui/onboarding-status";
import { ENVOY_ADDRESS, envoyKeypair } from "../sui/envoy-signer";
import type { StatusStepState } from "./types";

export interface OnboardingResult {
  mandateId: string;
}

// One value now funds AND authorizes the SAME amount — this used to
// authorize `maxSpend` (whatever the user typed) while always funding a
// hardcoded 0.1 SUI regardless, so a Mandate created for "0.2 SUI" was
// really only ever backed by 0.1 SUI of real custody
// (mandate.move's spendable() = min(remaining, funds), so the tighter of
// the two silently wins) — confusing, and easy to mistake for an actual
// on-chain bug rather than a frontend one. See MandateView.tsx's
// NewMandateForm for the same fix applied to funding an ADDITIONAL
// Mandate later.
const DEFAULT_MANDATE_SUI = 1;
export const MANDATE_CATEGORIES = ["legal-review", "courier", "translation", "logistics", "design", "research"] as const;
const MANDATE_DURATION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function suiToMist(sui: number): bigint {
  return BigInt(Math.round(sui * 1_000_000_000));
}

/** Registers Envoy's own AgentIdentity if it doesn't already have one —
 * idempotent, safe to call every time onboarding mounts. Signed by
 * envoyKeypair, never the connected wallet. */
async function ensureEnvoyIdentity(): Promise<RegisteredAgent> {
  const existing = await findOwnedAgentIdentity(ENVOY_ADDRESS, "client");
  if (existing) return existing;

  const tx = buildRegisterAgentTx({
    suinsName: `envoy-${Date.now()}.sui`,
    capabilities: ["client"],
  });
  const result = await envoyKeypair.signAndExecuteTransaction({ transaction: tx, client: dAppKit.getClient() });
  if (result.FailedTransaction) {
    throw new Error(result.FailedTransaction.status.error?.message ?? "Envoy identity registration failed");
  }
  const registered = await extractRegisteredAgentFromResult(dAppKit.getClient(), result);
  if (!registered) throw new Error("Envoy registered, but no AgentRegistered event was found to read IDs from.");
  return registered;
}

export function Onboarding({ onComplete }: { onComplete: (result: OnboardingResult) => void }) {
  const account = useCurrentAccount();
  const [mandateStatus, setMandateStatus] = useState<StatusStepState>("pending");
  const [error, setError] = useState<string | null>(null);

  const [mandateId, setMandateId] = useState<string | null>(null);
  const [maxSpend, setMaxSpend] = useState(DEFAULT_MANDATE_SUI);

  // Reload wipes React state, but the on-chain Mandate from a previous
  // session still exists — re-check for it so setup doesn't ask you to
  // redo work you've already done.
  useEffect(() => {
    if (!account) return;
    let cancelled = false;

    findOwnedMandate(account.address, ENVOY_ADDRESS)
      .then((found) => {
        if (cancelled || !found) return;
        setMandateId(found);
        setMandateStatus("done");
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [account]);

  async function handleSetup() {
    setError(null);
    setMandateStatus("active");

    try {
      // Envoy needs its own AgentIdentity before it can ever create a
      // Deal — do this first so a failure here doesn't cost you a
      // signature for nothing.
      await ensureEnvoyIdentity();

      let id = mandateId;
      if (!id) {
        const tx = buildCreateFundedMandateTx({
          delegate: ENVOY_ADDRESS,
          maxSpend: suiToMist(maxSpend),
          allowedCategories: [...MANDATE_CATEGORIES],
          expiresAtMs: BigInt(Date.now() + MANDATE_DURATION_MS),
          fundingAmount: suiToMist(maxSpend),
        });
        const result = await dAppKit.signAndExecuteTransaction({ transaction: tx });
        if (result.FailedTransaction) {
          throw new Error(result.FailedTransaction.status.error?.message ?? "Mandate creation failed");
        }
        const extracted = await extractMandateIdFromResult(dAppKit.getClient(), result);
        if (!extracted) throw new Error("Mandate created, but no MandateCreated event was found to read its ID from.");
        id = extracted;
        setMandateId(extracted);
      }

      setMandateStatus("done");
      onComplete({ mandateId: id });
    } catch (err) {
      console.error("Setup failed:", err);
      setMandateStatus("failed");
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  const busy = mandateStatus === "active";

  return (
    <div className="min-h-screen bg-ink px-4 py-8 text-vellum sm:px-6 sm:py-10">
      <div className="mx-auto max-w-xl">
      <h1 className="text-2xl font-semibold tracking-tight text-vellum">One-time setup</h1>
      <p className="mt-2 text-sm text-manifest">
        One real testnet transaction: authorize Envoy to spend on your behalf within a limit you set.
        Envoy finds and deals with specialist agents from here on — you won't need to do this again.
      </p>

      <div className="mt-8 flex flex-col gap-4">
        <div className="rounded-lg border border-border p-5">
          <label className="text-sm font-medium text-vellum" htmlFor="max-spend">
            Envoy's spending limit
          </label>
          <p className="mt-1 text-sm text-manifest">
            The most Envoy can commit across all deals — funded with this same amount from your wallet
            now. This is a one-time cap for this Mandate; raising it later requires creating a new one
            from the Mandate tab.
          </p>
          <div className="mt-3 flex items-center gap-2">
            <input
              id="max-spend"
              type="number"
              min={0.1}
              step={0.1}
              value={maxSpend}
              onChange={(e) => setMaxSpend(Number(e.target.value))}
              disabled={busy || mandateStatus === "done"}
              className="w-32 rounded-md border border-border bg-surface px-3 py-2 font-data text-sm text-vellum focus:border-accent focus:outline-none disabled:opacity-40"
            />
            <span className="text-sm text-manifest">SUI</span>
          </div>
        </div>
      </div>

      {error && <p className="mt-4 text-sm text-wax">{error}</p>}

      <button
        type="button"
        onClick={mandateId ? () => onComplete({ mandateId }) : handleSetup}
        disabled={busy}
        className="mt-8 rounded-md bg-white px-6 py-3 text-sm font-medium text-black transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {mandateId ? "Continue" : busy ? "Setting up…" : "Set up Custodia"}
      </button>
      </div>
    </div>
  );
}
