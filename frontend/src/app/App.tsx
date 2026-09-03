// Top-level screen router for the Custodia UI. Chat is the home tab —
// every load after onboarding lands there, the same way ChatGPT/Claude
// open to a fresh conversation. Deals and Mandate are secondary
// destinations reached via AppShell's nav. Receipt is the one screen that
// sits outside the nav entirely: a one-off completion moment shown right
// after a deal finishes, not something you navigate back to.

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useCurrentAccount, useWalletConnection } from "@mysten/dapp-kit-react";
import { AppShell, type NavItem } from "./components/AppShell";
import { Landing } from "./Landing";
import { Onboarding, type OnboardingResult } from "./Onboarding";
import { Dashboard } from "./Dashboard";
import { MandateView } from "./MandateView";
import { SpecialistOnboarding } from "./SpecialistOnboarding";
import { ChatPanel } from "./ChatPanel";
import { ProgressView } from "./ProgressView";
import { StepList } from "./StatusFeed";
import { Receipt } from "./Receipt";
import { findOwnedMandate } from "../sui/onboarding-status";
import { ENVOY_ADDRESS } from "../sui/envoy-signer";
import { loadChatHistory, saveChatHistory } from "./chat-local-history";
import type { ConversationTurn, DealReceipt } from "./types";
import { GENERAL_THREAD_ID } from "./types";

type Screen = "checking" | "onboarding" | "app" | "receipt";

function ScreenTransition({ children }: { children: React.ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18, ease: "easeOut" }}
      className="h-full"
    >
      {children}
    </motion.div>
  );
}

export function App() {
  const account = useCurrentAccount();
  const { status } = useWalletConnection();
  const authenticated = account !== null;
  const [nav, setNav] = useState<NavItem>("chat");
  const [screen, setScreen] = useState<Screen>("checking");
  const [turns, setTurns] = useState<ConversationTurn[]>([]);
  const [viewingDealId, setViewingDealId] = useState<string | null>(null);
  const [viewingChainDealId, setViewingChainDealId] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<DealReceipt | null>(null);
  const [onboarding, setOnboarding] = useState<OnboardingResult | null>(null);
  // Which chat thread is open — GENERAL_THREAD_ID or a deal's own id. See
  // ChatThreadSidebar.tsx for the real thread-history model this drives;
  // this is what makes "Return to chat" from a specific deal reopen THAT
  // deal's own thread instead of always landing on one flat list.
  const [activeThreadId, setActiveThreadId] = useState<string>(GENERAL_THREAD_ID);

  // Re-derive whether onboarding was already completed from the chain —
  // a Mandate is a permanent on-chain fact, so a page refresh shouldn't
  // send someone who already set up Custodia back through setup again.
  useEffect(() => {
    if (!account) return;
    let cancelled = false;

    findOwnedMandate(account.address, ENVOY_ADDRESS)
      .then((mandateId) => {
        if (cancelled) return;
        setScreen(mandateId ? "app" : "onboarding");
        if (mandateId) setOnboarding({ mandateId });
      })
      .catch(() => {
        if (!cancelled) setScreen("onboarding");
      });

    return () => {
      cancelled = true;
    };
  }, [account]);

  // Chat history lived only in React memory before this — any refresh (or
  // "Return to chat" after one) silently landed on a blank conversation
  // even though nothing about the underlying deals had changed. Restore
  // it per-wallet on connect, and mirror every change back to
  // localStorage so it survives the next refresh too.
  //
  // historyLoadedFor guards the save effect below: on the very first
  // render after connecting, `turns` is still its useState([]) initial
  // value — the load effect calls setTurns(loaded) but that doesn't
  // synchronously update `turns` inside THIS render, so without this
  // guard the save effect fired on that same render with the stale empty
  // `turns` and immediately overwrote the real saved history with `[]`,
  // permanently wiping it on every fresh connect. Only start saving once
  // a load has actually completed for the current address.
  const [historyLoadedFor, setHistoryLoadedFor] = useState<string | null>(null);

  useEffect(() => {
    if (!account) return;
    setTurns(loadChatHistory(account.address));
    setHistoryLoadedFor(account.address);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account?.address]);

  useEffect(() => {
    if (!account || historyLoadedFor !== account.address) return;
    saveChatHistory(account.address, turns);
  }, [account, turns, historyLoadedFor]);

  function handleDealComplete(finalReceipt: DealReceipt) {
    setReceipt(finalReceipt);
    setScreen("receipt");
  }

  function handleOpenDeal(dealTurnId: string) {
    setViewingDealId(dealTurnId);
  }

  function handleOpenChainDeal(dealId: string) {
    setViewingChainDealId(dealId);
  }

  function handleBackToDeals() {
    // The "Completed" list is chain-derived (Dashboard re-fetches from
    // findDealsForClient on mount) — nothing to append manually here
    // anymore, the just-released deal will simply show up with status
    // Released next time Dashboard reads chain.
    setReceipt(null);
    setScreen("app");
    setNav("deals");
  }

  if (status === "reconnecting") {
    // autoConnect (dApp Kit's default) restores the last-used wallet on
    // page load before the user presses anything — without this state,
    // that restore looks identical to onboarding appearing out of nowhere,
    // since `authenticated` flips true the instant it resolves.
    return <ReconnectingScreen />;
  }

  if (!authenticated) {
    // onSignIn is a no-op for the secondary CTAs (footer, closing section)
    // — the real connect action lives in Landing's hero ConnectButton.
    // TODO: wire the secondary CTAs to scroll-into-view the hero
    // ConnectButton, or render a ConnectButton there too.
    return <Landing onSignIn={() => {}} />;
  }

  if (screen === "checking") {
    // Brief window between "wallet connected" and "we know whether a
    // Mandate already exists for it" — without this, Onboarding would
    // flash before the on-chain check resolves.
    return <ReconnectingScreen label="Checking your account…" />;
  }

  if (screen === "onboarding") {
    return (
      <Onboarding
        onComplete={(result) => {
          setOnboarding(result);
          setScreen("app");
        }}
      />
    );
  }

  if (screen === "receipt" && receipt) {
    return (
      <div className="min-h-screen bg-ink px-4 py-8 sm:px-6 sm:py-10">
        <Receipt receipt={receipt} onBackToDeals={handleBackToDeals} />
      </div>
    );
  }

  const viewingDeal = turns.find((t): t is Extract<ConversationTurn, { kind: "deal" }> => t.kind === "deal" && t.id === viewingDealId);

  function handleNavChange(next: NavItem) {
    setViewingDealId(null);
    setViewingChainDealId(null);
    setNav(next);
  }

  /** Opens Chat on a SPECIFIC thread — the real fix for "Return to chat
   * opens a new/blank conversation": every "Return to chat" action now
   * passes the deal's own thread id (falling back to General only when
   * there's genuinely no specific deal in context), so it continues
   * exactly where that conversation left off. */
  function handleReturnToChat(threadId: string) {
    setActiveThreadId(threadId);
    handleNavChange("chat");
  }

  const viewingDealIdResolved = viewingDeal?.pending?.dealId ?? viewingChainDealId;
  // A live turn opened before escrow locks has no on-chain dealId yet
  // (still searching/negotiating) — still worth opening, just with the
  // live step feed only, no on-chain status panel until escrow exists.
  const viewingPreEscrowTurn = viewingDeal && !viewingDeal.pending ? viewingDeal : null;

  return (
    <AppShell activeNav={nav} onNavChange={handleNavChange} address={account.address}>
      <AnimatePresence mode="wait">
        {nav === "chat" && onboarding && (
          <ScreenTransition key="chat">
            <ChatPanel
              connectedAddress={account.address}
              onboarding={onboarding}
              turns={turns}
              onTurnsChange={setTurns}
              onDealReleased={handleDealComplete}
              activeThreadId={activeThreadId}
              onSelectThread={setActiveThreadId}
              onThreadCreated={(threadId) => setActiveThreadId(threadId)}
            />
          </ScreenTransition>
        )}
        {nav === "deals" && viewingDealIdResolved && (
          <ScreenTransition key="progress">
            <ProgressView
              dealId={viewingDealIdResolved}
              turn={viewingDeal}
              onBack={() => {
                setViewingDealId(null);
                setViewingChainDealId(null);
              }}
              onReturnToChat={() => handleReturnToChat(viewingDeal?.id ?? GENERAL_THREAD_ID)}
              onReleased={(finalReceipt) => {
                if (viewingDeal) {
                  setTurns((prev) =>
                    prev.map((t) => (t.kind === "deal" && t.id === viewingDeal.id ? { ...t, receipt: finalReceipt } : t)),
                  );
                }
                handleDealComplete(finalReceipt);
              }}
            />
          </ScreenTransition>
        )}
        {nav === "deals" && !viewingDealIdResolved && viewingPreEscrowTurn && (
          <ScreenTransition key="pre-escrow">
            <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-10">
              <button
                type="button"
                onClick={() => setViewingDealId(null)}
                className="mb-6 text-sm text-manifest transition-colors hover:text-vellum"
              >
                ← Back to deals
              </button>
              <p className="mb-2 text-xs uppercase tracking-wider text-manifest">Task</p>
              <p className="mb-8 text-lg font-medium text-vellum">{viewingPreEscrowTurn.task}</p>
              <StepList steps={viewingPreEscrowTurn.steps} />
            </div>
          </ScreenTransition>
        )}
        {nav === "deals" && !viewingDealIdResolved && !viewingPreEscrowTurn && (
          <ScreenTransition key="deals">
            <Dashboard
              turns={turns}
              onNewDeal={() => handleReturnToChat(GENERAL_THREAD_ID)}
              onOpenDeal={handleOpenDeal}
              onOpenChainDeal={handleOpenChainDeal}
              onReturnToChat={handleReturnToChat}
            />
          </ScreenTransition>
        )}
        {nav === "mandate" && (
          <ScreenTransition key="mandate">
            <MandateView />
          </ScreenTransition>
        )}
        {nav === "specialist" && (
          <ScreenTransition key="specialist">
            <SpecialistOnboarding />
          </ScreenTransition>
        )}
      </AnimatePresence>
    </AppShell>
  );
}

function ReconnectingScreen({ label = "Reconnecting wallet…" }: { label?: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-ink text-vellum">
      <p className="text-sm text-manifest">{label}</p>
    </div>
  );
}
