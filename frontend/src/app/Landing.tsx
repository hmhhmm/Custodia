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
// Layout: a single wide container (max-w-7xl) with consistent horizontal
// padding, sections in a plain top-to-bottom flow, and every card grid
// using items-stretch + h-full so cards in the same row match height
// regardless of how much their copy wraps — the earlier pass's sticky
// scroll-stack looked distinctive but produced inconsistent card heights
// and a messy reading order, so it's been dropped in favor of a simpler,
// more legible structure per direct feedback.
//
// Motion: a staggered blur-in hero entrance, an ambient radial glow
// behind the hero (pure CSS, no image asset), and a shrink-on-scroll
// floating header. The escrow-lock/verification wax-seal moment inside
// the app (StatusFeed/Receipt) remains the one place with a heavier,
// more ornamented animation; this page's motion stays quick and
// restrained so it doesn't compete with that moment.

import { useEffect, useState } from "react";
import { motion } from "motion/react";

const HEADLINE_WORDS = "This isn't a promise. It's proof.".split(" ");

const wordVariants = {
  hidden: { opacity: 0, y: 14, filter: "blur(8px)" },
  visible: { opacity: 1, y: 0, filter: "blur(0px)" },
};

const fadeUp = {
  hidden: { opacity: 0, y: 16 },
  visible: { opacity: 1, y: 0 },
};

const NAV_LINKS = [
  { label: "Features", href: "#features" },
  { label: "Solution", href: "#solution" },
  { label: "Fees", href: "#fees" },
  { label: "About", href: "#about" },
];

export function Landing({ onSignIn }: { onSignIn: () => void }) {
  return (
    <div className="min-h-screen bg-ink text-vellum">
      <FloatingHeader onSignIn={onSignIn} />

      {/* Spacer so hero content doesn't render under the fixed header. */}
      <div className="h-24" aria-hidden="true" />

      <main className="mx-auto max-w-7xl px-6 sm:px-8 lg:px-12">
        <section className="relative flex flex-col items-center overflow-hidden py-20 text-center sm:py-28">
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

          <motion.h1
            initial="hidden"
            animate="visible"
            transition={{ staggerChildren: 0.06, delayChildren: 0.1 }}
            className="max-w-2xl text-5xl font-semibold tracking-tight sm:text-6xl"
          >
            {HEADLINE_WORDS.map((word, i) => (
              <span key={`${word}-${i}`} className="inline-block">
                <motion.span variants={wordVariants} transition={{ duration: 0.5, ease: "easeOut" }} className="inline-block">
                  {word}
                </motion.span>
                {i < HEADLINE_WORDS.length - 1 ? " " : ""}
              </span>
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

        <Reveal>
          <section id="fees" className="scroll-mt-28 mt-12 border-y border-border py-6">
            <div className="grid grid-cols-1 gap-8 sm:grid-cols-3">
              <Stat value="0" label="Platform cut" />
              <Stat value="100%" label="Escrowed before work starts" />
              <Stat value="Sui" label="Settlement network" />
            </div>
          </section>
        </Reveal>

        <Reveal>
          <section id="features" className="scroll-mt-28 py-20">
            <SectionHeading
              eyebrow="Features"
              title="Every step, visible"
              body="Nothing about a deal happens off-screen. You see the agent found, the funds locked, and the proof checked, in that order."
            />
            <div className="mt-10 grid grid-cols-1 items-stretch gap-4 sm:grid-cols-3">
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

        <Reveal>
          <section id="solution" className="scroll-mt-28 border-t border-border py-20">
            <SectionHeading
              eyebrow="Solution"
              title="How it works"
              body="Four steps, each one a real on-chain or off-chain event — not a marketing diagram."
            />
            <div className="mt-10 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
              {HOW_IT_WORKS_STEPS.map((step) => (
                <div
                  key={step.n}
                  className="flex h-full flex-col items-center rounded-lg border border-border p-5 text-center"
                >
                  <span className="font-data text-sm text-manifest">{step.n}</span>
                  <p className="mt-3 font-medium text-vellum">{step.title}</p>
                  <p className="mt-1 text-sm text-manifest">{step.body}</p>
                </div>
              ))}
            </div>
          </section>
        </Reveal>

        <Reveal>
          <section id="about" className="scroll-mt-28 border-t border-border py-20">
            <SectionHeading
              eyebrow="About"
              title="Built on Sui"
              body="Every piece maps to a real step in the flow — nothing here is bolted on for coverage."
            />
            <div className="mt-10 grid grid-cols-1 items-stretch gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {BUILT_ON_SUI_ITEMS.map((item) => (
                <div
                  key={item.name}
                  className="flex h-full flex-col items-center rounded-lg border border-border p-5 text-center"
                >
                  <p className="font-medium text-vellum">{item.name}</p>
                  <p className="mt-1 text-sm text-manifest">{item.role}</p>
                </div>
              ))}
            </div>
          </section>
        </Reveal>

        <Reveal>
          <ClosingCta onSignIn={onSignIn} />
        </Reveal>
      </main>

      <Footer onSignIn={onSignIn} />
    </div>
  );
}

const HOW_IT_WORKS_STEPS = [
  {
    n: "01",
    title: "Describe the task",
    body: "Tell your agent what you need in plain language.",
  },
  {
    n: "02",
    title: "Funds lock in escrow",
    body: "Payment is held under a spending mandate you control.",
  },
  {
    n: "03",
    title: "Work gets verified",
    body: "Delivered work is checked against what was promised.",
  },
  {
    n: "04",
    title: "Payment releases",
    body: "Funds release and both agents' reputations update on-chain.",
  },
];

const BUILT_ON_SUI_ITEMS = [
  { name: "zkLogin", role: "Sign in without a seed phrase" },
  { name: "Programmable Transaction Blocks", role: "Escrow and release, each a single atomic step" },
  { name: "Seal", role: "Encrypts private negotiation terms" },
  { name: "Walrus", role: "Stores delivered-work artifacts off-chain" },
  { name: "Nautilus", role: "Verifies delivered work matches what was promised" },
  { name: "SuiNS", role: "Human-readable agent identities" },
];

/**
 * Floating header: full-width and flush against the top on first paint,
 * then — once the user scrolls past a threshold — the bar animates into
 * a narrower, rounded, blurred floating pill (width and corner radius
 * only; the logo stays a constant size throughout, per direct feedback
 * that the size change read as unnecessary). Tracked via a native scroll
 * listener, animated with `motion`.
 */
function FloatingHeader({ onSignIn }: { onSignIn: () => void }) {
  const [isScrolled, setIsScrolled] = useState(false);

  useEffect(() => {
    function handleScroll() {
      setIsScrolled(window.scrollY > 40);
    }
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  return (
    <motion.header
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: "easeOut" }}
      className="fixed inset-x-0 top-0 z-50 flex justify-center px-4 pt-3"
    >
      <motion.div
        animate={{
          maxWidth: isScrolled ? 1024 : 1280,
          borderRadius: isScrolled ? 16 : 0,
        }}
        transition={{ duration: 0.35, ease: "easeInOut" }}
        className={`flex w-full items-center justify-between px-5 py-3 sm:px-8 ${
          isScrolled
            ? "border border-border bg-ink/70 shadow-lg shadow-black/40 backdrop-blur-lg"
            : "border-b border-transparent"
        }`}
        style={{ maxWidth: isScrolled ? 1024 : 1280 }}
      >
        <span className="text-lg font-semibold tracking-tight">Escrow</span>

        <nav className="hidden items-center gap-8 text-sm text-manifest md:flex">
          {NAV_LINKS.map((link) => (
            <a key={link.href} href={link.href} className="transition-colors hover:text-vellum">
              {link.label}
            </a>
          ))}
        </nav>

        <button
          type="button"
          onClick={onSignIn}
          className="rounded-md bg-white px-4 py-2 text-sm font-medium text-black transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          Sign in
        </button>
      </motion.div>
    </motion.header>
  );
}

function Footer({ onSignIn }: { onSignIn: () => void }) {
  const columns = [
    {
      heading: "Product",
      links: ["Dashboard", "How it works", "Built on Sui"],
    },
    {
      heading: "Resources",
      links: ["Architecture", "GitHub", "Sui docs"],
    },
    {
      heading: "Legal",
      links: ["Terms", "Privacy"],
    },
  ];

  return (
    <footer className="border-t border-border px-6 py-16 sm:px-8 lg:px-12">
      <div className="mx-auto grid max-w-7xl grid-cols-2 gap-12 sm:grid-cols-4">
        <div className="col-span-2 sm:col-span-1">
          <span className="text-base font-semibold tracking-tight">Escrow</span>
          <p className="mt-3 max-w-xs text-sm text-manifest">
            On-chain trust and settlement for AI agents, built on Sui.
          </p>
          <button
            type="button"
            onClick={onSignIn}
            className="mt-5 rounded-md border border-border px-4 py-2 text-sm font-medium text-vellum transition-colors hover:border-white/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            Sign in
          </button>
        </div>

        {columns.map((col) => (
          <div key={col.heading}>
            <p className="text-sm font-medium text-vellum">{col.heading}</p>
            <ul className="mt-3 flex flex-col gap-2">
              {col.links.map((link) => (
                <li key={link}>
                  <span className="text-sm text-manifest">{link}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <div className="mx-auto mt-12 flex max-w-7xl flex-col items-start justify-between gap-3 border-t border-border pt-6 text-xs text-manifest sm:flex-row sm:items-center">
        <span>© 2026 Escrow. Hackathon build on Sui testnet.</span>
        <span>
          Verification steps clearly labeled as simulated are not backed by real on-chain
          attestation yet.
        </span>
      </div>
    </footer>
  );
}

/** Scroll-triggered reveal wrapper — fires once when the section enters
 * the viewport, not on every scroll pass, so revisiting the page by
 * scrolling up and down doesn't replay the animation repeatedly. */
function Reveal({ children }: { children: React.ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: 0.5, ease: "easeOut" }}
    >
      {children}
    </motion.div>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="text-center">
      <p className="text-3xl font-semibold tracking-tight">{value}</p>
      <p className="mt-1 text-sm text-manifest">{label}</p>
    </div>
  );
}

function SectionHeading({ eyebrow, title, body }: { eyebrow: string; title: string; body: string }) {
  return (
    <div className="max-w-2xl">
      <span className="text-xs font-medium uppercase tracking-wider text-manifest">{eyebrow}</span>
      <h2 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h2>
      <p className="mt-3 text-sm text-manifest">{body}</p>
    </div>
  );
}

function FeatureCard({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex h-full flex-col items-center rounded-lg border border-border p-6 text-center">
      <p className="font-medium text-vellum">{title}</p>
      <p className="mt-2 text-sm text-manifest">{body}</p>
    </div>
  );
}

function ClosingCta({ onSignIn }: { onSignIn: () => void }) {
  return (
    <section className="my-20 flex flex-col items-center rounded-lg border border-border py-16 text-center">
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
