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
import { AppShell, type NavItem } from "./components/AppShell";
import { Landing } from "./Landing";
import { Dashboard } from "./Dashboard";
import { GoalInput } from "./GoalInput";
import { StatusFeed } from "./StatusFeed";
import { Receipt } from "./Receipt";
import { runDemoStatusSequence } from "./demoStatusSequence";
import type { DealReceipt, DealSummary, StatusStep } from "./types";

type Screen = "dashboard" | "goal" | "status" | "receipt";

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
  const [authenticated, setAuthenticated] = useState(false);
  const [nav, setNav] = useState<NavItem>("active");
  const [screen, setScreen] = useState<Screen>("dashboard");
  const [deals, setDeals] = useState<DealSummary[]>(SEED_DEALS);
  const [steps, setSteps] = useState<StatusStep[]>([]);
  const [currentGoal, setCurrentGoal] = useState<{ counterpartyName?: string; description?: string } | null>(
    null,
  );
  const [receipt, setReceipt] = useState<DealReceipt | null>(null);

  function handleLogin() {
    // TODO: replace with Person 2's real zkLogin flow
    // (frontend/src/sui/zkLogin.ts) once implemented.
    setAuthenticated(true);
  }

  function handleNewDeal() {
    setScreen("goal");
  }

  function handleGoalSubmit(goal: string) {
    setScreen("status");
    setCurrentGoal({ description: goal });
    // DEMO-ONLY: drives the status feed with a scripted sequence on
    // placeholder data — see demoStatusSequence.ts for what must replace
    // this once Person 1/2/3's real integration points land.
    runDemoStatusSequence(goal, {
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
    return <Landing onSignIn={handleLogin} />;
  }

  return (
    <AppShell activeNav={nav} onNavChange={setNav} identityLabel="you">
      <AnimatePresence mode="wait">
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
