// Mandate tab — the real, previously-nowhere-visible on-chain state of
// what Envoy is authorized to spend. Replaces the old "History" nav tab,
// which had no real content behind it (Dashboard never filtered by it).

import { useEffect, useState } from "react";
import { useCurrentAccount } from "@mysten/dapp-kit-react";
import { findMandateDetails, type MandateDetails } from "../sui/onboarding-status";
import { ENVOY_ADDRESS } from "../sui/envoy-signer";
import { dAppKit } from "../sui/dapp-kit";
import { buildCreateFundedMandateTx, extractMandateIdFromResult } from "../sui/ptb-mandate";
import { MANDATE_CATEGORIES } from "./Onboarding";

// A single "SUI limit" input now funds AND authorizes the SAME amount —
// the form used to fund a hardcoded 0.1 SUI regardless of what the user
// typed here, while this value only set the AUTHORIZATION cap
// (max_spend). mandate.move's real spendable() = min(remaining, funds),
// so a Mandate authorized for 0.2 but funded with only 0.1 silently caps
// out at 0.1 the moment spending starts — confusing and, worse,
// impossible to tell apart from a genuine on-chain discrepancy just by
// looking at the "0.2 SUI limit" label. One input, one real amount for
// both, so what's typed is exactly what's available.
const DEFAULT_MANDATE_SUI = 1;
const MANDATE_DURATION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function mistToSui(mist: bigint): number {
  return Number(mist) / 1_000_000_000;
}

function formatSui(mist: bigint): string {
  return `${mistToSui(mist).toLocaleString(undefined, { maximumFractionDigits: 4 })} SUI`;
}

function suiToMist(sui: number): bigint {
  return BigInt(Math.round(sui * 1_000_000_000));
}

function MandateIdCopy({ mandateId }: { mandateId: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard.writeText(mandateId);
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      }}
      title="Click to copy"
      className="min-w-0 max-w-[60%] truncate rounded-md px-1.5 py-0.5 font-data text-xs text-manifest hover:bg-surface-hover hover:text-vellum"
    >
      {copied ? "Copied" : mandateId}
    </button>
  );
}

function NewMandateForm({ onCreated }: { onCreated: (mandate: MandateDetails) => void }) {
  const [amount, setAmount] = useState(DEFAULT_MANDATE_SUI);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCreate() {
    setBusy(true);
    setError(null);
    try {
      const tx = buildCreateFundedMandateTx({
        delegate: ENVOY_ADDRESS,
        maxSpend: suiToMist(amount),
        allowedCategories: [...MANDATE_CATEGORIES],
        expiresAtMs: BigInt(Date.now() + MANDATE_DURATION_MS),
        fundingAmount: suiToMist(amount),
      });
      const result = await dAppKit.signAndExecuteTransaction({ transaction: tx });
      if (result.FailedTransaction) {
        throw new Error(result.FailedTransaction.status.error?.message ?? "Mandate creation failed");
      }
      const mandateId = await extractMandateIdFromResult(dAppKit.getClient(), result);
      if (!mandateId) throw new Error("Mandate created, but no MandateCreated event was found to read its ID from.");
      onCreated({
        mandateId,
        delegate: ENVOY_ADDRESS,
        maxSpendMist: suiToMist(amount),
        spentSoFarMist: 0n,
        fundsMist: suiToMist(amount),
        allowedCategories: [...MANDATE_CATEGORIES],
        expiresAtMs: Date.now() + MANDATE_DURATION_MS,
        revoked: false,
      });
    } catch (err) {
      console.error("Mandate creation failed:", err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border border-border p-5">
      <p className="text-sm font-medium text-vellum">Fund a new Mandate</p>
      <p className="mt-1 text-sm text-manifest">Envoy is authorized to spend up to this amount, funded from your wallet with the same amount.</p>
      <div className="mt-3 flex items-center gap-2">
        <input
          type="number"
          min={0.1}
          step={0.1}
          value={amount}
          onChange={(e) => setAmount(Number(e.target.value))}
          disabled={busy}
          className="w-32 rounded-md border border-border bg-surface px-3 py-2 font-data text-sm text-vellum focus:border-accent focus:outline-none disabled:opacity-40"
        />
        <span className="text-sm text-manifest">SUI limit</span>
        <button
          type="button"
          onClick={handleCreate}
          disabled={busy}
          className="ml-auto rounded-md bg-white px-4 py-2 text-sm font-medium text-black transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy ? "Creating…" : "Create Mandate"}
        </button>
      </div>
      {error && <p className="mt-3 text-sm text-wax">{error}</p>}
    </div>
  );
}

export function MandateView() {
  const account = useCurrentAccount();
  const [mandate, setMandate] = useState<MandateDetails | null>(null);
  const [status, setStatus] = useState<"loading" | "found" | "none" | "error">("loading");

  useEffect(() => {
    if (!account) return;
    let cancelled = false;
    setStatus("loading");

    findMandateDetails(account.address, ENVOY_ADDRESS)
      .then((found) => {
        if (cancelled) return;
        setMandate(found);
        setStatus(found ? "found" : "none");
      })
      .catch(() => {
        if (!cancelled) setStatus("error");
      });

    return () => {
      cancelled = true;
    };
  }, [account]);

  if (status === "loading") {
    return (
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-10">
        <p className="text-sm text-manifest">Loading your Mandate…</p>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-10">
        <p className="text-sm text-wax">Couldn't load your Mandate right now. Try again shortly.</p>
      </div>
    );
  }

  if (status === "none" || !mandate) {
    return (
      <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-8 sm:px-6 sm:py-10">
        <div className="rounded-lg border border-dashed border-border py-16 text-center">
          <p className="text-manifest">No Mandate found for this account.</p>
        </div>
        <NewMandateForm onCreated={(created) => { setMandate(created); setStatus("found"); }} />
      </div>
    );
  }

  const remaining = mandate.maxSpendMist - mandate.spentSoFarMist;
  const spentFraction = mandate.maxSpendMist > 0n ? Number(mandate.spentSoFarMist) / Number(mandate.maxSpendMist) : 0;
  const expiresDate = new Date(mandate.expiresAtMs);
  const isExpired = mandate.expiresAtMs < Date.now();

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-8 sm:px-6 sm:py-10">
      <div className="rounded-lg border border-border p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm text-manifest">Envoy's authorized spend</p>
            <p className="mt-1 text-3xl font-semibold tracking-tight text-vellum">
              {formatSui(mandate.spentSoFarMist)}
              <span className="text-lg font-normal text-manifest"> / {formatSui(mandate.maxSpendMist)}</span>
            </p>
          </div>
          <span
            className={`rounded-full border px-2.5 py-1 text-xs ${
              isExpired ? "border-wax text-wax" : "border-border text-manifest"
            }`}
          >
            {isExpired ? "Expired" : "Active"}
          </span>
        </div>

        <div className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-surface">
          <div
            className="h-full rounded-full bg-accent transition-[width]"
            style={{ width: `${Math.min(100, spentFraction * 100)}%` }}
          />
        </div>
        <p className="mt-2 text-sm text-manifest">{formatSui(remaining)} remaining</p>

        <div className="mt-4 flex items-center justify-between border-t border-border pt-3">
          <span className="text-xs text-manifest">Mandate ID</span>
          <MandateIdCopy mandateId={mandate.mandateId} />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="rounded-lg border border-border p-5">
          <p className="text-sm text-manifest">Funded balance</p>
          <p className="mt-1 font-data text-lg text-vellum">{formatSui(mandate.fundsMist)}</p>
          <p className="mt-1 text-xs text-manifest">Custodied in the Mandate, not Envoy's own wallet</p>
        </div>
        <div className="rounded-lg border border-border p-5">
          <p className="text-sm text-manifest">Expires</p>
          <p className="mt-1 font-data text-lg text-vellum">
            {expiresDate.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })}
          </p>
          <p className="mt-1 text-xs text-manifest">{isExpired ? "Expired" : "Still valid"}</p>
        </div>
      </div>

      <div className="rounded-lg border border-border p-5">
        <p className="text-sm text-manifest">Allowed categories</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {mandate.allowedCategories.map((category) => (
            <span key={category} className="rounded-full border border-border px-2.5 py-1 text-xs text-vellum">
              {category}
            </span>
          ))}
        </div>
      </div>

      <NewMandateForm onCreated={(created) => setMandate(created)} />
    </div>
  );
}
