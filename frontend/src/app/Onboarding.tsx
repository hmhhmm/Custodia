// One-time onboarding flow, required before a deal can be created: the
// connected wallet needs its own on-chain AgentIdentity (client_agent
// argument to PTB #1) and a funded Mandate delegating to a specialist
// address. Also offers registering a demo specialist agent, since
// discoverAgents() needs at least one registered agent to find.

import { useState } from "react";
import { dAppKit } from "../sui/dapp-kit";
import { buildRegisterAgentTx, extractRegisteredAgentFromResult, type RegisteredAgent } from "../sui/ptb-register-agent";
import { buildCreateFundedMandateTx } from "../sui/ptb-mandate";
import type { StatusStepState } from "./types";

export interface OnboardingResult {
  clientAgent: RegisteredAgent;
  specialistAgent: RegisteredAgent;
  mandateCreated: boolean;
}

export function Onboarding({ onComplete }: { onComplete: (result: OnboardingResult) => void }) {
  const [clientAgentStatus, setClientAgentStatus] = useState<StatusStepState>("pending");
  const [specialistAgentStatus, setSpecialistAgentStatus] = useState<StatusStepState>("pending");
  const [mandateStatus, setMandateStatus] = useState<StatusStepState>("pending");
  const [error, setError] = useState<string | null>(null);

  const [clientAgent, setClientAgent] = useState<RegisteredAgent | null>(null);
  const [specialistAgent, setSpecialistAgent] = useState<RegisteredAgent | null>(null);
  const [specialistOwnerAddress, setSpecialistOwnerAddress] = useState("");

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
      const registered = extractRegisteredAgentFromResult(result.Transaction ?? {});
      if (!registered) throw new Error("Registered, but no AgentRegistered event was found to read IDs from.");
      setClientAgent(registered);
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
      const registered = extractRegisteredAgentFromResult(result.Transaction ?? {});
      if (!registered) throw new Error("Registered, but no AgentRegistered event was found to read IDs from.");
      setSpecialistAgent(registered);
      setSpecialistAgentStatus("done");
    } catch (err) {
      setSpecialistAgentStatus("failed");
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleCreateMandate() {
    if (!specialistOwnerAddress) {
      setError("Enter the specialist owner's wallet address first (a Mandate cannot delegate to its own owner).");
      return;
    }
    setMandateStatus("active");
    setError(null);
    try {
      const tx = buildCreateFundedMandateTx({
        delegate: specialistOwnerAddress,
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

  const allDone = clientAgentStatus === "done" && specialistAgentStatus === "done" && mandateStatus === "done";

  function handleContinue() {
    if (!clientAgent || !specialistAgent) return;
    onComplete({ clientAgent, specialistAgent, mandateCreated: mandateStatus === "done" });
  }

  return (
    <div className="mx-auto max-w-xl">
      <h1 className="text-2xl font-semibold tracking-tight text-vellum">One-time setup</h1>
      <p className="mt-2 text-sm text-manifest">
        Before you can create a deal, your wallet needs an on-chain identity and a funded Mandate —
        these are real testnet transactions your wallet will need to sign, in order.
      </p>

      <div className="mt-8 flex flex-col gap-4">
        <OnboardingStep
          title="Register your agent identity"
          status={clientAgentStatus}
          onAction={handleRegisterClient}
          actionLabel="Register"
          resultId={clientAgent?.agentId}
        />
        <OnboardingStep
          title="Register a demo specialist (legal-review.sui)"
          status={specialistAgentStatus}
          onAction={handleRegisterSpecialist}
          actionLabel="Register specialist"
          resultId={specialistAgent?.agentId}
        />
        <div className="rounded-lg border border-border p-5">
          <p className="font-medium text-vellum">Create and fund a Mandate</p>
          <p className="mt-1 text-sm text-manifest">
            Delegates spending authority to the specialist's OWNER wallet address (not the
            AgentIdentity object ID above) — paste the address of whichever wallet you used to
            register the specialist. It must differ from your own connected address; a Mandate
            cannot delegate to its own owner.
          </p>
          <input
            type="text"
            value={specialistOwnerAddress}
            onChange={(e) => setSpecialistOwnerAddress(e.target.value)}
            placeholder="0x... (specialist's owner address)"
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
        onClick={handleContinue}
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
  resultId,
}: {
  title: string;
  status: StatusStepState;
  onAction: () => void;
  actionLabel: string;
  resultId?: string;
}) {
  return (
    <div className="rounded-lg border border-border p-5">
      <div className="flex items-center justify-between">
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
      {resultId && <p className="mt-2 truncate font-data text-xs text-manifest">agent: {resultId}</p>}
    </div>
  );
}
