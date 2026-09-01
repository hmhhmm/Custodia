// Owner: Person 4 (frontend + orchestration).
//
// Top-level screen router for the Envoy UI. Dashboard-first structure:
// the persistent AppShell wraps every screen, and "New deal" is an
// action reached from the dashboard rather than a standalone flow — see
// the design brief's "must read as real software" requirement. Auth is a
// minimal gate before the shell renders (Person 2 owns the real zkLogin
// wiring; this is a placeholder callback).

import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useCurrentAccount } from "@mysten/dapp-kit-react";
import { AppShell, type NavItem } from "./components/AppShell";
import { Landing } from "./Landing";
import { Onboarding, type OnboardingResult } from "./Onboarding";
import { Dashboard } from "./Dashboard";
import { GoalInput } from "./GoalInput";
import { StatusFeed } from "./StatusFeed";
import { Receipt } from "./Receipt";
import { runOrchestratedDeal } from "./orchestrator";
import type { DealReceipt, DealSummary, StatusStep } from "./types";

type Screen = "onboarding" | "dashboard" | "goal" | "status" | "receipt";

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
    >
      {children}
    </motion.div>
  );
}

export function App() {
  const account = useCurrentAccount();
  const authenticated = account !== null;
  const [nav, setNav] = useState<NavItem>("active");
  const [screen, setScreen] = useState<Screen>("onboarding");
  const [deals, setDeals] = useState<DealSummary[]>(SEED_DEALS);
  const [steps, setSteps] = useState<StatusStep[]>([]);
  const [currentGoal, setCurrentGoal] = useState<{ counterpartyName?: string; description?: string } | null>(
    null,
  );
  const [receipt, setReceipt] = useState<DealReceipt | null>(null);
  const [onboarding, setOnboarding] = useState<OnboardingResult | null>(null);

  function handleNewDeal() {
    setScreen("goal");
  }

  function handleGoalSubmit(goal: string) {
    if (!onboarding) {
      // Should be unreachable — GoalInput is only rendered after
      // onboarding completes — but guard rather than silently pass
      // undefined IDs into the orchestrator (that was the exact class of
      // bug found by this session's audit: unverified IDs quietly
      // substituted with something wrong).
      return;
    }
    setScreen("status");
    setCurrentGoal({ description: goal });
    // Real orchestration: calls Gemini (llm.ts), on-chain discovery
    // (discovery.ts), the real PTBs (sui/ptb-*.ts), and Person 3's real
    // Walrus + Nautilus-mock calls. See orchestrator.ts for exactly which
    // steps are genuinely on-chain vs. still scripted, and why.
    runOrchestratedDeal(goal, account?.address, onboarding, {
      onStepsChange: (nextSteps) => {
        setSteps(nextSteps);
        const found = nextSteps.find((s) => s.id === "candidate-found");
        const candidateDetail = found?.detail;
        if (candidateDetail && typeof candidateDetail === "object" && "suinsName" in candidateDetail) {
          const suinsName = candidateDetail.suinsName;
          setCurrentGoal((prev) => ({ ...prev, counterpartyName: suinsName }));
        }
      },
      onComplete: (finalReceipt) => {
        setReceipt(finalReceipt);
        setScreen("receipt");
      },
    });
  }

  function handleBackToDeals() {
    if (receipt) {
      setDeals((prev) => [
        {
          dealId: receipt.dealId,
          counterpartyName: receipt.counterpartyName,
          amount: receipt.amount,
          status: "released",
          // PROPOSED: category/description shown on the deal card don't
          // yet have a real on-chain source — see /docs/ARCHITECTURE.md's
          // Mandate.allowed_categories field for where "category" should
          // eventually come from. Falling back to the raw goal text here.
          category: "General",
          description: currentGoal?.description ?? "",
        },
        ...prev,
      ]);
    }
    setSteps([]);
    setReceipt(null);
    setCurrentGoal(null);
    setScreen("dashboard");
  }

  if (!authenticated) {
    // onSignIn is now a no-op for the secondary CTAs (footer, closing
    // section) — the real connect action lives in Landing's hero
    // ConnectButton. Clicking those secondary buttons currently does
    // nothing; scrolling to the hero's real ConnectButton is the actual
    // path to sign in. TODO: wire the secondary CTAs to scroll-into-view
    // the hero ConnectButton, or render a ConnectButton there too.
    return <Landing onSignIn={() => {}} />;
  }

  return (
    <AppShell activeNav={nav} onNavChange={setNav} identityLabel="you">
      <AnimatePresence mode="wait">
        {screen === "onboarding" && (
          <ScreenTransition key="onboarding">
            <Onboarding
              onComplete={(result) => {
                setOnboarding(result);
                setScreen("dashboard");
              }}
            />
          </ScreenTransition>
        )}
        {screen === "dashboard" && (
          <ScreenTransition key="dashboard">
            <Dashboard deals={deals} onNewDeal={handleNewDeal} />
          </ScreenTransition>
        )}
        {screen === "goal" && (
          <ScreenTransition key="goal">
            <GoalInput onSubmit={handleGoalSubmit} onBack={() => setScreen("dashboard")} />
          </ScreenTransition>
        )}
        {screen === "status" && (
          <ScreenTransition key="status">
            <StatusFeed steps={steps} counterpartyName={currentGoal?.counterpartyName} />
          </ScreenTransition>
        )}
        {screen === "receipt" && receipt && (
          <ScreenTransition key="receipt">
            <Receipt receipt={receipt} onBackToDeals={handleBackToDeals} />
          </ScreenTransition>
        )}
      </AnimatePresence>
    </AppShell>
  );
}
