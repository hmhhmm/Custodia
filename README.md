# Escrow

On-chain trust and settlement for AI agents — discovery, negotiation,
verification, and escrow-backed payment, on Sui.

## Pitch

Escrow is a neutral, on-chain trust and settlement layer on Sui that lets
AI agents discover each other, negotiate privately, verify delivered
work, and get paid automatically via escrow — without a centralized
platform in the middle. Envoy, the companion user-facing agent, talks to
a human in plain language and drives the whole flow under the hood,
spending only within a Mandate the human explicitly grants.

Built for MUBA Hacks 2026 (Sui Track, AI x Sui).

## Prerequisites

- **Sui CLI** — confirm current version against the official Sui install
  docs before installing (`sui --version` once installed).
- **Node.js** — confirm current LTS version against nodejs.org before
  installing. Comes with npm, which this repo's workspace setup uses
  (see root `package.json`'s `workspaces` field).
- **A Sui wallet** capable of testnet use (or rely on zkLogin — see
  `frontend/src/sui/zkLogin.ts`, still a stub). Confirm current
  recommended wallet setup in the Sui docs.

## Repo layout

```
/move/                       Person 1 — Move package (contracts)
/frontend/src/sui/           Person 2 — zkLogin, Enoki, PTBs, SuiNS, wallet UI
/frontend/src/verification/  Person 3 — Walrus, Seal, Nautilus
/frontend/src/app/           Person 4 — UI
/frontend/src/agent/         Person 4 — LLM calls, discovery, demo stand-ins
/docs/ARCHITECTURE.md        Full system architecture — read this first
```

See `/docs/ARCHITECTURE.md` for the object model, end-to-end sequence,
and exact ownership boundaries.

## Setup

### Move package (`/move/`)

```
cd move
sui move build   # VERIFY: current `sui move build` invocation/flags
sui move test    # VERIFY: current `sui move test` invocation/flags
```

`Move.toml` currently has a placeholder Sui framework dependency —
confirm the correct git rev/tag against current Sui Move docs before
building.

### Frontend (`/frontend/`)

From the repo root (npm workspace):

```
npm install
npm run dev          # runs frontend/ via `vite`
```

## Local dev loop

1. `npm run dev` starts the Vite dev server for the frontend.
2. Run a local or testnet Sui environment as needed for the transaction
   layer (Person 2) — VERIFY current `sui client` / localnet setup
   instructions in the Sui docs.
3. Move contract changes: rebuild with `sui move build`, redeploy to
   testnet (see below), then update the TBD function names/argument
   order in `/docs/ARCHITECTURE.md` and in `frontend/src/sui/ptb-*.ts`.

## Deploying the Move package to testnet

```
cd move
sui client switch --env testnet   # VERIFY: exact command/flags
sui client publish --gas-budget <VERIFY_VALUE>
```

VERIFY the exact publish command, flags, and a sane gas budget against
current Sui CLI docs — do not copy a gas budget number from memory.

After publishing, record the package ID and any shared object IDs, and
fill in the "TBD — fill in once Person 1 deploys to testnet" section of
`/docs/ARCHITECTURE.md`.

## Environment variables

Create a `.env` (gitignored) in `frontend/` with (names below are
placeholders — verify each exact env var name in the relevant official
docs before use). This is a Vite app, so any env var read by client code
via `import.meta.env` MUST be prefixed `VITE_` or Vite will not expose it
to the browser bundle — `process.env` does not exist in the browser and
must not be used in `frontend/src/`:

```
VITE_SUI_NETWORK=testnet                # VERIFY: exact expected values
VITE_ENOKI_API_KEY=                     # VERIFY: exact env var name in Enoki docs
VITE_WALRUS_PUBLISHER_URL=              # VERIFY: exact env var name / current publisher URL in Walrus docs
VITE_WALRUS_AGGREGATOR_URL=             # VERIFY: exact env var name / current aggregator URL in Walrus docs
VITE_SEAL_KEY_SERVER_URL=               # VERIFY: exact env var name in Seal docs
VITE_NAUTILUS_ENDPOINT=                 # VERIFY: exact env var name in Nautilus docs (only relevant once/if real Nautilus is attempted — see docs/ARCHITECTURE.md)
```

## Team & task ownership

| Person | Owns |
|---|---|
| 1 | `/move/` — Move contracts (AgentIdentity, Reputation, Mandate, Deal), escrow logic, testnet deployment |
| 2 | `/frontend/src/sui/` — zkLogin, Enoki sponsored transactions, the two PTBs, SuiNS registration, wallet connect UI |
| 3 | `/frontend/src/verification/` (or a dedicated services package) — Walrus, Seal, Nautilus attestation flow |
| 4 | `/frontend/src/app/` and `/frontend/src/agent/` — UI, LLM orchestration, agent discovery/matching, scripted specialist-agent stand-ins |

See `/CLAUDE.md` for the hard rules every Claude Code session in this
repo follows (no invented APIs, ownership boundaries, scope limits).

## Sui skills (Claude Code / Cursor / Codex)

This repo has the official Mysten Labs Sui skills installed and symlinked
into `.claude/skills/` (25 skills covering Move, PTBs, the CLI, frontend
SDKs, and more). If you're setting up a fresh clone and the symlinks
aren't present, reinstall with:

```
npx skills add mystenlabs/skills --all
```

These are a stronger verification source than model memory for Sui/Move
APIs — see the "Installed Sui skills" section in `/CLAUDE.md`. They do
**not** cover Enoki, Seal, or Nautilus; keep verifying those three
against their own official docs.
