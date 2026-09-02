// Mandate tab — the real, previously-nowhere-visible on-chain state of
// what Envoy is authorized to spend. Replaces the old "History" nav tab,
// which had no real content behind it (Dashboard never filtered by it).

import { useEffect, useState } from "react";
import { useCurrentAccount } from "@mysten/dapp-kit-react";
import { findMandateDetails, type MandateDetails } from "../sui/onboarding-status";
import { ENVOY_ADDRESS } from "../sui/envoy-signer";

function mistToSui(mist: bigint): number {
  return Number(mist) / 1_000_000_000;
}

function formatSui(mist: bigint): string {
  return `${mistToSui(mist).toLocaleString(undefined, { maximumFractionDigits: 4 })} SUI`;
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
    return <p className="text-sm text-manifest">Loading your Mandate…</p>;
  }

  if (status === "error") {
    return <p className="text-sm text-wax">Couldn't load your Mandate right now. Try again shortly.</p>;
  }

  if (status === "none" || !mandate) {
    return (
      <div className="rounded-lg border border-dashed border-border py-16 text-center">
        <p className="text-manifest">No Mandate found for this account.</p>
      </div>
    );
  }

  const remaining = mandate.maxSpendMist - mandate.spentSoFarMist;
  const spentFraction = mandate.maxSpendMist > 0n ? Number(mandate.spentSoFarMist) / Number(mandate.maxSpendMist) : 0;
  const expiresDate = new Date(mandate.expiresAtMs);
  const isExpired = mandate.expiresAtMs < Date.now();

  return (
    <div className="flex flex-col gap-4">
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
          <p className="mt-1 text-xs text-manifest">{isExpired ? "This Mandate has expired" : "Still valid"}</p>
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

      <p className="font-data text-xs text-manifest">Mandate ID: {mandate.mandateId}</p>
    </div>
  );
}
