// Owner: Person 4 (frontend + orchestration).
//
// Top-level screen router for the Envoy UI: Login -> Goal input -> Live
// status feed -> Receipt. This wires the 4 screens together with a
// minimal state machine; it does not yet call any real zkLogin, PTB, or
// verification logic — those integration points are marked below.

import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { LoginScreen } from "./LoginScreen";
import { GoalInput } from "./GoalInput";
import { StatusFeed } from "./StatusFeed";
import { Receipt } from "./Receipt";
import { runDemoStatusSequence } from "./demoStatusSequence";
import type { DealReceipt, StatusStep } from "./types";

type Screen = "login" | "goal" | "status" | "receipt";

function ScreenTransition({ children }: { children: React.ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.25, ease: "easeOut" }}
    >
      {children}
    </motion.div>
  );
}

export function App() {
  const [screen, setScreen] = useState<Screen>("login");
  const [steps, setSteps] = useState<StatusStep[]>([]);
  const [receipt, setReceipt] = useState<DealReceipt | null>(null);

  function handleLogin() {
    // TODO: replace with Person 2's real zkLogin flow
    // (frontend/src/sui/zkLogin.ts) once implemented.
    setScreen("goal");
  }

  function handleGoalSubmit(goal: string) {
    setScreen("status");
    // DEMO-ONLY: drives the status feed with a scripted sequence on
    // placeholder data, since Person 1/2/3's real integration points
    // (PTB confirmations, verification results) are not wired up yet.
    // Replace this call with real event-driven updates once those land —
    // do not let this scripted sequence linger once real state exists.
    runDemoStatusSequence(goal, {
      onStepsChange: setSteps,
      onComplete: (finalReceipt) => {
        setReceipt(finalReceipt);
        setScreen("receipt");
      },
    });
  }

  function handleStartOver() {
    setSteps([]);
    setReceipt(null);
    setScreen("goal");
  }

  return (
    <div className="min-h-screen bg-warrant-bg text-warrant-text">
      <AnimatePresence mode="wait">
        {screen === "login" && (
          <ScreenTransition key="login">
            <LoginScreen onContinue={handleLogin} />
          </ScreenTransition>
        )}
        {screen === "goal" && (
          <ScreenTransition key="goal">
            <GoalInput onSubmit={handleGoalSubmit} />
          </ScreenTransition>
        )}
        {screen === "status" && (
          <ScreenTransition key="status">
            <StatusFeed steps={steps} />
          </ScreenTransition>
        )}
        {screen === "receipt" && receipt && (
          <ScreenTransition key="receipt">
            <Receipt receipt={receipt} onStartOver={handleStartOver} />
          </ScreenTransition>
        )}
      </AnimatePresence>
    </div>
  );
}
