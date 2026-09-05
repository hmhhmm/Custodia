// Custodia Verify — the transparency UI the Gonka track's brief
// mandates: Truth Score, reasoning trace, and every model's real Gonka
// Request ID, plus the on-chain Deal id and Verifier Reputation score
// this claim's verification actually ran through. See app/factcheck.ts
// for the real orchestration this view drives.

import { useState } from "react";
import { useCurrentAccount } from "@mysten/dapp-kit-react";
import { runFactCheck, type FactCheckStep, type FactCheckResult } from "./factcheck";

function StepGlyph({ state }: { state: FactCheckStep["state"] }) {
  if (state === "done") return <span className="text-vellum">✓</span>;
  if (state === "failed") return <span className="text-wax">✕</span>;
  if (state === "active") {
    return (
      <span
        className="inline-block h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-manifest border-t-vellum"
        role="status"
        aria-label="In progress"
      />
    );
  }
  return <span className="text-manifest">○</span>;
}

function ScoreRing({ score }: { score: number }) {
  const color = score >= 70 ? "var(--color-vellum)" : score >= 40 ? "#c9944f" : "#c9694f";
  return (
    <div className="flex flex-col items-center">
      <div
        className="flex h-28 w-28 items-center justify-center rounded-full border-4"
        style={{ borderColor: color }}
      >
        <span className="text-3xl font-semibold tabular-nums text-vellum">{score}%</span>
      </div>
      <p className="mt-2 text-xs uppercase tracking-wide text-manifest">Consensus Truth Score</p>
    </div>
  );
}

export function FactCheckView() {
  const account = useCurrentAccount();
  const [claim, setClaim] = useState("");
  const [steps, setSteps] = useState<FactCheckStep[]>([]);
  const [result, setResult] = useState<FactCheckResult | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleVerify() {
    if (!account || !claim.trim()) return;
    setRunning(true);
    setError(null);
    setResult(null);
    setSteps([]);
    try {
      const finalResult = await runFactCheck(claim.trim(), account.address, setSteps);
      setResult(finalResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-10">
      <h1 className="text-2xl font-semibold tracking-tight text-vellum">Custodia Verify</h1>
      <p className="mt-2 text-sm text-manifest">
        Paste a claim, URL, or text snippet. It's cross-verified across independent models on{" "}
        <span className="text-vellum">Gonka Router</span> — the mandatory inference gateway for every
        reasoning step below, nothing routed anywhere else.
      </p>

      <div className="mt-6 rounded-xl border border-border bg-surface p-5">
        <textarea
          value={claim}
          onChange={(e) => setClaim(e.target.value)}
          disabled={running}
          placeholder="e.g. 'The Great Wall of China is visible from space with the naked eye.'"
          rows={3}
          className="w-full resize-none rounded-lg border border-border bg-ink px-3.5 py-3 text-sm text-vellum placeholder:text-manifest focus:border-accent focus:outline-none disabled:opacity-40"
        />
        <button
          type="button"
          onClick={handleVerify}
          disabled={running || !claim.trim() || !account}
          className="mt-3 rounded-md bg-white px-4 py-2 text-sm font-medium text-black transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {running ? "Verifying…" : "Verify claim"}
        </button>
        {!account && <p className="mt-2 text-sm text-wax">Connect a wallet to fund the verification escrow.</p>}
      </div>

      {steps.length > 0 && (
        <div className="mt-6 rounded-xl border border-border bg-surface p-6">
          <p className="mb-4 text-sm font-medium text-vellum">Live progress</p>
          <ol className="flex flex-col gap-3">
            {steps.map((step) => (
              <li key={step.id}>
                <div className="flex items-center gap-2.5">
                  <StepGlyph state={step.state} />
                  <span className="text-sm text-vellum">{step.label}</span>
                </div>
                {step.detail && <p className="mt-1 pl-6 text-sm text-manifest [overflow-wrap:anywhere]">{step.detail}</p>}
              </li>
            ))}
          </ol>
        </div>
      )}

      {error && (
        <div className="mt-6 rounded-xl border border-wax/40 bg-wax/10 p-5">
          <p className="text-sm text-wax [overflow-wrap:anywhere]">{error}</p>
        </div>
      )}

      {result && (
        <div className="mt-6 flex flex-col gap-6">
          <div className="rounded-xl border border-border bg-surface p-6">
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0">
                <p className="text-xs uppercase tracking-wide text-manifest">Claim</p>
                <p className="mt-1 text-sm text-vellum">{result.claim}</p>
              </div>
              <ScoreRing score={result.consensus.consensusTruthScore} />
            </div>
            {result.consensus.modelsDisagree && (
              <p className="mt-4 rounded-lg border border-wax/40 bg-wax/10 px-3.5 py-2.5 text-sm text-wax">
                Models disagreed by more than 25 points — treat this verdict as contested, not settled.
              </p>
            )}
          </div>

          <div className="rounded-xl border border-border bg-surface p-6">
            <p className="mb-4 text-sm font-medium text-vellum">Per-model reasoning trace</p>
            <div className="flex flex-col gap-4">
              {result.consensus.perModel.map((m) => (
                <div key={m.model} className="border-t border-border pt-4 first:border-t-0 first:pt-0">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-data text-sm text-vellum">{m.model}</span>
                    {m.verdict && (
                      <span className="rounded-full border border-border px-2.5 py-0.5 text-xs text-vellum">
                        {m.verdict.truthScore}%
                      </span>
                    )}
                  </div>
                  {m.requestId && (
                    <p className="mt-1 font-data text-xs text-manifest [overflow-wrap:anywhere]">
                      Gonka Request ID: {m.requestId}
                    </p>
                  )}
                  {m.verdict && <p className="mt-2 text-sm text-manifest">{m.verdict.reasoning}</p>}
                  {m.error && <p className="mt-2 text-sm text-wax [overflow-wrap:anywhere]">{m.error}</p>}
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-border bg-surface p-6">
            <p className="mb-3 text-sm font-medium text-vellum">On-chain record</p>
            <div className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
              <div>
                <p className="text-xs uppercase tracking-wide text-manifest">Deal</p>
                <p className="mt-1 font-data text-vellum [overflow-wrap:anywhere]">{result.dealId}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-manifest">Verdict storage (Walrus)</p>
                <p className="mt-1 font-data text-vellum [overflow-wrap:anywhere]">{result.storageId}</p>
              </div>
              <div className="sm:col-span-2">
                <p className="text-xs uppercase tracking-wide text-manifest">Verifier Reputation object</p>
                <p className="mt-1 font-data text-vellum [overflow-wrap:anywhere]">{result.verifierReputationId}</p>
              </div>
            </div>
            <p className="mt-4 text-xs text-manifest">
              Payment for this verification released and this Reputation object updated in the same
              on-chain transaction — the identical mechanism a specialist's completed deal already uses.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
