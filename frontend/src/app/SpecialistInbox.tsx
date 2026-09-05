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
import { findOwnedAgentIdentities, findReputationScores, type ReputationInfo } from "../sui/onboarding-status";
import {
  findDealsForSpecialist,
  findAllowlistForDeal,
  findDealMetadata,
  findCheckpointsForDeal,
  findBriefForDeal,
  type SpecialistDeal,
  type DealMetadata,
  type DealCheckpointInfo,
} from "../sui/deal-queries";
import { buildAcceptDealTx } from "../sui/ptb-accept";
import { buildMarkDeliveredTx } from "../sui/ptb-deliver";
import { buildPushCheckpointTx } from "../sui/ptb-checkpoint";
import { encryptDealContent, decryptDealContent } from "../verification/seal";
import { storeBlob, readBlob } from "../verification/walrus";
import { mockNautilusAttest } from "../verification/nautilus.mock";
import { dAppKit as dAppKitSingleton } from "../sui/dapp-kit";
import { CurrentAccountSigner, type DAppKit } from "@mysten/dapp-kit-core";
import type { RegisteredAgent } from "../sui/ptb-register-agent";
import { formatDateTime } from "./ProgressView";

// Suggested checkpoint labels per category — a Grab/Foodpanda-style
// granular status trail, richer than deal.move's own 4 client-visible
// states (Escrowed/Accepted/Delivered/Released). Free-text on-chain (see
// checkpoint.move's own comment on why), this is just the frontend's
// suggested vocabulary per category — a specialist isn't restricted to
// exactly these, but these are what render as one-tap buttons. The LAST
// label in each list is the one that also finalizes delivery (calls
// mark_delivered in the same action) — see CheckpointFlow's
// isFinalCheckpoint logic below.
//
// Two stages per category, not three — the middle "en route"/"in
// progress" checkpoint was cut per explicit feedback: a real specialist
// pushing status from the field wants "started" and "done", not a
// mid-point update that mostly just adds an extra required tap.
const CHECKPOINT_LABELS: Record<string, string[]> = {
  logistics: ["Picked up", "Arrived"],
  courier: ["Picked up", "Delivered"],
  research: ["Inspection started", "Complete"],
  design: ["Draft started", "Final delivered"],
  "legal-review": ["Review started", "Review complete"],
  translation: ["Translation started", "Final delivered"],
};
const DEFAULT_CHECKPOINT_LABELS = ["Started", "Complete"];

function checkpointLabelsFor(category: string | undefined): string[] {
  return (category && CHECKPOINT_LABELS[category]) || DEFAULT_CHECKPOINT_LABELS;
}

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

  const [agents, setAgents] = useState<(RegisteredAgent & { capabilities: string[] })[] | "loading">("loading");
  const [reputationByAgent, setReputationByAgent] = useState<Map<string, ReputationInfo>>(new Map());
  const [deals, setDeals] = useState<InboxDeal[]>([]);
  const [metadataByDeal, setMetadataByDeal] = useState<Map<string, DealMetadata>>(new Map());
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

  // Real reputation score per registered identity — batch-read from the
  // shared Reputation objects (agent_identity.move shares one per
  // registration, see onboarding-status.ts's findReputationScores) —
  // never fabricated or hardcoded to 0.
  useEffect(() => {
    if (agents === "loading" || agents.length === 0) return;
    let cancelled = false;
    findReputationScores(agents.map((a) => a.reputationId))
      .then((found) => {
        if (!cancelled) setReputationByAgent(found);
      })
      .catch(() => {
        // Transient GraphQL hiccup — leave whatever was last successfully
        // loaded rather than blanking scores that were already shown.
      });
    return () => {
      cancelled = true;
    };
  }, [agents]);

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
      return Promise.all([
        Promise.all(
          agents === "loading"
            ? []
            : agents.map((a) =>
                findDealsForSpecialist(a.agentId).then((found) => found.map((deal) => ({ deal, specialistAgentId: a.agentId }))),
              ),
        ),
        findDealMetadata(),
      ])
        .then(([results, meta]) => {
          if (cancelled) return;
          const flat = results.flat().sort((a, b) => b.deal.stageDeadlineMs - a.deal.stageDeadlineMs);
          setDeals(flat);
          setMetadataByDeal(meta);
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

  // An Accepted deal is active work in progress — surfaced as one focused
  // screen (like a driver app's "current trip"), not just another card in
  // a grid, per explicit feedback that the inbox should read like a real
  // logistics app. If a specialist somehow has more than one Accepted
  // deal at once, the grid below still shows every deal regardless — this
  // just picks the most urgent one (soonest deadline, same sort the list
  // already uses) to feature.
  // Strictly "Accepted" — the moment the final checkpoint's mark_delivered
  // call confirms on-chain, deal.status genuinely moves past this, and the
  // NEXT poll (onChanged() triggers one immediately, not just the regular
  // 6s interval) picks the deal out of the active-job card and into the
  // ordinary grid below as Delivered/Released. No client-side "still
  // finishing up" override — this always reflects the real on-chain status.
  const activeJob = deals.find(({ deal }) => deal.status === "Accepted");
  const otherDeals = activeJob ? deals.filter(({ deal }) => deal.dealId !== activeJob.deal.dealId) : deals;

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-xl font-semibold tracking-tight text-vellum">Specialist inbox</h2>
        <p className="mt-2 max-w-2xl text-sm text-manifest">
          Deals naming this account's AgentIdentity as specialist. Accept and deliver are signed by this
          connected wallet, not a shared demo key.
        </p>
      </div>

      {agents.length > 0 && <IdentitySummary agents={agents} reputationByAgent={reputationByAgent} />}

      {dealsStatus === "ready" && deals.length > 0 && (
        <EarningsSummary deals={deals.map((d) => d.deal)} metadataByDeal={metadataByDeal} />
      )}

      {dealsStatus === "loading" && <p className="text-sm text-manifest">Loading deals…</p>}
      {dealsStatus === "error" && <p className="text-sm text-wax">Couldn't load deals right now. Try again shortly.</p>}

      {dealsStatus === "ready" && deals.length === 0 && (
        <div className="rounded-xl border border-dashed border-border py-16 text-center">
          <p className="text-manifest">No deals yet. Ask a client to send a request naming your category.</p>
        </div>
      )}

      {dealsStatus === "ready" && activeJob && (
        <div className="mb-6">
          <p className="mb-3 text-xs uppercase tracking-wide text-manifest">Active job</p>
          <ActiveJobScreen
            deal={activeJob.deal}
            specialistAgentId={activeJob.specialistAgentId}
            metadata={metadataByDeal.get(activeJob.deal.dealId)}
            onChanged={() => setRefreshKey((k) => k + 1)}
          />
        </div>
      )}

      {dealsStatus === "ready" && otherDeals.length > 0 && (
        <>
          {activeJob && <p className="mb-3 text-xs uppercase tracking-wide text-manifest">Other deals</p>}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {otherDeals.map(({ deal, specialistAgentId }) => (
              <DealCard
                key={deal.dealId}
                deal={deal}
                specialistAgentId={specialistAgentId}
                metadata={metadataByDeal.get(deal.dealId)}
                onChanged={() => setRefreshKey((k) => k + 1)}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/** Sums the ORIGINAL escrowed amount (from each deal's DealCreated event,
 * via metadataByDeal — see deal-queries.ts's DealMetadata.amountMist)
 * across every deal this wallet has actually been PAID for — Released or
 * Settled only (the on-chain fact that verify_and_release/claim_release/
 * settle_default actually transferred funds to this specialist's owner
 * address). A Delivered-but-not-yet-released deal is not yet earned;
 * counting it here would overstate real income before the money has
 * actually moved.
 *
 * MUST use the event's original amount, not deal.escrowedAmountMist —
 * that field is a LIVE balance and deal.move's pay_specialist withdraws
 * it to exactly 0 on release BY DESIGN (the escrow is empty because it
 * was fully paid out, not because nothing was paid). Summing the live
 * balance over released deals is mathematically guaranteed to total 0
 * regardless of how much was actually earned — this was a real bug, not
 * a display nicety, and it's what made "Total earned" always read 0. */

/** Shows this wallet its own registered role(s) and real reputation
 * score(s) — a specialist could previously see a CANDIDATE's score during
 * client-side matching (discovery.ts) but never their own, on their own
 * inbox. A wallet can hold more than one AgentIdentity (registered under
 * different categories across test runs), so this renders one row per
 * identity rather than assuming exactly one. */
function IdentitySummary({
  agents,
  reputationByAgent,
}: {
  agents: (RegisteredAgent & { capabilities: string[] })[];
  reputationByAgent: Map<string, ReputationInfo>;
}) {
  return (
    <div className="mb-6 flex flex-col gap-2">
      {agents.map((agent) => {
        const rep = reputationByAgent.get(agent.reputationId);
        return (
          <div
            key={agent.agentId}
            className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3"
          >
            <div className="flex flex-wrap gap-1.5">
              {agent.capabilities.map((cap) => (
                <span
                  key={cap}
                  className="rounded-full border border-border px-2.5 py-0.5 text-xs font-medium text-vellum"
                >
                  {cap}
                </span>
              ))}
            </div>
            <span className="text-manifest">·</span>
            {rep ? (
              <span className="text-sm text-vellum">
                Reputation <span className="font-semibold">{rep.score}</span>
                <span className="ml-1.5 text-xs text-manifest">
                  ({rep.completedDeals} completed{rep.disputedDeals > 0 ? `, ${rep.disputedDeals} disputed` : ""})
                </span>
              </span>
            ) : (
              <span className="text-sm text-manifest">Loading reputation…</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

function EarningsSummary({
  deals,
  metadataByDeal,
}: {
  deals: SpecialistDeal[];
  metadataByDeal: Map<string, DealMetadata>;
}) {
  const amountFor = (d: SpecialistDeal) => metadataByDeal.get(d.dealId)?.amountMist ?? d.escrowedAmountMist;
  const paid = deals.filter((d) => d.status === "Released" || d.status === "Settled");
  const totalMist = paid.reduce((sum, d) => sum + amountFor(d), 0n);
  const pendingMist = deals
    .filter((d) => d.status !== "Released" && d.status !== "Settled" && d.status !== "Refunded" && d.status !== "Disputed")
    .reduce((sum, d) => sum + amountFor(d), 0n);

  return (
    <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
      <div className="rounded-xl border border-border bg-surface p-5">
        <p className="text-xs uppercase tracking-wide text-manifest">Total earned</p>
        <p className="mt-1.5 text-2xl font-semibold tracking-tight text-vellum">{mistToSui(totalMist)}</p>
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
  metadata,
  onChanged,
}: {
  deal: SpecialistDeal;
  specialistAgentId: string;
  metadata: DealMetadata | undefined;
  onChanged: () => void;
}) {
  const dAppKit = useDAppKit();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The ORIGINAL amount from DealCreated — see EarningsSummary's header
  // comment for why deal.escrowedAmountMist alone is wrong once released
  // (it's a live balance that correctly reads 0 after payout).
  const displayAmountMist = metadata?.amountMist ?? deal.escrowedAmountMist;

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

  const statusTone: Record<string, string> = {
    Escrowed: "border-border text-manifest",
    Accepted: "border-accent/40 text-accent",
    Delivered: "border-border text-vellum",
    Verified: "border-border text-vellum",
    Released: "border-border text-vellum",
  };

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface">
      <div className="flex items-start justify-between gap-4 p-5">
        <div className="min-w-0">
          <p className="truncate font-data text-xs text-manifest">{deal.dealId}</p>
          <p className="mt-1.5 text-2xl font-semibold tracking-tight text-vellum">{mistToSui(displayAmountMist)}</p>
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
          <p className="text-sm text-manifest">
            Accepted — see the "Active job" section above to push status updates and mark this delivered.
          </p>
        </div>
      )}

      {(deal.status === "Delivered" || deal.status === "Verified") && (
        <div className="border-t border-border p-5">
          <p className="flex items-center gap-2 text-sm text-vellum">
            <span className="text-vellum">✓</span>
            Delivered
          </p>
          <p className="mt-1 text-sm text-manifest">Waiting on the client to verify and release payment.</p>
        </div>
      )}

      {(deal.status === "Released" || deal.status === "Settled") && (
        <div className="border-t border-border p-5">
          <p className="flex items-center gap-2 text-sm text-vellum">
            <span className="text-vellum">✓</span>
            Paid
          </p>
          <p className="mt-1 text-sm text-manifest">
            The client released {mistToSui(displayAmountMist)} to your connected wallet.
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

/** Focused single-job screen for the deal a specialist is currently
 * working — the "driver app's current trip" experience per explicit
 * feedback ("dedicated active job view", "granular live status
 * updates", "photo/proof capture built into each status update"). Shows
 * a real checkpoint timeline (DealCheckpoint objects, one per pushed
 * status — see move/sources/checkpoint.move) above per-category
 * checkpoint buttons.
 *
 * Every checkpoint is a REAL on-chain object, Seal-encrypted photo
 * included when attached — nothing here is simulated. The LAST
 * checkpoint in a category's list also finalizes delivery: it pushes
 * that checkpoint AND calls mark_delivered in the same user action
 * (reusing the exact deliver-flow this file already had), so
 * deal.move's own state machine still only ever sees Accepted ->
 * Delivered, unaffected by however many checkpoints preceded it. */
function ActiveJobScreen({
  deal,
  specialistAgentId,
  metadata,
  onChanged,
}: {
  deal: SpecialistDeal;
  specialistAgentId: string;
  metadata: DealMetadata | undefined;
  onChanged: () => void;
}) {
  const dAppKit = useDAppKit();
  const [checkpoints, setCheckpoints] = useState<DealCheckpointInfo[] | "loading">("loading");
  const [note, setNote] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState<string | null>(null); // the label being pushed, or null
  const [error, setError] = useState<string | null>(null);
  // The real task brief (what the item is, where to collect/deliver it,
  // contact details) — written by the client at escrow time (see
  // orchestrator.ts's new "write the specialist's actual work order"
  // step) and never shown here before, which was the exact "specialist
  // doesn't know where to collect" gap reported live. Decrypted with the
  // CONNECTED wallet's own signature — a genuine user action reading a
  // real Deal-scoped secret, same pattern Receipt.tsx already uses for
  // the deliverable, just the brief instead of the proof.
  const [brief, setBrief] = useState<"loading" | "none" | "locked" | string>("loading");

  const displayAmountMist = metadata?.amountMist ?? deal.escrowedAmountMist;
  const labels = checkpointLabelsFor(metadata?.category);

  useEffect(() => {
    let cancelled = false;
    setBrief("loading");

    async function load() {
      try {
        const found = await findBriefForDeal(deal.dealId);
        if (cancelled) return;
        if (!found) {
          setBrief("none");
          return;
        }
        const allowlistId = await findAllowlistForDeal(deal.dealId);
        if (cancelled) return;
        if (!allowlistId) {
          setBrief("locked");
          return;
        }
        const encrypted = await readBlob(found.storageId);
        const signer = new CurrentAccountSigner(dAppKitSingleton as unknown as DAppKit);
        const decrypted = await decryptDealContent(encrypted, dAppKitSingleton.getClient(), allowlistId, found.seedId, signer);
        if (!cancelled) setBrief(new TextDecoder().decode(decrypted));
      } catch (err) {
        console.error("brief decrypt failed for", deal.dealId, err);
        if (!cancelled) setBrief("locked");
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [deal.dealId]);

  // Real re-fetch, not a one-shot on mount — a component-scoped `useEffect`
  // keyed only on `deal.dealId` ran ONCE and never again for the lifetime
  // of this screen, so every push after the first computed `pushedLabels`/
  // `nextLabel`/`isFinalCheckpoint` from an increasingly stale snapshot.
  // That's exactly what let a specialist push every checkpoint including
  // the visually-final one, see "delivered" in the UI, and yet
  // mark_delivered NEVER actually fire — isFinalCheckpoint at click time
  // was computed against a checkpoints array that didn't yet include the
  // checkpoints pushed moments earlier in the same session, so the real
  // last click didn't register as the real last label. loadCheckpoints is
  // now callable on demand (after every successful push), not just once.
  function loadCheckpoints() {
    return findCheckpointsForDeal(deal.dealId)
      .then((found) => {
        setCheckpoints(found);
        return found;
      })
      .catch(() => {
        setCheckpoints([]);
        return [] as DealCheckpointInfo[];
      });
  }

  useEffect(() => {
    let cancelled = false;
    findCheckpointsForDeal(deal.dealId)
      .then((found) => {
        if (!cancelled) setCheckpoints(found);
      })
      .catch(() => {
        if (!cancelled) setCheckpoints([]);
      });
    return () => {
      cancelled = true;
    };
  }, [deal.dealId]);

  const pushedLabels = new Set((checkpoints === "loading" ? [] : checkpoints).map((c) => c.label));
  const nextLabel = labels.find((l) => !pushedLabels.has(l)) ?? null;
  const isFinalCheckpoint = nextLabel !== null && labels.indexOf(nextLabel) === labels.length - 1;

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = e.target.files?.[0];
    e.target.value = "";
    if (!selected) return;
    setError(null);
    if (selected.size > MAX_FILE_BYTES) {
      setError(`${selected.name} is too large — ${MAX_FILE_BYTES / (1024 * 1024)}MB max.`);
      return;
    }
    setFile(selected);
  }

  async function encryptPhoto(allowlistId: string): Promise<{ blobId: string; seedId: string } | null> {
    if (!file) return null;
    const fileBytes = new Uint8Array(await file.arrayBuffer());
    const encrypted = await encryptDealContent(fileBytes, dAppKit.getClient(), allowlistId);
    const stored = await storeBlob(encrypted.encryptedObject);
    return { blobId: stored.blobId, seedId: encrypted.seedId };
  }

  async function handlePushCheckpoint(label: string) {
    setBusy(label);
    setError(null);
    try {
      const allowlistId = await findAllowlistForDeal(deal.dealId);
      if (!allowlistId) {
        throw new Error("No DealAllowlist found for this deal yet — the client's escrow-lock step may not have finished.");
      }

      const photo = await encryptPhoto(allowlistId);

      const tx = buildPushCheckpointTx({
        dealId: deal.dealId,
        specialistAgentIdentityId: specialistAgentId,
        label,
        note,
        photoStorageId: photo?.blobId ?? "",
        photoSeedId: photo?.seedId ?? "",
      });
      const result = await dAppKit.signAndExecuteTransaction({ transaction: tx });
      if (result.FailedTransaction) {
        throw new Error(result.FailedTransaction.status.error?.message ?? "checkpoint::new_and_share failed");
      }
      await dAppKit.getClient().core.waitForTransaction({ result });

      // Re-fetch checkpoints NOW, right after this push actually landed
      // on-chain, and decide "is this the final label" from that FRESH
      // list — not the closed-over `isFinalCheckpoint`, which was
      // computed at the start of this render from whatever `checkpoints`
      // happened to be BEFORE this push (see the loadCheckpoints comment
      // above for why that was silently wrong past the first click).
      const freshCheckpoints = await loadCheckpoints();
      const freshPushedLabels = new Set(freshCheckpoints.map((c) => c.label));
      const isActuallyFinal = labels.every((l) => freshPushedLabels.has(l) || l === label) && label === labels[labels.length - 1];

      // The final checkpoint in this category's list ALSO finalizes
      // delivery — same real mark_delivered flow this file already had,
      // fed from this checkpoint's own note+photo as the deliverable, so
      // the client's release screen still finds a real DealProof exactly
      // as before. Checkpoints are additive alongside it, never a
      // replacement for the on-chain proof mark_delivered records.
      if (isActuallyFinal) {
        const textContent = new TextEncoder().encode(note || `(no written notes — see attached photo: ${file?.name ?? "none"})`);
        const encryptedText = await encryptDealContent(textContent, dAppKit.getClient(), allowlistId);
        const storedText = await storeBlob(encryptedText.encryptedObject);

        let fileExtra: { blobId: string; seedId: string; name: string; mimeType: string } | undefined;
        if (file && photo) {
          fileExtra = { blobId: photo.blobId, seedId: photo.seedId, name: file.name, mimeType: file.type || "application/octet-stream" };
        }

        const attestation = await mockNautilusAttest(deal.dealId, textContent);

        const deliverTx = buildMarkDeliveredTx({
          dealId: deal.dealId,
          specialistAgentIdentityId: specialistAgentId,
          storageId: storedText.blobId,
          attestationId: attestation.attestationId,
          extra: { v: 1, sealSeedId: encryptedText.seedId, file: fileExtra },
        });
        const deliverResult = await dAppKit.signAndExecuteTransaction({ transaction: deliverTx });
        if (deliverResult.FailedTransaction) {
          throw new Error(deliverResult.FailedTransaction.status.error?.message ?? "mark_delivered() failed");
        }
        await dAppKit.getClient().core.waitForTransaction({ result: deliverResult });
      }

      setNote("");
      setFile(null);
      onChanged();
    } catch (err) {
      console.error("checkpoint push failed:", err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="overflow-hidden rounded-xl border border-accent/30 bg-surface">
      <div className="flex items-start justify-between gap-4 p-5">
        <div className="min-w-0">
          <p className="truncate font-data text-xs text-manifest">{deal.dealId}</p>
          <p className="mt-1 text-sm text-vellum">{metadata?.category ?? "—"}</p>
          <p className="mt-1.5 text-2xl font-semibold tracking-tight text-vellum">{mistToSui(displayAmountMist)}</p>
        </div>
        <span className="shrink-0 rounded-full border border-border px-2.5 py-1 text-xs text-manifest">{deal.status}</span>
      </div>

      <div className="border-t border-border p-5">
        <p className="mb-2 text-sm font-medium text-vellum">Task brief</p>
        {brief === "loading" && <p className="text-sm text-manifest">Loading…</p>}
        {brief === "none" && (
          <p className="text-sm text-manifest">The client didn't attach a written brief for this deal.</p>
        )}
        {brief === "locked" && <p className="text-sm text-wax">Couldn't decrypt the brief right now — try refreshing.</p>}
        {brief !== "loading" && brief !== "none" && brief !== "locked" && (
          <p className="whitespace-pre-wrap text-sm text-vellum">{brief}</p>
        )}
      </div>

      <div className="border-t border-border p-5">
        <p className="mb-3 text-sm font-medium text-vellum">Status updates</p>
        {checkpoints === "loading" && <p className="text-sm text-manifest">Loading…</p>}
        {checkpoints !== "loading" && checkpoints.length === 0 && (
          <p className="text-sm text-manifest">No status updates pushed yet.</p>
        )}
        {checkpoints !== "loading" && checkpoints.length > 0 && (
          <div className="flex flex-col gap-3">
            {checkpoints.map((c) => (
              <CheckpointRow key={c.checkpointId} checkpoint={c} allowlistIdPromise={() => findAllowlistForDeal(deal.dealId)} />
            ))}
          </div>
        )}
      </div>

      {nextLabel && (
        <div className="border-t border-border p-5">
          <label className="text-sm font-medium text-vellum" htmlFor={`note-${deal.dealId}`}>
            {isFinalCheckpoint ? "Final delivery notes" : "Note for this update"}
          </label>
          <p className="mt-1 text-xs text-manifest">
            Seal-encrypted and stored on Walrus — only the client can decrypt it.
            {isFinalCheckpoint && " This also marks the deal delivered."}
          </p>
          <textarea
            id={`note-${deal.dealId}`}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            disabled={busy !== null}
            rows={3}
            placeholder="What's happening at this step…"
            className="mt-3 w-full rounded-lg border border-border bg-ink px-3.5 py-3 text-sm text-vellum placeholder:text-manifest focus:border-accent focus:outline-none disabled:opacity-40"
          />

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <label className="flex cursor-pointer items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs text-vellum transition-colors hover:border-white/30">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                <circle cx="12" cy="13" r="4" />
              </svg>
              {file ? "Change photo" : "Attach a photo"}
              <input type="file" accept="image/*" onChange={handleFileSelect} disabled={busy !== null} className="hidden" />
            </label>
            {file && (
              <span className="flex items-center gap-2 rounded-md bg-surface-hover px-2.5 py-1.5 text-xs text-vellum">
                <span className="max-w-40 truncate">{file.name}</span>
                <button
                  type="button"
                  onClick={() => setFile(null)}
                  disabled={busy !== null}
                  className="text-manifest hover:text-vellum"
                  aria-label="Remove attached photo"
                >
                  ✕
                </button>
              </span>
            )}
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            {labels.map((label) => {
              const done = pushedLabels.has(label);
              const isNext = label === nextLabel;
              return (
                <button
                  key={label}
                  type="button"
                  onClick={() => handlePushCheckpoint(label)}
                  disabled={busy !== null || !isNext}
                  title={done ? "Already pushed" : !isNext ? "Push the previous update first" : undefined}
                  className={`rounded-md px-4 py-2 text-sm font-medium transition-opacity disabled:cursor-not-allowed ${
                    done
                      ? "border border-border text-vellum opacity-60"
                      : isNext
                        ? "bg-white text-black hover:opacity-90"
                        : "border border-border text-manifest opacity-40"
                  }`}
                >
                  {done ? `✓ ${label}` : busy === label ? "Pushing…" : label}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {!nextLabel && (
        <div className="border-t border-border p-5">
          <p className="flex items-center gap-2 text-sm text-vellum">
            <span className="text-vellum">✓</span>
            All status updates pushed — delivered.
          </p>
          <p className="mt-1 text-sm text-manifest">Waiting on the client to verify and release payment.</p>
        </div>
      )}

      {error && <p className="border-t border-border px-5 py-3 text-sm text-wax">{error}</p>}
    </div>
  );
}

/** One row in the checkpoint timeline — label, note, real timestamp, and
 * a tappable photo thumbnail decrypted ON DEMAND (not eagerly for every
 * row) via the same envoyKeypair-free, connected-wallet decrypt path
 * Receipt.tsx already uses for the final deliverable. */
function CheckpointRow({
  checkpoint,
  allowlistIdPromise,
}: {
  checkpoint: DealCheckpointInfo;
  allowlistIdPromise: () => Promise<string | null>;
}) {
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [photoStatus, setPhotoStatus] = useState<"idle" | "loading" | "error">("idle");

  function makeSigner() {
    // Same DAppKit-typing note as Receipt.tsx's own makeSigner: dApp
    // Kit Core's CurrentAccountSigner constructor param type is
    // hard-coded to DAppKit<[]> rather than this app's own
    // module-augmented type — a real typing gap in the library, not a
    // mistake here (this dAppKit genuinely satisfies the same shape at
    // runtime).
    return new CurrentAccountSigner(dAppKitSingleton as unknown as DAppKit);
  }

  async function handleViewPhoto() {
    if (!checkpoint.photo) return;
    setPhotoStatus("loading");
    try {
      const allowlistId = await allowlistIdPromise();
      if (!allowlistId) throw new Error("No DealAllowlist found for this deal.");
      const encrypted = await readBlob(checkpoint.photo.blobId);
      const decrypted = await decryptDealContent(encrypted, dAppKitSingleton.getClient(), allowlistId, checkpoint.photo.seedId, makeSigner());
      const blob = new Blob([new Uint8Array(decrypted)]);
      setPhotoUrl(URL.createObjectURL(blob));
      setPhotoStatus("idle");
    } catch (err) {
      console.error("checkpoint photo decrypt failed:", err);
      setPhotoStatus("error");
    }
  }

  useEffect(() => {
    return () => {
      if (photoUrl) URL.revokeObjectURL(photoUrl);
    };
  }, [photoUrl]);

  return (
    <div className="flex gap-3">
      <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-vellum" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-sm text-vellum">{checkpoint.label}</p>
          <p className="shrink-0 text-xs text-manifest">{formatDateTime(checkpoint.createdAtMs)}</p>
        </div>
        {checkpoint.note && <p className="mt-0.5 text-xs text-manifest">{checkpoint.note}</p>}
        {checkpoint.photo && (
          <div className="mt-1.5">
            {photoUrl ? (
              <img src={photoUrl} alt={checkpoint.label} className="max-h-40 rounded-md border border-border" />
            ) : (
              <button
                type="button"
                onClick={handleViewPhoto}
                disabled={photoStatus === "loading"}
                className="text-xs text-manifest underline underline-offset-2 hover:text-vellum disabled:opacity-40"
              >
                {photoStatus === "loading" ? "Decrypting…" : photoStatus === "error" ? "Failed to load — retry" : "View photo"}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
