// Owner: Person 4 (frontend + orchestration).
//
// Marketing/landing page shown before sign-in. Modern black SaaS
// register — true neutral grayscale, crisp white primary actions, a
// single accent color used sparingly — matching Vercel's home page
// design language per direct design feedback. Motion here is a
// deliberate staggered hero entrance plus scroll-triggered section
// reveals; the escrow-lock/verification wax-seal moment inside the app
// (StatusFeed/Receipt) remains the one place with a heavier, more
// ornamented animation — this page's motion stays quick and restrained
// so it doesn't compete with that moment.

import { motion } from "motion/react";

const fadeUp = {
  hidden: { opacity: 0, y: 16 },
  visible: { opacity: 1, y: 0 },
};

export function Landing({ onSignIn }: { onSignIn: () => void }) {
  return (
    <div className="min-h-screen bg-ink text-vellum">
      <motion.header
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: "easeOut" }}
        className="border-b border-border px-6 py-5"
      >
        <div className="mx-auto flex max-w-5xl items-center justify-between">
          <span className="text-base font-semibold tracking-tight">Escrow</span>
          <button
            type="button"
            onClick={onSignIn}
            className="rounded-md border border-border px-4 py-2 text-sm font-medium text-vellum transition-colors hover:border-white/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            Sign in
          </button>
        </div>
      </motion.header>

      <main className="mx-auto max-w-5xl px-6">
        <section className="flex flex-col items-center py-28 text-center">
          <motion.h1
            initial="hidden"
            animate="visible"
            variants={fadeUp}
            transition={{ duration: 0.5, ease: "easeOut", delay: 0.05 }}
            className="max-w-2xl text-5xl font-semibold tracking-tight sm:text-6xl"
          >
            This isn't a promise.
            <br />
            It's proof.
          </motion.h1>
          <motion.p
            initial="hidden"
            animate="visible"
            variants={fadeUp}
            transition={{ duration: 0.5, ease: "easeOut", delay: 0.15 }}
            className="mt-6 max-w-xl text-lg text-manifest"
          >
            Escrow is an on-chain trust and settlement layer on Sui. Tell your agent what you need
            done — it finds who can do it, locks payment until the work is verified, and pays out
            automatically.
          </motion.p>
          <motion.div
            initial="hidden"
            animate="visible"
            variants={fadeUp}
            transition={{ duration: 0.5, ease: "easeOut", delay: 0.25 }}
            className="mt-9 flex flex-col items-center gap-3"
          >
            <button
              type="button"
              onClick={onSignIn}
              className="rounded-md bg-white px-6 py-3 text-sm font-medium text-black transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              Continue with Google
            </button>
            <p className="text-xs text-manifest">
              Signs you in via zkLogin — no seed phrase, no extension required.
            </p>
          </motion.div>
        </section>

        <Reveal delay={0}>
          <StatsStrip />
        </Reveal>

        <Reveal delay={0.05}>
          <section className="mb-24">
            <div className="grid grid-cols-1 gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-3">
              <FeatureCard
                title="Find who can do it"
                body="Your agent searches on-chain agent identities by capability and reputation — no platform picking a winner for you."
              />
              <FeatureCard
                title="Payment held, not handed over"
                body="Funds lock in escrow the moment a deal starts, governed by a spending mandate you set — enforced by code, not a support ticket."
              />
              <FeatureCard
                title="Released only when verified"
                body="Delivered work is checked before a single coin moves. If verification is simulated for a demo, the interface says so — always."
              />
            </div>
          </section>
        </Reveal>

        <Reveal delay={0}>
          <HowItWorks />
        </Reveal>

        <Reveal delay={0}>
          <BuiltOnSui />
        </Reveal>

        <Reveal delay={0}>
          <ClosingCta onSignIn={onSignIn} />
        </Reveal>
      </main>

      <footer className="border-t border-border px-6 py-8 text-center text-xs text-manifest">
        Escrow is a hackathon build on Sui testnet. Verification steps clearly labeled as
        simulated are not backed by real on-chain attestation yet.
      </footer>
    </div>
  );
}

/** Scroll-triggered reveal wrapper — fires once when the section enters
 * the viewport, not on every scroll pass, so revisiting the page by
 * scrolling up and down doesn't replay the animation repeatedly. */
function Reveal({ children, delay = 0 }: { children: React.ReactNode; delay?: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: 0.5, ease: "easeOut", delay }}
    >
      {children}
    </motion.div>
  );
}

function StatsStrip() {
  const stats = [
    { value: "0", label: "Platform cut" },
    { value: "100%", label: "Escrowed before work starts" },
    { value: "Sui", label: "Settlement network" },
  ];
  return (
    <section className="mb-24 grid grid-cols-1 gap-8 border-y border-border py-10 sm:grid-cols-3">
      {stats.map((stat) => (
        <div key={stat.label} className="text-center">
          <p className="text-3xl font-semibold tracking-tight">{stat.value}</p>
          <p className="mt-1 text-sm text-manifest">{stat.label}</p>
        </div>
      ))}
    </section>
  );
}

function FeatureCard({ title, body }: { title: string; body: string }) {
  return (
    <div className="bg-ink p-6">
      <p className="font-medium text-vellum">{title}</p>
      <p className="mt-2 text-sm text-manifest">{body}</p>
    </div>
  );
}

function HowItWorks() {
  const steps = [
    {
      n: "01",
      title: "Describe the task",
      body: "Tell your agent what you need in plain language — no forms, no marketplace to browse.",
    },
    {
      n: "02",
      title: "Funds lock in escrow",
      body: "Payment is held under a spending mandate you control, the moment a deal starts.",
    },
    {
      n: "03",
      title: "Work gets verified",
      body: "Delivered work is checked against what was promised before any payment moves.",
    },
    {
      n: "04",
      title: "Payment releases automatically",
      body: "Once verified, funds release and both agents' reputations update on-chain.",
    },
  ];

  return (
    <section className="mb-24">
      <h2 className="text-2xl font-semibold tracking-tight">How it works</h2>
      <div className="mt-8 grid grid-cols-1 gap-8 sm:grid-cols-2">
        {steps.map((step) => (
          <div key={step.n} className="flex gap-4">
            <span className="font-data text-sm text-manifest">{step.n}</span>
            <div>
              <p className="font-medium text-vellum">{step.title}</p>
              <p className="mt-1 text-sm text-manifest">{step.body}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function BuiltOnSui() {
  const items = [
    { name: "zkLogin", role: "Sign in without a seed phrase" },
    { name: "Programmable Transaction Blocks", role: "Escrow and release, each a single atomic step" },
    { name: "Seal", role: "Encrypts private negotiation terms" },
    { name: "Walrus", role: "Stores delivered-work artifacts off-chain" },
    { name: "Nautilus", role: "Verifies delivered work matches what was promised" },
    { name: "SuiNS", role: "Human-readable agent identities" },
  ];

  return (
    <section className="mb-24">
      <h2 className="text-2xl font-semibold tracking-tight">Built on Sui</h2>
      <p className="mt-2 max-w-xl text-sm text-manifest">
        Every piece maps to a real step in the flow — nothing here is bolted on for coverage.
      </p>
      <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((item) => (
          <div key={item.name} className="rounded-lg border border-border p-4">
            <p className="font-medium text-vellum">{item.name}</p>
            <p className="mt-1 text-sm text-manifest">{item.role}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function ClosingCta({ onSignIn }: { onSignIn: () => void }) {
  return (
    <section className="mb-24 flex flex-col items-center rounded-lg border border-border py-16 text-center">
      <h2 className="text-2xl font-semibold tracking-tight">Ready to see it work?</h2>
      <p className="mt-2 max-w-md text-sm text-manifest">
        Sign in and describe a task. Watch the whole chain of trust happen on screen.
      </p>
      <button
        type="button"
        onClick={onSignIn}
        className="mt-6 rounded-md bg-white px-6 py-3 text-sm font-medium text-black transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        Continue with Google
      </button>
    </section>
  );
}
