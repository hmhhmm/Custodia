// Owner: Person 4 (frontend + orchestration).
//
// Marketing/landing page shown before sign-in. Modern black SaaS
// register — true neutral grayscale, crisp white primary actions —
// matching Vercel's home page design language per direct design
// feedback. Built natively on this project's actual stack (Vite +
// Tailwind + the `motion` package already in use elsewhere in the app)
// rather than pulling in a second animation library or a Next.js/shadcn
// component tree that doesn't match this project's setup.
//
// Motion: a staggered blur-in hero entrance (headline word-by-word, then
// subhead/CTA), an ambient radial glow behind the hero (pure CSS, no
// image asset), and a sticky card-stack scroll effect for the info
// sections below the fold — each section pins briefly while the next
// slides over it. The escrow-lock/verification wax-seal moment inside
// the app (StatusFeed/Receipt) remains the one place with a heavier,
// more ornamented animation; this page's motion stays quick and
// restrained so it doesn't compete with that moment.

import { useRef } from "react";
import { motion, useScroll, useTransform } from "motion/react";

const HEADLINE_WORDS = "This isn't a promise. It's proof.".split(" ");

const wordVariants = {
  hidden: { opacity: 0, y: 14, filter: "blur(8px)" },
  visible: { opacity: 1, y: 0, filter: "blur(0px)" },
};

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
        className="border-b border-border px-4 py-4 sm:px-6"
      >
        <div className="mx-auto flex max-w-6xl items-center justify-between">
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

      <main className="mx-auto max-w-6xl px-4 sm:px-6">
        <section className="relative flex flex-col items-center overflow-hidden py-28 text-center">
          {/* Ambient glow — pure CSS radial gradient, no image asset. Kept
              subtle and static (no pulsing loop) so it reads as atmosphere,
              not another animated element competing for attention. */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute left-1/2 top-0 -z-10 h-[36rem] w-[36rem] -translate-x-1/2 -translate-y-1/3 rounded-full opacity-40"
            style={{
              background:
                "radial-gradient(circle, color-mix(in srgb, var(--color-accent) 18%, transparent) 0%, transparent 70%)",
            }}
          />

          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: "easeOut" }}
            className="mb-6 flex items-center gap-2 rounded-full border border-border bg-surface px-4 py-1.5 text-xs text-manifest"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            Live on Sui testnet
          </motion.div>

          <motion.h1
            initial="hidden"
            animate="visible"
            transition={{ staggerChildren: 0.06, delayChildren: 0.1 }}
            className="max-w-2xl text-5xl font-semibold tracking-tight sm:text-6xl"
          >
            {HEADLINE_WORDS.map((word, i) => (
              <motion.span
                key={`${word}-${i}`}
                variants={wordVariants}
                transition={{ duration: 0.5, ease: "easeOut" }}
                className="inline-block"
              >
                {word}
                {i < HEADLINE_WORDS.length - 1 ? " " : ""}
              </motion.span>
            ))}
          </motion.h1>

          <motion.p
            initial="hidden"
            animate="visible"
            variants={fadeUp}
            transition={{ duration: 0.5, ease: "easeOut", delay: 0.55 }}
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
            transition={{ duration: 0.5, ease: "easeOut", delay: 0.65 }}
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

        <StackedSections />

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

/**
 * Sticky card-stack: "How it works" pins in place while the page keeps
 * scrolling, then "Built on Sui" slides up and over it, at which point
 * "How it works" is fully covered and the next section takes the sticky
 * slot. Each stacked panel needs real scroll distance to travel through
 * (a tall wrapper) — a naive sticky-on-both-children approach renders
 * both sections in the same place with no separation, which is illegible
 * (verified this failure mode with a screenshot before fixing it here).
 */
function StackedSections() {
  return (
    <div className="relative mb-24">
      <StackPanel index={0} zIndex={10}>
        <HowItWorks />
      </StackPanel>
      <StackPanel index={1} zIndex={20}>
        <BuiltOnSui />
      </StackPanel>
    </div>
  );
}

function StackPanel({
  children,
  index,
  zIndex,
}: {
  children: React.ReactNode;
  index: number;
  zIndex: number;
}) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({
    target: wrapperRef,
    offset: ["start start", "end start"],
  });

  // Panels after the first scale down slightly as they arrive, so the
  // stack reads as depth (like cards being placed on top of one
  // another) rather than a plain swap.
  const scale = useTransform(scrollYProgress, [0, 1], index === 0 ? [1, 1] : [0.96, 1]);

  return (
    <div ref={wrapperRef} className="relative h-[140vh]" style={{ zIndex }}>
      <motion.div
        style={{ scale }}
        className="sticky top-24 mx-auto max-w-6xl rounded-xl border border-border bg-ink shadow-2xl shadow-black"
      >
        {children}
      </motion.div>
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
    <section className="p-8">
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
    <section className="p-8">
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
