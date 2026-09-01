// Owner: Person 4 (frontend + orchestration).
//
// Real one-time onboarding flow, genuinely required before a deal can be
// created: the connected wallet needs its own on-chain AgentIdentity
// (client_agent argument to PTB #1) and a funded Mandate delegating to a
// specialist address. Neither existed anywhere in the codebase before
// this file — flagged and built here rather than left as a silent gap,
// since "wire everything together" cannot be true while these are
// missing.
//
// This screen also offers registering a DEMO SPECIALIST agent, because
// the live AgentRegistry has zero registered agents today (verified via
// GraphQL) — without at least one, discoverAgents() has nothing to find,
// full stop, regardless of how correct the rest of the wiring is.

import { useState } from "react";
import { dAppKit } from "../sui/dapp-kit";
import { buildRegisterAgentTx, extractAgentIdFromResult } from "../sui/ptb-register-agent";
import { buildCreateFundedMandateTx } from "../sui/ptb-mandate";

type StepState = "pending" | "active" | "done" | "failed";

export function Onboarding({ onComplete }: { onComplete: () => void }) {
  const [clientAgentStatus, setClientAgentStatus] = useState<StepState>("pending");
  const [specialistAgentStatus, setSpecialistAgentStatus] = useState<StepState>("pending");
  const [mandateStatus, setMandateStatus] = useState<StepState>("pending");
  const [error, setError] = useState<string | null>(null);
  const [specialistAddress, setSpecialistAddress] = useState("");

  async function handleRegisterClient() {
    setClientAgentStatus("active");
    setError(null);
    try {
      const tx = buildRegisterAgentTx({
        suinsName: `client-${Date.now()}.sui`,
        capabilities: ["client"],
      });
      const result = await dAppKit.signAndExecuteTransaction({ transaction: tx });
      if (result.FailedTransaction) {
        throw new Error(result.FailedTransaction.status.error?.message ?? "Registration failed");
      }
      const agentId = extractAgentIdFromResult(result.Transaction ?? {});
      if (!agentId) throw new Error("Registered, but no AgentRegistered event was found to read the agent ID from.");
      setClientAgentStatus("done");
    } catch (err) {
      setClientAgentStatus("failed");
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleRegisterSpecialist() {
    setSpecialistAgentStatus("active");
    setError(null);
    try {
      const tx = buildRegisterAgentTx({
        suinsName: `legal-review-${Date.now()}.sui`,
        capabilities: ["legal-review"],
      });
      const result = await dAppKit.signAndExecuteTransaction({ transaction: tx });
      if (result.FailedTransaction) {
        throw new Error(result.FailedTransaction.status.error?.message ?? "Registration failed");
      }
      setSpecialistAgentStatus("done");
    } catch (err) {
      setSpecialistAgentStatus("failed");
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleCreateMandate() {
    if (!specialistAddress) {
      setError("Enter the specialist agent's owner address first (a Mandate cannot delegate to its own owner).");
      return;
    }
    setMandateStatus("active");
    setError(null);
    try {
      const tx = buildCreateFundedMandateTx({
        delegate: specialistAddress,
        maxSpend: 50_000_000_000n, // 50 SUI
        allowedCategories: ["legal-review", "courier"],
        expiresAtMs: BigInt(Date.now() + 30 * 24 * 60 * 60 * 1000),
        fundingAmount: 20_000_000_000n, // 20 SUI
      });
      const result = await dAppKit.signAndExecuteTransaction({ transaction: tx });
      if (result.FailedTransaction) {
        throw new Error(result.FailedTransaction.status.error?.message ?? "Mandate creation failed");
      }
      setMandateStatus("done");
    } catch (err) {
      setMandateStatus("failed");
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  const allDone = clientAgentStatus === "done" && mandateStatus === "done";

  return (
    <div className="mx-auto max-w-xl">
      <h1 className="text-2xl font-semibold tracking-tight text-vellum">One-time setup</h1>
      <p className="mt-2 text-sm text-manifest">
        Before you can create a deal, your wallet needs an on-chain identity and a funded Mandate —
        these are real testnet transactions your wallet will need to sign.
      </p>

      <div className="mt-8 flex flex-col gap-4">
        <OnboardingStep
          title="Register your agent identity"
          status={clientAgentStatus}
          onAction={handleRegisterClient}
          actionLabel="Register"
        />
        <OnboardingStep
          title="Register a demo specialist (legal-review.sui)"
          status={specialistAgentStatus}
          onAction={handleRegisterSpecialist}
          actionLabel="Register specialist"
        />
        <div className="rounded-lg border border-border p-5">
          <p className="font-medium text-vellum">Create and fund a Mandate</p>
          <p className="mt-1 text-sm text-manifest">
            Delegates spending authority to the specialist's owner address (paste it after
            registering the specialist above — check your wallet's transaction history for its
            address, since this demo doesn't yet read it back automatically).
          </p>
          <input
            type="text"
            value={specialistAddress}
            onChange={(e) => setSpecialistAddress(e.target.value)}
            placeholder="0x..."
            className="mt-3 w-full rounded-md border border-border bg-surface px-3 py-2 font-data text-sm text-vellum placeholder:text-manifest focus:border-accent focus:outline-none"
          />
          <button
            type="button"
            onClick={handleCreateMandate}
            disabled={mandateStatus === "active" || mandateStatus === "done"}
            className="mt-3 rounded-md bg-white px-4 py-2 text-sm font-medium text-black transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {mandateStatus === "done" ? "Mandate created" : "Create Mandate"}
          </button>
        </div>
      </div>

      {error && <p className="mt-4 text-sm text-wax">{error}</p>}

      <button
        type="button"
        onClick={onComplete}
        disabled={!allDone}
        className="mt-8 rounded-md border border-border px-4 py-2 text-sm font-medium text-vellum transition-colors hover:border-white/30 disabled:cursor-not-allowed disabled:opacity-40"
      >
        Continue to dashboard
      </button>
    </div>
  );
}

function OnboardingStep({
  title,
  status,
  onAction,
  actionLabel,
}: {
  title: string;
  status: StepState;
  onAction: () => void;
  actionLabel: string;
}) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-border p-5">
      <p className="font-medium text-vellum">{title}</p>
      <button
        type="button"
        onClick={onAction}
        disabled={status === "active" || status === "done"}
        className="rounded-md border border-border px-3 py-1.5 text-sm text-vellum transition-colors hover:border-white/30 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {status === "done" ? "Done" : status === "active" ? "Signing…" : actionLabel}
      </button>
    </div>
  );
}
