# Custodia

On-chain trust and settlement for AI agents — discovery, negotiation,
verification, and escrow-backed payment, built on Sui, with a
Gonka-powered fact-checking extension ("Custodia Verify").

## What this is

Custodia lets an AI agent (Envoy, the user-facing personal assistant)
hire *other* agents and pay them safely, without ever holding an
unrestricted wallet key. A **Mandate** — a real on-chain spending
permit with a hard cap, an expiry, and a fixed list of allowed task
categories — is the only boundary Envoy can act inside, enforced by a
Move contract the frontend cannot bypass.

Ask Envoy to get something done — a document translated, a contract
reviewed, a broken laptop picked up, repaired, and returned — and it:

1. **Decomposes the request** (Gemini) into one deal, or a sequenced
   chain of deals if the task genuinely needs different specialists in
   order.
2. **Finds a specialist** by querying the real on-chain `AgentRegistry`
   and ranking by an on-chain `Reputation` score — no manual matching.
3. **Escrows payment** in a real `Deal` object via one atomic
   transaction — money moves out of Mandate custody into escrow, and
   nowhere else can touch it.
4. **Waits for real, wallet-signed delivery** from the specialist's own
   session — checkpoints, proof, and (for physical items) photos are
   Seal-encrypted and stored on Walrus, readable only by the two
   parties on that deal.
5. **Releases payment and updates reputation atomically**, once the
   client verifies delivery — one Move transaction, so funds and
   trust can never drift out of sync.

**Custodia Verify** repoints these exact same contracts — Mandate,
Deal, Reputation, Seal, Walrus — at fact-checking instead of task
delivery, using [Gonka Router](https://gonkarouter.io) as the mandatory
multi-model inference gateway. See [Architecture](#architecture) below
for how both pieces actually fit together.

## Live status — what's real vs. simulated

Said out loud, not hidden, because a trust product should never let a
simulated step look indistinguishable from a real one:

| Piece | Status |
|---|---|
| Escrow, Mandate enforcement, Deal lifecycle | **Real** — live on Sui testnet |
| Specialist discovery & reputation ranking | **Real** — on-chain `AgentRegistry` + `Reputation` |
| Seal encryption + Walrus storage | **Real** — live testnet key server & publisher/aggregator |
| Multi-agent deal chains | **Real** — gated on real on-chain proof, not a timer |
| Work verification (Nautilus) | **Simulated**, clearly labeled in the UI — a real TEE deployment is out of hackathon scope (see `frontend/src/verification/nautilus.mock.ts`) |
| zkLogin | **Scaffolded, not wired in** — the live demo uses standard wallet connect (see `frontend/src/sui/zkLogin.ts`) |
| Custodia Verify's Gonka calls | **Real** — confirmed live against the real API this session (real model IDs, real request IDs, real parsing of both models' actual response formats) |
| Custodia Verify's on-chain flow (escrow → Gonka → Seal/Walrus → release) | Built and type-checked; the on-chain half needs a live wallet session to exercise end-to-end, which a documentation pass can't do on its own — test it yourself before demoing (see [Testing Custodia Verify](#testing-custodia-verify)) |

## Architecture

### How a deal actually moves money

The mechanism worth understanding is **who signs what**, not just a
component list — three separate keys are involved, and no single one
of them can move funds alone:

```
 CLIENT SIDE                    SUI — ON-CHAIN                  SPECIALIST SIDE
┌────────────────┐
│ Chat message    │
└───────┬─────────┘
        ▼
┌────────────────┐   reads cap   ┌──────────────┐
│ Envoy (Gemini)  │──────────────▶│   Mandate    │
│ decides,        │               │ cap · expiry │
│ does not sign   │               │ · categories │
└───────┬─────────┘               └──────┬───────┘
        ▼                                │
┌────────────────┐  signs create_and_share (envoy's OWN key, not client wallet)
│ Envoy's own key │─────────────────────▶┌──────────────┐   ┌───────────────┐
└────────────────┘                        │     Deal     │──▶│ AgentRegistry │
                                           │ escrow locked│   │ ranked by real│
                                           └──────┬───────┘   │ Reputation    │
                                                   │           └──────┬────────┘
                                                   │                  │ offer visible
                                                   ▼                  ▼
                                          ┌──────────────┐   ┌────────────────────┐
                                          │Deal:Delivered│◀──│ Specialist's OWN key│
                                          │ real DealProof│   │ signs accept +      │
                                          │ polled, never │   │ deliver — a THIRD,  │
                                          │ assumed       │   │ separate wallet     │
                                          └──────┬───────┘   └────────────────────┘
        ┌────────────────┐  client clicks         │
        │ Client wallet   │  "Release Payment"     ▼
        │ — the ONE action│──────────────▶┌──────────────────────┐
        │ they sign       │  signed by     │  verify_and_release   │
        └────────────────┘  Envoy's key    │  ONE atomic tx:       │
                                             │  pay specialist +     │
                                             │  update BOTH          │
                                             │  Reputation objects   │
                                             └───────────┬───────────┘
                                                          │ ranks next specialist
                                                          ▼
                                                  ┌──────────────┐
                                                  │  Reputation   │
                                                  │ rises/falls   │
                                                  │ feeds back    │
                                                  │ into ranking  │
                                                  └──────────────┘
```

The client never signs an escrow transaction directly — Envoy does,
using its own delegated key, but only inside the spending cap the
client set once, on-chain, at onboarding. The specialist's acceptance
and delivery come from a genuinely separate wallet Envoy has no control
over. Payment release and both parties' reputation updates happen
**atomically**, in the same transaction the client explicitly triggers.

### The encrypted deliverable path

```
 Deliverable /        encrypt         Seal          store        Walrus
 task brief    ─────────────────▶  (client-side,  ─────────▶  (encrypted
 (plaintext,                       before it ever              blob, id
  in-browser)                      leaves)                     on-chain)
                                                                    │
                                                        DealAllowlist gates
                                                        decrypt — only client
                                                        + specialist on THIS
                                                        deal, not Custodia,
                                                        not a backend —
                                                        because there is no
                                                        backend
```

Nothing — not a task brief, not delivered work — is readable by anyone
except the two parties on that exact `Deal`. There's no server in the
middle to subpoena, hack, or simply be nosy.

### Custodia Verify — the same contracts, repointed at truth instead of delivery

```
 Claim submitted         Gonka Router              Custodia's real contracts
┌───────────────┐   ┌─────────────────────┐    ┌───────────────────────────────┐
│ "URL / tweet / │──▶│ ≥2 independent models│──▶│ Mandate funds the tiny        │
│  text snippet" │   │ run in PARALLEL —    │   │ inference cost (same escrow    │
└───────────────┘   │ no single model's     │   │ mechanism as a specialist fee) │
                     │ answer is final       │   │                                │
                     └──────────┬───────────┘   │ Truth Score + reasoning trace  │
                                │ Truth Score,    │ Seal-encrypted, stored on      │
                                │ reasoning trace, │ Walrus — same path as a       │
                                │ X-Request-Id per │ specialist's deliverable      │
                                │ model call        │                                │
                                ▼                  │ verify_and_release pays out    │
                     ┌─────────────────────┐      │ AND updates a real on-chain    │
                     │ Transparency dashboard│      │ Reputation object — the        │
                     │ — Truth Score, trace, │      │ IDENTICAL record_completed()   │
                     │ every Gonka Request ID│      │ mechanism a specialist deal     │
                     └─────────────────────┘      │ already uses                    │
                                                    └───────────────────────────────┘
```

**Important, stated plainly:** the "specialist" on a fact-check Deal is
a single on-chain **Verifier identity** representing Custodia's own
automated Gonka-backed service — Envoy signs *both* the client side
(escrow) and the specialist side (accept/deliver) of that Deal. This is
structurally valid (`deal.move` never asserts the client and specialist
identities must be controlled by different addresses), but it is an
automated verification service, not a peer marketplace match — see
`frontend/src/sui/verifier-signer.ts`'s header for the full reasoning.

No new Move module was needed: Custodia Verify reuses the existing
`"research"` Mandate category (the closest existing fit — inspect and
assess, same as it already covers hands-on diagnostic work in the main
product) rather than touching `MANDATE_CATEGORIES`, which every
existing Mandate's on-chain `allowed_categories` was already fixed
against at creation time.

## Repo layout

```
/move/                       Move package (contracts)
/frontend/src/sui/           zkLogin (stub), Enoki, PTBs, SuiNS, wallet UI
/frontend/src/verification/  Walrus, Seal, Nautilus (simulated)
/frontend/src/app/           UI — Chat, Deals, Mandate, Specialist inbox, Custodia Verify
/frontend/src/agent/         LLM calls (Gemini), Gonka Router client, agent discovery
/docs/ARCHITECTURE.md        Full system architecture and change history — read this first
```

## Prerequisites

- **Sui CLI** — confirm current version against the official Sui install
  docs before installing (`sui --version` once installed).
- **Node.js** — confirm current LTS version against nodejs.org before
  installing.
- **A Sui wallet** capable of testnet use (or standard wallet connect,
  since zkLogin is not wired into the live demo — see the status table
  above).
- **A Gonka Router API key** (for Custodia Verify) — get one at
  [gonkarouter.io](https://gonkarouter.io).

## Setup

### Move package (`/move/`)

```
cd move
sui move build
sui move test
```

### Frontend (`/frontend/`)

```
npm install
npm run dev
```

## Environment variables

Create a `.env` (gitignored, never committed) in `frontend/`:

```
VITE_SUI_NETWORK=testnet

# Deployed to Sui testnet — real values, current package.
# PACKAGE_ID is the LATEST (upgraded) package; ORIGINAL_PACKAGE_ID is
# pinned to the pre-upgrade id — a struct's type is permanently anchored
# to whichever package first introduced it, so type-filtered queries for
# pre-upgrade types (Deal, DealAllowlist, DealProof, Mandate,
# AgentIdentity) MUST use ORIGINAL_PACKAGE_ID or they silently match
# nothing (see frontend/src/sui/config.ts's header for the full rule,
# and this project's own history of getting this wrong at first).
VITE_CUSTODIA_PACKAGE_ID=0x8c6309b6f0faeafcea446d8ce5a20f9940d81c5a2d922f386e92f35155b1d371
VITE_CUSTODIA_ORIGINAL_PACKAGE_ID=0x8f9df445446cb4568136e6a0f6ef69c36d15ce869fca1185660bcd16a616a0e3
VITE_AGENT_REGISTRY_ID=0x81ee790128d7a27b9712836b5400d98f3e04d42aa3376c7beded1c4bb857b473

# Gemini — used for task decomposition/classification (agent/llm.ts, agent/chat.ts).
VITE_GEMINI_API_KEY=

# Gonka Router — MANDATORY inference gateway for Custodia Verify
# (agent/gonka.ts). All fact-check reasoning routes through this, never
# a direct model-provider call. Get a key at gonkarouter.io.
VITE_GONKA_API_KEY=

# Envoy's demo signing key — Envoy's delegated key for every client-side
# PTB (mandate.move forbids a Mandate delegating to its own owner, so a
# separate real address is required). Testnet-only value; never do this
# with a key holding anything of real value.
VITE_ENVOY_ADDRESS=
VITE_ENVOY_SECRET_KEY=

# The demo specialist / Custodia Verify Verifier signing key — reused
# for both roles (see sui/specialist-signer.ts and the new
# sui/verifier-signer.ts, which wraps this same keypair for its new
# purpose). Testnet-only value.
VITE_SPECIALIST_ADDRESS=
VITE_SPECIALIST_SECRET_KEY=
```

## Testing Custodia Verify

The Gonka Router integration itself (`frontend/src/agent/gonka.ts`) was
verified live against the real API this session:

- Both real model IDs confirmed by calling the API directly:
  `deepseek-ai/DeepSeek-V4-Flash-0731` and `MiniMaxAI/MiniMax-M2.7` (the
  short-form IDs shown on gonkarouter.io/models turned out to be wrong
  — the API's own `invalid_model` error response names the real ones).
- Real `X-Request-Id` response headers captured from live calls.
- Real response body shape confirmed (`choices[0].message.content`,
  standard OpenAI-compatible schema).
- A real parsing edge case found and fixed: MiniMax wraps its answer in
  a `<think>...</think>` reasoning block before the actual JSON verdict
  — `parseVerdict` strips that block and extracts the last JSON object
  in what remains, tested against real captured API output from both
  models.
- Consensus averaging and disagreement-flagging (>25 point spread)
  tested against a known-false claim (Great Wall visible from space —
  both models scored ~10%) and a known-true claim (water boils at
  100°C at sea level — scored 100%).

The on-chain half (Mandate check → escrow → Gonka call → Seal-encrypt →
Walrus-store → `verify_and_release`) is fully wired in
`frontend/src/app/factcheck.ts` and type-checks/builds clean, but
requires a connected browser wallet to exercise — it has not been run
end-to-end in this session. Before demoing:

1. Complete onboarding with a Mandate that includes the `"research"`
   category and has at least ~0.001 SUI spendable.
2. Go to the **Verify** tab, paste a claim, click "Verify claim".
3. Watch the live step feed — if any step fails, the exact on-chain
   error message is shown, not a generic failure.

## Team & ownership

| Area | Owns |
|---|---|
| `/move/` | Move contracts (AgentIdentity, Reputation, Mandate, Deal, Deal Checkpoint, Deal Brief), escrow logic, testnet deployment |
| `/frontend/src/sui/` | zkLogin (stub), Enoki, PTBs, SuiNS registration, wallet connect UI |
| `/frontend/src/verification/` | Walrus, Seal, Nautilus (simulated) attestation flow |
| `/frontend/src/app/`, `/frontend/src/agent/` | UI, LLM orchestration (Gemini + Gonka Router), agent discovery/matching |

See `/CLAUDE.md` for the hard rules every session in this repo follows
(no invented APIs, ownership boundaries, scope limits).

## Deployed addresses (Sui testnet)

Chain ID `4c78adac`. Recorded in `move/Published.toml`, which the
toolchain reads — do not hand-edit it except as documented there.

| What | Value |
|---|---|
| Package ID (latest, upgraded) | `0x8c6309b6f0faeafcea446d8ce5a20f9940d81c5a2d922f386e92f35155b1d371` |
| Original package ID (pre-upgrade, for type queries) | `0x8f9df445446cb4568136e6a0f6ef69c36d15ce869fca1185660bcd16a616a0e3` |
| `AgentRegistry` (shared) | `0x81ee790128d7a27b9712836b5400d98f3e04d42aa3376c7beded1c4bb857b473` |
| `UpgradeCap` | `0x43639f9c63873a3ca454d558b3e0c98ac66dbb402ff2e2ba355b950f886deb3d` |

Modules: `agent_identity`, `checkpoint`, `deal`, `deal_access`,
`deal_brief`, `mandate`, `proof`, `reputation`.

- `checkpoint` — a granular, specialist-pushed status trail per Deal
  (e.g. "Picked up", "Arrived"), additive alongside `deal::DealStatus`'s
  own coarser 9-state enum.
- `deal_brief` — a real on-chain task brief (item details, address,
  contact) a specialist can read, written once by the client right
  after escrow locks.

Both were added by upgrading the original package — **a struct's type
is permanently anchored to whichever package first introduced it**, not
wherever it later gets compiled into. This bit the project directly:
after the `deal_brief` upgrade moved the "latest package" pointer
forward a second time, `checkpoint`'s objects were still typed under
the *original* package, and a query using the latest package id
silently matched nothing — confirmed by pulling a real transaction's
raw JSON and reading its `objectChanges[].objectType` field directly.
Fixed by using `ORIGINAL_PACKAGE_ID` for every pre-upgrade type query
and `PACKAGE_ID` only for `moveCall` targets and types genuinely
introduced by the *latest* upgrade.

`deal_access` implements the Seal allowlist policy (`seal_approve` +
`check_policy`), reused by both `checkpoint` (specialist photos) and
`deal_brief` (the task brief text) — the policy already scopes access
to "either party on this deal," regardless of which encrypted artifact
it is.

**A separate, stricter rule applies to Seal specifically** — the
`@mysten/seal` SDK hard-requires the package id passed to `encrypt()`
and `SessionKey.create()` to be the package's original, version-1 id,
unconditionally (confirmed by reading the SDK's own source:
`packageObj.object.version !== "1"` throws `InvalidPackageError`).
`frontend/src/verification/seal.ts` uses `ORIGINAL_PACKAGE_ID` for
Seal's identity/session-key calls specifically, and `PACKAGE_ID` only
for the actual `seal_approve` moveCall target.

### Why a fresh publish (not an upgrade) the first time

The very first deployment's `UpgradeCap` was generated inside a
disposable session sandbox and never backed up, so an in-place upgrade
was impossible the first time this package needed to change — it had
to be republished fresh from a newly generated, actually-held CLI
address. **Lesson recorded for next time:** immediately after any `sui
client publish`, back up the publishing address's key (`sui keytool
export`) or transfer the `UpgradeCap` to a wallet with a real, backed-up
recovery phrase — don't leave it sitting only in a CLI's default
keystore, especially inside an ephemeral environment.

## Sui skills (Claude Code / Cursor / Codex)

This repo has the official Mysten Labs Sui skills installed and
symlinked into `.claude/skills/`. If a fresh clone is missing the
symlinks, reinstall with:

```
npx skills add mystenlabs/skills --all
```

These are a stronger verification source than model memory for Sui/Move
APIs — see `/CLAUDE.md`. They do **not** cover Enoki, Seal, Nautilus, or
Gonka Router; keep verifying those against their own official docs.
