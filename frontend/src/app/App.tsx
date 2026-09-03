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
import { Receipt } from "./Receipt";
import { findOwnedMandate } from "../sui/onboarding-status";
import { ENVOY_ADDRESS } from "../sui/envoy-signer";
import type { ConversationTurn, DealReceipt, DealSummary } from "./types";

type Screen = "checking" | "onboarding" | "app" | "receipt";

const SEED_DEALS: DealSummary[] = [
  {
    dealId: "demo-1",
    counterpartyName: "translate-agent.sui",
    amount: 8,
    status: "released",
    category: "Translation",
    description: "Translated onboarding docs into Spanish and French.",
  },
  {
    dealId: "demo-2",
    counterpartyName: "legal-review.sui",
    amount: 12,
    status: "escrowed",
    category: "Legal",
    description: "Reviewing a vendor contract for indemnity clauses.",
  },
  {
    dealId: "demo-3",
    counterpartyName: "courier-dispatch.sui",
    amount: 4,
    status: "released",
    category: "Logistics",
    description: "Same-day courier quote and pickup scheduling.",
  },
];

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
  const [deals, setDeals] = useState<DealSummary[]>(SEED_DEALS);
  const [turns, setTurns] = useState<ConversationTurn[]>([]);
  const [viewingDealId, setViewingDealId] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<DealReceipt | null>(null);
  const [lastTask, setLastTask] = useState("");
  const [onboarding, setOnboarding] = useState<OnboardingResult | null>(null);

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

  function handleDealComplete(finalReceipt: DealReceipt, task: string) {
    setLastTask(task);
    setReceipt(finalReceipt);
    setScreen("receipt");
  }

  function handleOpenDeal(dealTurnId: string) {
    setViewingDealId(dealTurnId);
  }

  function handleBackToDeals() {
    if (receipt) {
      setDeals((prev) => [
        {
          dealId: receipt.dealId,
          counterpartyName: receipt.counterpartyName,
          amount: receipt.amount,
          status: "released",
          // The deal card's category doesn't yet have a real on-chain
          // source; falling back to a generic label and the raw task text.
          category: "General",
          description: lastTask,
        },
        ...prev,
      ]);
    }
    setReceipt(null);
    setLastTask("");
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
    setNav(next);
  }

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
              onDealComplete={handleDealComplete}
            />
          </ScreenTransition>
        )}
        {nav === "deals" && viewingDeal && (
          <ScreenTransition key="progress">
            <ProgressView turn={viewingDeal} onBack={() => setViewingDealId(null)} />
          </ScreenTransition>
        )}
        {nav === "deals" && !viewingDeal && (
          <ScreenTransition key="deals">
            <Dashboard deals={deals} turns={turns} onNewDeal={() => handleNavChange("chat")} onOpenDeal={handleOpenDeal} />
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
