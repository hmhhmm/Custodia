// Specialist inbox — the real counterparty side of a Deal. A connected
// wallet (already registered via SpecialistOnboarding) sees every Deal
// naming their own AgentIdentity as specialist_agent and can accept() /
// mark_delivered() with their own signature — replacing orchestrator.ts's
// old fixed specialistKeypair path entirely for any deal picked up here.
//
// The deliverable is real text the specialist types themselves, not
// scriptedDeliverable's template — Seal-encrypted and stored on Walrus
// exactly like the client side already does for its own writes.

import { useEffect, useState } from "react";
import { useCurrentAccount, useDAppKit } from "@mysten/dapp-kit-react";
import { findOwnedAgentIdentities } from "../sui/onboarding-status";
import { findDealsForSpecialist, findAllowlistForDeal, type SpecialistDeal } from "../sui/deal-queries";
import { buildAcceptDealTx } from "../sui/ptb-accept";
import { buildMarkDeliveredTx } from "../sui/ptb-deliver";
import { encryptDealContent } from "../verification/seal";
import { storeBlob } from "../verification/walrus";
import { mockNautilusAttest } from "../verification/nautilus.mock";
import type { RegisteredAgent } from "../sui/ptb-register-agent";

function mistToSui(mist: bigint): string {
  return `${(Number(mist) / 1_000_000_000).toLocaleString(undefined, { maximumFractionDigits: 4 })} SUI`;
}

// Same limit as ChatPanel's own attachment cap — keeps both upload paths
// consistent and comfortably under Walrus publisher's ~10 MiB per-request
// rate limit (see verification/walrus.ts's header note).
const MAX_FILE_BYTES = 10 * 1024 * 1024;

// The specialist doesn't take any action once a deal reaches Released —
// the client's release is a transaction the specialist never signs and
// isn't notified of, so without polling this list would show "Delivered,
// waiting on the client" forever even after being paid, until the
// specialist happened to reload the page.
const POLL_INTERVAL_MS = 6000;

interface InboxDeal {
  deal: SpecialistDeal;
  specialistAgentId: string;
}

export function SpecialistInbox() {
  const account = useCurrentAccount();

  const [agents, setAgents] = useState<RegisteredAgent[] | "loading">("loading");
  const [deals, setDeals] = useState<InboxDeal[]>([]);
  const [dealsStatus, setDealsStatus] = useState<"loading" | "ready" | "error">("loading");
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (!account) return;
    let cancelled = false;
    setAgents("loading");

    // A wallet can own several AgentIdentities (registered under different
    // categories, or re-registered across test runs) — querying only the
    // first one found silently hid deals matched to any OTHER identity
    // this same wallet owns. Every owned identity must be checked.
    findOwnedAgentIdentities(account.address)
      .then((found) => {
        if (cancelled) return;
        setAgents(found);
      })
      .catch(() => {
        if (!cancelled) setAgents([]);
      });

    return () => {
      cancelled = true;
    };
  }, [account]);

  useEffect(() => {
    if (agents === "loading") return;
    if (agents.length === 0) {
      setDeals([]);
      setDealsStatus("ready");
      return;
    }
    let cancelled = false;
    setDealsStatus("loading");

    function load() {
      return Promise.all(
        agents === "loading"
          ? []
          : agents.map((a) =>
              findDealsForSpecialist(a.agentId).then((found) => found.map((deal) => ({ deal, specialistAgentId: a.agentId }))),
            ),
      )
        .then((results) => {
          if (cancelled) return;
          const flat = results.flat().sort((a, b) => b.deal.stageDeadlineMs - a.deal.stageDeadlineMs);
          setDeals(flat);
          setDealsStatus("ready");
        })
        .catch(() => {
          if (!cancelled) setDealsStatus("error");
        });
    }

    load();
    const interval = setInterval(load, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [agents, refreshKey]);

  if (!account) {
    return <p className="text-sm text-manifest">Connect a wallet to view your specialist inbox.</p>;
  }

  if (agents === "loading") {
    return <p className="text-sm text-manifest">Checking this account…</p>;
  }

  if (agents.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border py-16 text-center">
        <p className="text-manifest">This wallet isn't registered as a specialist yet.</p>
        <p className="mt-2 text-sm text-manifest">Register above first.</p>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-xl font-semibold tracking-tight text-vellum">Specialist inbox</h2>
        <p className="mt-2 max-w-2xl text-sm text-manifest">
          Deals naming this account's AgentIdentity as specialist. Accept and deliver are signed by this
          connected wallet, not a shared demo key.
        </p>
      </div>

      {dealsStatus === "ready" && deals.length > 0 && <EarningsSummary deals={deals.map((d) => d.deal)} />}

      {dealsStatus === "loading" && <p className="text-sm text-manifest">Loading deals…</p>}
      {dealsStatus === "error" && <p className="text-sm text-wax">Couldn't load deals right now. Try again shortly.</p>}

      {dealsStatus === "ready" && deals.length === 0 && (
        <div className="rounded-xl border border-dashed border-border py-16 text-center">
          <p className="text-manifest">No deals yet. Ask a client to send a request naming your category.</p>
        </div>
      )}

      {dealsStatus === "ready" && deals.length > 0 && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {deals.map(({ deal, specialistAgentId }) => (
            <DealCard
              key={deal.dealId}
              deal={deal}
              specialistAgentId={specialistAgentId}
              onChanged={() => setRefreshKey((k) => k + 1)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/** Sums escrowed_amount across every deal this wallet has actually been
 * PAID for — Released or Settled only (the on-chain fact that
 * verify_and_release/claim_release/settle_default actually transferred
 * funds to this specialist's owner address). A Delivered-but-not-yet-
 * released deal is not yet earned; counting it here would overstate real
 * income before the money has actually moved. */
function EarningsSummary({ deals }: { deals: SpecialistDeal[] }) {
  const paid = deals.filter((d) => d.status === "Released" || d.status === "Settled");
  const totalMist = paid.reduce((sum, d) => sum + d.escrowedAmountMist, 0n);
  const pendingMist = deals
    .filter((d) => d.status !== "Released" && d.status !== "Settled" && d.status !== "Refunded" && d.status !== "Disputed")
    .reduce((sum, d) => sum + d.escrowedAmountMist, 0n);

  return (
    <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
      <div className="rounded-xl border border-border bg-surface p-5">
        <p className="text-xs uppercase tracking-wide text-manifest">Total earned</p>
        <p className="mt-1.5 text-2xl font-semibold tracking-tight text-emerald-400">{mistToSui(totalMist)}</p>
        <p className="mt-1 text-xs text-manifest">
          From {paid.length} released {paid.length === 1 ? "deal" : "deals"}
        </p>
      </div>
      <div className="rounded-xl border border-border bg-surface p-5">
        <p className="text-xs uppercase tracking-wide text-manifest">In progress</p>
        <p className="mt-1.5 text-2xl font-semibold tracking-tight text-vellum">{mistToSui(pendingMist)}</p>
        <p className="mt-1 text-xs text-manifest">Escrowed, not yet released</p>
      </div>
      <div className="rounded-xl border border-border bg-surface p-5">
        <p className="text-xs uppercase tracking-wide text-manifest">Total deals</p>
        <p className="mt-1.5 text-2xl font-semibold tracking-tight text-vellum">{deals.length}</p>
        <p className="mt-1 text-xs text-manifest">Across every category registered</p>
      </div>
    </div>
  );
}

function DealCard({
  deal,
  specialistAgentId,
  onChanged,
}: {
  deal: SpecialistDeal;
  specialistAgentId: string;
  onChanged: () => void;
}) {
  const dAppKit = useDAppKit();
  const [deliverable, setDeliverable] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file
    if (!selected) return;
    setError(null);
    if (selected.size > MAX_FILE_BYTES) {
      setError(`${selected.name} is too large — ${MAX_FILE_BYTES / (1024 * 1024)}MB max.`);
      return;
    }
    setFile(selected);
  }

  async function handleAccept() {
    setBusy(true);
    setError(null);
    try {
      const tx = buildAcceptDealTx({
        dealId: deal.dealId,
        specialistAgentIdentityId: specialistAgentId,
        deliveryDeadlineMs: BigInt(deal.stageDeadlineMs),
        amount: deal.escrowedAmountMist,
      });
      const result = await dAppKit.signAndExecuteTransaction({ transaction: tx });
      if (result.FailedTransaction) {
        throw new Error(result.FailedTransaction.status.error?.message ?? "accept() failed");
      }
      await dAppKit.getClient().core.waitForTransaction({ result });
      onChanged();
    } catch (err) {
      console.error("accept() failed:", err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleDeliver() {
    if (!deliverable.trim() && !file) {
      setError("Write the deliverable or attach a file before marking this delivered.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      // Deal-scoped Seal encryption requires the Deal's own DealAllowlist
      // — created by the client side right after escrow lock (see
      // orchestrator.ts's buildCreateDealAllowlistTx step).
      const allowlistId = await findAllowlistForDeal(deal.dealId);
      if (!allowlistId) {
        throw new Error("No DealAllowlist found for this deal yet — the client's escrow-lock step may not have finished.");
      }

      const textContent = new TextEncoder().encode(deliverable || `(no written notes — see attached file: ${file?.name})`);
      const encryptedText = await encryptDealContent(textContent, dAppKit.getClient(), allowlistId);
      const storedText = await storeBlob(encryptedText.encryptedObject);

      // The file, if attached, is a SEPARATE encrypted blob under the same
      // allowlist — its own random Seal nonce, so it can't be swapped for
      // the text blob's ciphertext or vice versa.
      let fileExtra: { blobId: string; seedId: string; name: string; mimeType: string } | undefined;
      if (file) {
        const fileBytes = new Uint8Array(await file.arrayBuffer());
        const encryptedFile = await encryptDealContent(fileBytes, dAppKit.getClient(), allowlistId);
        const storedFile = await storeBlob(encryptedFile.encryptedObject);
        fileExtra = {
          blobId: storedFile.blobId,
          seedId: encryptedFile.seedId,
          name: file.name,
          mimeType: file.type || "application/octet-stream",
        };
      }

      const attestation = await mockNautilusAttest(deal.dealId, textContent);

      const tx = buildMarkDeliveredTx({
        dealId: deal.dealId,
        specialistAgentIdentityId: specialistAgentId,
        storageId: storedText.blobId,
        attestationId: attestation.attestationId,
        extra: { v: 1, sealSeedId: encryptedText.seedId, file: fileExtra },
      });
      const result = await dAppKit.signAndExecuteTransaction({ transaction: tx });
      if (result.FailedTransaction) {
        throw new Error(result.FailedTransaction.status.error?.message ?? "mark_delivered() failed");
      }
      await dAppKit.getClient().core.waitForTransaction({ result });
      onChanged();
    } catch (err) {
      console.error("mark_delivered() failed:", err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const statusTone: Record<string, string> = {
    Escrowed: "border-border text-manifest",
    Accepted: "border-accent/40 text-accent",
    Delivered: "border-emerald-500/40 text-emerald-400",
    Verified: "border-emerald-500/40 text-emerald-400",
    Released: "border-emerald-500/40 text-emerald-400",
  };

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface">
      <div className="flex items-start justify-between gap-4 p-5">
        <div className="min-w-0">
          <p className="truncate font-data text-xs text-manifest">{deal.dealId}</p>
          <p className="mt-1.5 text-2xl font-semibold tracking-tight text-vellum">{mistToSui(deal.escrowedAmountMist)}</p>
        </div>
        <span className={`shrink-0 rounded-full border px-2.5 py-1 text-xs ${statusTone[deal.status] ?? "border-border text-manifest"}`}>
          {deal.status}
        </span>
      </div>

      {deal.status === "Escrowed" && (
        <div className="border-t border-border p-5">
          <p className="text-sm text-manifest">Accept this deal to start work — this signs with your connected wallet.</p>
          <button
            type="button"
            onClick={handleAccept}
            disabled={busy}
            className="mt-3 rounded-md bg-white px-4 py-2 text-sm font-medium text-black transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? "Accepting…" : "Accept deal"}
          </button>
        </div>
      )}

      {deal.status === "Accepted" && (
        <div className="border-t border-border p-5">
          <label className="text-sm font-medium text-vellum" htmlFor={`deliverable-${deal.dealId}`}>
            Deliverable
          </label>
          <p className="mt-1 text-xs text-manifest">Seal-encrypted and stored on Walrus — only the client can decrypt it.</p>
          <textarea
            id={`deliverable-${deal.dealId}`}
            value={deliverable}
            onChange={(e) => setDeliverable(e.target.value)}
            disabled={busy}
            rows={5}
            placeholder="Write the real completed work here…"
            className="mt-3 w-full rounded-lg border border-border bg-ink px-3.5 py-3 text-sm text-vellum placeholder:text-manifest focus:border-accent focus:outline-none disabled:opacity-40"
          />

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <label className="flex cursor-pointer items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs text-vellum transition-colors hover:border-white/30">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21.44 11.05l-9.19 9.19a5.5 5.5 0 0 1-7.78-7.78l9.2-9.19a3.5 3.5 0 0 1 4.95 4.95l-9.2 9.19a1.5 1.5 0 0 1-2.12-2.12l8.49-8.48" />
              </svg>
              {file ? "Change file" : "Attach a file"}
              <input type="file" onChange={handleFileSelect} disabled={busy} className="hidden" />
            </label>
            {file && (
              <span className="flex items-center gap-2 rounded-md bg-surface-hover px-2.5 py-1.5 text-xs text-vellum">
                <span className="max-w-40 truncate">{file.name}</span>
                <button
                  type="button"
                  onClick={() => setFile(null)}
                  disabled={busy}
                  className="text-manifest hover:text-vellum"
                  aria-label="Remove attached file"
                >
                  ✕
                </button>
              </span>
            )}
          </div>

          <button
            type="button"
            onClick={handleDeliver}
            disabled={busy}
            className="mt-4 rounded-md bg-white px-4 py-2 text-sm font-medium text-black transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? "Delivering…" : "Mark delivered"}
          </button>
        </div>
      )}

      {(deal.status === "Delivered" || deal.status === "Verified") && (
        <div className="border-t border-border p-5">
          <p className="flex items-center gap-2 text-sm text-vellum">
            <span className="text-emerald-500">✓</span>
            Delivered
          </p>
          <p className="mt-1 text-sm text-manifest">Waiting on the client to verify and release payment.</p>
        </div>
      )}

      {(deal.status === "Released" || deal.status === "Settled") && (
        <div className="border-t border-border p-5">
          <p className="flex items-center gap-2 text-sm text-vellum">
            <span className="text-emerald-500">✓</span>
            Paid
          </p>
          <p className="mt-1 text-sm text-manifest">
            The client released {mistToSui(deal.escrowedAmountMist)} to your connected wallet.
          </p>
        </div>
      )}

      {(deal.status === "Disputed" || deal.status === "Refunded") && (
        <div className="border-t border-border p-5">
          <p className="text-sm text-vellum">{deal.status}</p>
          <p className="mt-1 text-sm text-manifest">
            {deal.status === "Disputed"
              ? "The client raised a dispute — awaiting resolution."
              : "This deal was refunded back to the client's Mandate."}
          </p>
        </div>
      )}

      {error && <p className="border-t border-border px-5 py-3 text-sm text-wax">{error}</p>}
    </div>
  );
}
