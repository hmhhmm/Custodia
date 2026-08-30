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
import { Dashboard } from "./Dashboard";
import { GoalInput } from "./GoalInput";
import { StatusFeed } from "./StatusFeed";
import { Receipt } from "./Receipt";
import { runDemoStatusSequence } from "./demoStatusSequence";
import type { DealReceipt, DealSummary, StatusStep } from "./types";

type Screen = "dashboard" | "goal" | "status" | "receipt";

const SEED_DEALS: DealSummary[] = [
  { dealId: "demo-1", counterpartyName: "translate-agent.sui", amount: 8, status: "released" },
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
  const [currentGoal, setCurrentGoal] = useState<{ counterpartyName?: string } | null>(null);
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
    setCurrentGoal({});
    // DEMO-ONLY: drives the status feed with a scripted sequence on
    // placeholder data — see demoStatusSequence.ts for what must replace
    // this once Person 1/2/3's real integration points land.
    runDemoStatusSequence(goal, {
      onStepsChange: (nextSteps) => {
        setSteps(nextSteps);
        const found = nextSteps.find((s) => s.id === "candidate-found");
        if (found?.detail && typeof found.detail === "object" && "suinsName" in found.detail) {
          setCurrentGoal({ counterpartyName: found.detail.suinsName });
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
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-ink px-6 text-center text-vellum">
        <span className="font-display text-2xl font-semibold tracking-[0.15em]">WARRANT</span>
        <p className="mt-2 text-sm text-manifest">On-chain trust and settlement for AI agents.</p>
        <button
          type="button"
          onClick={handleLogin}
          className="mt-8 rounded border border-brass/50 px-5 py-2.5 text-sm font-medium text-vellum transition-colors hover:border-brass hover:bg-brass/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass"
        >
          Continue with Google
        </button>
        <p className="mt-3 text-xs text-manifest">
          Signs you in via zkLogin — no seed phrase, no extension required.
        </p>
      </div>
    );
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
