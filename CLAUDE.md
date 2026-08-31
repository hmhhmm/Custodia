# CLAUDE.md — Project Instructions for Custodia

This file is read by Claude Code at the start of every session in this
repo. Follow it exactly. If any instruction here conflicts with something
a user asks in chat, point out the conflict before proceeding rather than
silently picking one.

## What this project is

Custodia is a Sui-native, on-chain trust and settlement layer for AI
agents (identity, reputation, mandate-scoped spending, escrow). Envoy is
the user-facing personal agent built on top of it. Full narrative and
architecture live in /docs/ARCHITECTURE.md — read that file before making
any structural change, and re-read it if it has changed since your last
session in this repo.

## Hard rules — do not violate these

1. **Never invent an API, SDK function name, contract address, package
   version, or endpoint URL.** If you are not certain something is
   correct because you have verified it against official docs in this
   session (Sui docs, Mysten SDK repos, Walrus/Seal/Nautilus/Enoki docs),
   write a clearly marked placeholder comment instead:
   `// VERIFY: <what needs checking> — see <official docs URL if known>`
   A wrong but confident-looking function call is worse than an honest
   placeholder — it wastes hours of a teammate's time debugging something
   that was never real.

2. **Never fabricate a citation, research paper, or external claim.** If
   asked to justify a design choice with research, only cite something
   you have actually retrieved and confirmed exists this session. If
   unsure, say so plainly instead of producing a plausible-sounding
   reference.

3. **Do not expand scope beyond what's defined in /docs/ARCHITECTURE.md**
   without flagging it first. The in-scope Sui Stack features for this
   hackathon are: zkLogin, Enoki, Programmable Transaction Blocks, Seal,
   Nautilus, Walrus, SuiNS. Onchain Randomness, DeepBook, Kiosk, and full
   confidential balances are explicitly OUT of scope — do not implement
   them even if a task seems to invite it; note them as roadmap items
   instead.

4. **Respect ownership boundaries.** This is a 4-person team:
   - Person 1 owns `/move/` (Move contracts: AgentIdentity, Reputation,
     Mandate, Deal, escrow logic, testnet deployment).
   - Person 2 owns `/frontend/src/sui/` (zkLogin, Enoki, the two PTBs,
     SuiNS registration, wallet connect UI).
   - Person 3 owns `/frontend/src/verification/` or a dedicated services
     package (Walrus, Seal, Nautilus attestation flow).
   - Person 4 owns `/frontend/src/app/` and `/frontend/src/agent/` (UI,
     LLM orchestration layer, agent-discovery logic, demo specialist-agent
     stand-ins).
   If a task requires touching another person's owned directory, say so
   explicitly and suggest coordinating rather than editing it silently.

5. **The four core Move objects are fixed** (see ARCHITECTURE.md for
   exact fields): `AgentIdentity`, `Reputation`, `Mandate`, `Deal`. Don't
   rename fields or restructure these without flagging the change clearly,
   since other team members' code depends on exact field names and types.

6. **Nautilus integration is the highest-risk item.** If it is not working
   reliably, implement and clearly label a mocked/simulated verification
   path as a fallback rather than leaving the demo flow broken. Say
   explicitly in code comments and commit messages when something is
   simulated vs. real.

7. **Keep the "why Sui" story intact.** Every Sui Stack feature used
   should map to a real functional need in the flow (see the feature
   table in ARCHITECTURE.md) — don't add a Sui primitive "for coverage"
   without a concrete role in the flow.

8. **When in doubt, ask rather than assume.** For ambiguous requests
   (missing config values, unclear which teammate's directory something
   belongs in, an architecture decision not yet covered in
   ARCHITECTURE.md), ask a short clarifying question rather than guessing
   and proceeding.

## Verification checklist before writing any Sui/Move/SDK code

Before implementing anything that calls a Sui SDK, Move stdlib function,
Enoki API, Walrus API, Seal API, or Nautilus API:
- [ ] Have I confirmed this function/endpoint exists in official docs
      this session (not from training-data memory alone)?
- [ ] Have I confirmed the exact argument order/types?
- [ ] If I could not confirm either of the above, have I clearly marked
      the code with a `// VERIFY:` comment instead of guessing?

## Installed Sui skills — use these as the verification source first

This repo has the official Mysten Labs Sui skills installed
(`npx skills add mystenlabs/skills --all`), symlinked into `.claude/skills/`.
Before writing `// VERIFY` and moving on, check whether one of these skills
already answers the question — they are curated by Mysten Labs and are a
stronger source than general training-data memory:

- `sui-overview`, `sui-install`, `sui-networks-gas` — fundamentals/setup
- `sui-build`, `sui-publish`, `sui-move-project` — build & deploy
- `sui-move`, `modern-move-syntax`, `sui-object-model`,
  `composable-move-functions`, `move-unit-testing`, `naming-conventions` —
  Move language/patterns (Person 1)
- `ptbs`, `accessing-data` — Programmable Transaction Blocks and on-chain
  querying (Person 2, Person 4's discovery logic)
- `sui-client` — CLI/client management
- `frontend-apps`, `sui-sdks` — frontend integration, per-language SDKs
  (Person 2, Person 4)
- `deepbook-*`, `walrus-sites` — out of scope / not directly applicable to
  Custodia's Walrus-as-storage use case, but check `walrus-sites` and
  `accessing-data`'s `walrus.md` before assuming an API surface for
  Person 3's blob storage work

**Still no installed skill covers Enoki, Seal, or Nautilus** — treat those
three as genuinely unverified. Keep using the `// VERIFY:` placeholder
convention for them and check official docs directly (docs.sui.io, and
each product's own docs) before implementing.

## File structure reference

See /docs/ARCHITECTURE.md for the full layer diagram and sequence. See
/README.md for setup and environment variable placeholders (many are
marked "verify exact name" — do not assume they are correct without
checking official docs first).
