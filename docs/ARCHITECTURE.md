# Escrow — System Architecture

## Summary

Escrow is a neutral, on-chain trust and settlement layer built on Sui
that lets AI agents discover each other, negotiate privately, verify
delivered work, and get paid automatically via escrow — without a
centralized platform sitting in the middle of the transaction. Envoy is
the companion user-facing personal agent: it talks to a human in plain
language, translates their goal into a scoped mandate, and drives the
Escrow flow on their behalf. This document is the shared source of truth
for the object model, the end-to-end flow, and team ownership boundaries;
read it before making any structural change, and update it (not just your
own head) when a decision changes.

## Layer diagram

```
User
  │  plain-language goal, wallet/zkLogin auth
  ▼
Envoy (off-chain orchestration)
  │  interprets goal, discovers/negotiates with specialist agents,
  │  drafts transactions on the user's behalf within their Mandate
  ▼
Escrow (on-chain trust layer)
  │  identity, reputation, mandate enforcement, escrow lock/release
  ▼
Sui Move objects
     AgentIdentity · Reputation · Mandate · Deal
```

Envoy never holds funds or bypasses a Mandate — every spend it initiates
is checked against an on-chain Mandate object before Escrow will lock
escrow.

## Core Move objects

These four objects are fixed for this hackathon (per /CLAUDE.md rule 5).
Do not rename fields or add new ones without flagging the change to the
whole team — anything marked PROPOSED below still needs confirmation from
Person 1 before other people's code depends on it.

### AgentIdentity
| Field | Type | Notes |
|---|---|---|
| owner | address | |
| suins_name | String | Human-readable name, registered via SuiNS |
| capabilities | vector\<String\> | Used by discovery/matching in frontend/src/agent |
| reputation_id | ID | Points at this agent's Reputation object |

### Reputation
| Field | Type | Notes |
|---|---|---|
| agent_id | ID | |
| completed_deals | u64 | |
| disputed_deals | u64 | |
| score | u64 | RESOLVED — `(100*completed + 50*PRIOR_WEIGHT) / (completed + disputed + PRIOR_WEIGHT)`, `PRIOR_WEIGHT = 5`. 0-100. Cold start is exactly 50; one completed deal is 58, not 100. The prior exists so a single self-dealt deal cannot top discovery ranking |

### Mandate
| Field | Type | Notes |
|---|---|---|
| owner | address | The human delegating spend authority |
| delegate | address | The agent authorized to spend |
| max_spend | u64 | |
| spent_so_far | u64 | |
| allowed_categories | vector\<String\> | |
| expires_at | u64 | RESOLVED — epoch MILLISECONDS, compared against `sui::clock::Clock.timestamp_ms()`. Chosen over an epoch number because a mandate window is sub-epoch and `ctx.epoch_timestamp_ms()` only returns the epoch start. Person 4: `MandateSnapshot.expiresAt` needs a ms conversion |
| revoked | bool | |

### Deal
| Field | Type | Notes |
|---|---|---|
| client_agent | ID | |
| specialist_agent | ID | |
| escrowed_amount | Balance\<SUI\> | |
| status | enum: Negotiating, Escrowed, Delivered, Verified, Released, Disputed | |
| proof_ref | Option\<ID\> | Points at a Walrus/Nautilus-backed verification record. PROPOSED concrete shape in `frontend/src/verification/proof.ts` — confirm with Person 1 |

## End-to-end sequence

1. **Auth** — user signs in via zkLogin (Person 2).
2. **Goal input** — user tells Envoy what they want in plain language
   (Person 4, frontend/src/app).
3. **Agent discovery** — Envoy queries on-chain AgentIdentity/Reputation
   objects to find candidate specialist agents (Person 4,
   frontend/src/agent).
4. **Negotiate (TEE-mediated)** — Envoy and the specialist agent agree
   terms. Two complementary mechanisms, not alternatives:
   - *Confidentiality* — negotiation content is Seal-encrypted so only the
     two parties can read it (Person 3).
   - *Neutral execution* — both agents submit their offers into a trusted
     execution environment (Nautilus) that runs the matching logic inside
     the enclave and emits a signed outcome, so neither side sees the
     other's reserve price and neither can misreport what was agreed
     (Person 3 + Person 4).
   SIMULATED for the demo — see "TEE-mediated agent-to-agent negotiation
   (Step 4)" below before building anything against this.
5. **Mandate check** — before any spend, the proposed Deal amount and
   category are checked against the user's Mandate (Move-level assertion,
   Person 1).
6. **PTB #1 — lock-escrow-and-create-deal** — a single Programmable
   Transaction Block checks the Mandate, locks payment into escrow, and
   creates the Deal object, sponsored via Enoki (Person 2).
7. **Off-chain work** — the specialist agent performs the work.
8. **Proof** — the deliverable (or a reference to it) is stored via
   Walrus and optionally attested via Nautilus, producing the value that
   becomes Deal.proof_ref (Person 3).
9. **PTB #2 — verify-and-release-and-update-reputation** — a second PTB
   confirms the proof, releases escrowed funds to the specialist, and
   updates both agents' Reputation objects (Person 2 builds the PTB;
   Person 1 owns the underlying Move functions).
10. **Receipt** — the user sees a completed Deal with updated reputation
    for both sides (Person 4, frontend/src/app).

## Sui Stack feature mapping

| Feature | Where it's used |
|---|---|
| zkLogin | Step 1 — user auth, no seed phrase required |
| Enoki (sponsored transactions) | Steps 6 & 9 — users transact without holding SUI for gas |
| Programmable Transaction Blocks | Steps 6 & 9 — the two composite on-chain operations (escrow+deal creation; verify+release+reputation update) |
| Seal | Step 4 — encrypting private negotiation/deliverable content. REAL, via `@mysten/seal` and an allowlist `seal_approve` policy (`move/sources/deal_access.move`, `frontend/src/verification/seal.ts`) — package name confirmed, encrypt/decrypt flow written but UNTESTED against a live key server |
| Nautilus (TEE negotiation channel) | Step 4 — neutral execution of the agent-to-agent negotiation itself, so neither counterparty has to trust the other's software to run the matching honestly. Complements Seal (which gives confidentiality but not neutral execution). SIMULATED and NOT YET BUILT — added at the team's explicit request 2026-08-29, expanding the original feature table per /CLAUDE.md rule 3; see "TEE-mediated agent-to-agent negotiation (Step 4)" below |
| Nautilus (work attestation) | Step 8 — attesting that delivered work matches what was promised. HIGHEST RISK; per /CLAUDE.md rule 6 the demo uses a clearly-labeled MOCKED attestation (`frontend/src/verification/nautilus.mock.ts`) as the primary deliverable, not a last-resort fallback — see "Verification Layer Implementation Notes" below |
| Walrus | Step 8 — storing deliverable artifacts / proof material off-chain. REAL, via the public testnet HTTP API (`frontend/src/verification/walrus.ts`) |
| SuiNS | Step 3 (and AgentIdentity.suins_name generally) — human-readable agent identities for discovery |

Out of scope for the working demo (roadmap only): Onchain Randomness,
DeepBook, Kiosk, full confidential balances. Do not implement these even
if a task seems to invite it.

## TEE-mediated agent-to-agent negotiation (Step 4)

**Status: DESIGN ONLY — nothing is built.** No file in `frontend/src/`
implements any part of this yet. Do not cite it as working in a demo, a
README, or a pitch until this line changes.

### Why a TEE here, when Step 4 already has Seal

Seal and a TEE solve different halves of the same problem, and the demo
narrative needs both:

| Property | Seal gives it? | TEE gives it? |
|---|---|---|
| Only the two parties can read the terms (confidentiality) | Yes | Yes |
| Neither party sees the other's reserve price before agreeing | **No** | Yes |
| Neither party can misreport what the agreed outcome was | **No** | Yes |
| The matching/negotiation logic itself is verifiably the agreed logic | **No** | Yes |

Today, even with Seal, one side still *executes* the negotiation: it sees
the counterparty's position and reports back a result the other side has
to take on faith. Between agents built by two different companies with no
prior relationship — the exact case Escrow exists for — that is an
unmet trust assumption, not a detail. A TEE closes it by making the
negotiation a sealed-bid computation neither side controls.

This is the strongest available answer to the pure machine-to-machine
scenario: two agents from competing companies, no human present, needing
to agree a price when neither trusts the other's software.

### Design shape (PROPOSED — confirm with Person 3 and Person 4)

1. Both agents submit signed offers (reserve price, scope, deadline) into
   an enclave-hosted negotiation session, encrypted to the enclave.
2. The enclave runs the matching logic — the only component that sees both
   offers in the clear.
3. The enclave emits a signed `NegotiationOutcome`: agreed price, agreed
   scope hash, both agent IDs, and the session ID. Losing offers are never
   revealed to either party.
4. That signed outcome is what feeds the Mandate check (Step 5) and PTB #1
   (Step 6) — an agreed price neither side can dispute after the fact.

### Open design gap — must be resolved before implementing

`escrow::deal_access::DealAllowlist` is keyed on `deal_id`, and the Deal
object does not exist until PTB #1 at **Step 6**. Negotiation happens at
**Step 4**. There is therefore no Deal-scoped allowlist to encrypt a
negotiation against, and this affects the existing Seal design as much as
it affects the TEE addition.

Resolving it needs a pre-Deal identifier — a `NegotiationSession` ID
minted at Step 4 that both the Seal policy and the TEE session key off,
and that the resulting Deal then references. This is a change to
`move/sources/deal_access.move` (Person 3, published in Person 1's
package), so **coordinate with Person 1 and Person 3 before either one
builds against the current `deal_id`-keyed shape.**

### Simulation requirements (per /CLAUDE.md rule 6)

A real TEE negotiation channel is the same infrastructure project as real
Nautilus attestation — an actual AWS Nitro Enclave (or Marlin Oyster), a
reproducible enclave build, PCR measurements registered on-chain, and a
Move-side verifier for the AWS certificate chain. It is not an SDK call
and it is not a hackathon-window task.

So the demo build is simulated, under the same rules that already govern
`nautilus.mock.ts`:

- The simulated module must carry an always-true `simulated: true` flag,
  mirroring `MockAttestation.mocked`, and every consumer (UI, logs,
  receipt) must surface it. A simulated negotiation must never be
  presentable as a real one.
- The return shape must be a structural drop-in for what a real signed
  enclave outcome would be, so a real implementation can replace it
  without changing anything downstream.
- Say "simulated" in the demo narration, not just in a code comment.

// VERIFY: whether Nautilus's current design supports a multi-party
// submit-and-match session at all, or only the single-party
// "attest my own computation" pattern used at Step 8. This section
// assumes the former and that assumption is UNCONFIRMED — check
// https://docs.sui.io/concepts/cryptography/nautilus and
// https://docs.sui.io/concepts/cryptography/nautilus/nautilus-design
// before writing any code against it. If Nautilus only supports the
// single-party pattern, the honest fallback is a single enclave acting as
// a neutral third-party matcher that both agents submit to — say so
// plainly rather than describing it as something Nautilus does natively.

### Proposed ownership

The negotiation channel spans two owned directories: the enclave/attestation
side belongs with Person 3 (`frontend/src/verification/`, alongside
`nautilus.mock.ts`), and the offer construction and agent-side negotiation
logic belongs with Person 4 (`frontend/src/agent/`). Proposed split — a
`tee-negotiation.mock.ts` under Person 3 exposing the session API, called
from Person 4's negotiation logic. **Confirm this split with both owners
before either starts.**

## Verification Layer Implementation Notes

Status of Person 3's scope as of this writing:

| Piece | Status | Notes |
|---|---|---|
| Walrus | **Real, wired into the demo flow** | HTTP API via public testnet publisher/aggregator, confirmed against the installed `accessing-data` Sui skill (docs.wal.app returned 403 to direct fetches this session — the skill's `walrus.md` was the working verification source). `frontend/src/app/demoStatusSequence.ts` now actually calls `storeBlob()` for the "work-in-progress" step — verified live: a real `PUT` to `publisher.walrus-testnet.walrus.space` returns `200` with a genuine blob ID, though the public testnet publisher took ~11.7s to respond in testing, hence the "this can take several seconds" status message. Endpoints are community-run and may change; re-verify against docs.wal.app before mainnet. |
| Seal | **Real code, still blocked** | `@mysten/seal` package name confirmed via docs.sui.io. Encrypt/decrypt call shapes and the `seal_approve` Move convention are documented and implemented per-spec, but both `encryptNegotiationTerms`/`decryptNegotiationTerms` still throw "not implemented" — blocked on `@mysten/seal` not being installed and `escrow::deal_access` (Move) being an unimplemented stub. Not wired into the demo sequence; the "negotiating" step remains scripted. |
| Nautilus | **Mocked by design, wired into the demo flow** | Real Nautilus requires deploying an actual AWS Nitro Enclave (or Marlin Oyster), registering PCR measurements on-chain, and verifying AWS certificate chains in Move — genuine infrastructure work, not an SDK call, and Mysten's own template is explicitly unaudited/incomplete. `demoStatusSequence.ts` now actually calls `mockNautilusAttest()` on the real bytes stored via Walrus above, rather than hardcoding a `{ mocked: true }` literal in the UI layer — the `attestationId` and `resultHash` shown to the user are genuinely computed, not fake strings. Every consumer (UI, logs) must surface the `mocked` flag — never let a simulated attestation appear indistinguishable from a real one in the demo. |
| TEE negotiation channel (Step 4) | **Design only — nothing built** | Added 2026-08-29 at the team's explicit request, expanding the original scope. Gives neutral execution of the negotiation, which Seal alone does not. Blocked on the pre-Deal `NegotiationSession` ID gap and on confirming Nautilus supports a multi-party session pattern. See "TEE-mediated agent-to-agent negotiation (Step 4)" above. |
| `Deal.proof_ref` format | **PROPOSED, not yet confirmed with Person 1** | See `frontend/src/verification/proof.ts` for the proposed shape (an on-chain pointer object holding a Walrus blob ID, an attestation ID, and an `attestation_mocked` bool) and the rejected alternative. `Deal.proof_ref` is still an unimplemented `Option<ID>` stub in `move/sources/deal.move` — this proposal has to be confirmed once Person 1 builds it out. |

What a real Nautilus integration would require post-hackathon: an AWS
account with Nitro Enclave support (or a Marlin Oyster deployment), a
reproducible Docker build of the enclave's server code, PCR measurement
registration via a Move contract, and a Move-side verifier for the AWS
attestation certificate chain. Budget this as a multi-day infrastructure
project, not a follow-up SDK task.

## Team ownership boundaries

| Person | Owns | Confirm with |
|---|---|---|
| 1 — Move/contracts | `/move/` — AgentIdentity, Reputation, Mandate, Deal, escrow logic, testnet deployment | Everyone depends on Person 1's exact function names/argument order once deployed |
| 2 — Transaction layer | `/frontend/src/sui/` — zkLogin, Enoki, the two PTBs, SuiNS registration, wallet connect UI | Person 1 (Move function signatures), Person 4 (what shape a transaction request arrives in from the agent layer) |
| 3 — Verification/storage | `/frontend/src/verification/` (or a dedicated services package — propose if a separate Node service is cleaner) — Walrus, Seal, Nautilus attestation flow | Person 1 (what proof_ref should point at), Person 2 (how proof_ref gets written into PTB #2) |
| 4 — Frontend + orchestration | `/frontend/src/app/` (UI) and `/frontend/src/agent/` (LLM calls, discovery/matching, scripted specialist stand-ins) | Person 2 (transaction request shape), Person 3 (what proof data looks like once available) |

**RESOLVED — the Move side is built and its signatures are final:**

- `escrow::deal::create_and_lock_escrow(&mut Mandate, &AgentRegistry,
  &AgentIdentity /* client */, Coin<SUI>, ID /* specialist_agent */, String
  /* category */, &Clock, &mut TxContext) -> Deal`
- `escrow::deal::mark_delivered(&mut Deal, &AgentIdentity /* specialist */,
  ID /* proof_ref */, &TxContext)` — a SEPARATE transaction signed by the
  specialist, not part of either PTB.
- `escrow::deal::verify_and_release(&mut Deal, &AgentIdentity /* client */,
  &mut Reputation /* client */, &mut Reputation /* specialist */,
  &mut TxContext) -> Coin<SUI>` — **client-signed only.**
- `escrow::mandate::assert_within_mandate(&Mandate, u64, String, &Clock)`

**Notes for Person 2 before building the PTBs:**

- Use the `entry` wrappers — `deal::create_and_share`,
  `mandate::create_and_share`, `agent_identity::register_and_keep` — or call
  the returning constructor and consume its value with the matching public
  `share`. `Deal`, `Mandate` and `Reputation` are `key` without `store`, so a
  PTB cannot dispose of them any other way and the transaction will fail with
  `UnusedValueWithoutDrop`.
- `create_and_share` returns nothing, so read the new Deal's ID from the
  `DealCreated` event rather than a PTB result.
- Both create paths need the `Clock` at `0x6` and a `category` string.
- `verify_and_release` returns the payout `Coin<SUI>`; the PTB chooses the
  recipient, so `buildVerifyAndReleaseTx` needs a specialist address argument.
- The demo needs a SECOND funded address holding the specialist's
  `AgentIdentity`, because `mark_delivered` requires its owner's signature.
  Nobody currently owns this.

**Registry — decided, built, and shared.** `escrow::agent_identity::init`
creates and shares exactly one `AgentRegistry`. Person 4's discovery reads it
via `agents()`, which returns `vector<AgentSummary>` — note `AgentSummary`
carries `reputation_id`, not the score itself, so ranking needs a second fetch
per agent. Registration enforces unique SuiNS names and a 256-agent cap.

**Category strings are an exact, case-sensitive match** in
`assert_within_mandate`. The Move tests use `"legal-review"` while the UI uses
`["legal", "logistics"]` and `"Legal"`. These must be reconciled into one
canonical list or the first real PTB #1 aborts with `ECategoryNotAllowed`.

**Still genuinely TBD:**
- Package ID and the `AgentRegistry` object ID — filled in at deployment.
  `README.md` needs `VITE_` vars for both; it currently has neither.
- What `proof_ref` points at. Nothing on-chain creates a proof object yet, so
  step 8 cannot close. `Deal.proof_ref` is `Option<ID>` and its type is frozen
  at publish — Person 1 and Person 3 must agree the shape first.
- `UpgradeCap` custody, which determines whether disputed escrow is ever
  recoverable.

Do not guess any of the above in frontend or verification code — leave a
`// VERIFY` / `// TBD` comment and coordinate directly with Person 1

**Known finding — confirm with Person 2 before building wallet-connect
UI:** `@mysten/dapp-kit` (the package originally assumed for wallet
connection) is now fully deprecated per Mysten's own migration guide
(https://sdk.mystenlabs.com/sui/migrations/sui-2.0/dapp-kit). The current
replacement is `@mysten/dapp-kit-react` + `@mysten/dapp-kit-core`
(confirmed on npm, versions pinned in `frontend/package.json`), which
uses gRPC instead of JSON-RPC and Web Components (Lit Elements) for UI
instead of React-specific components — this changes how
`frontend/src/sui/WalletConnect.tsx` needs to be built. See that file's
header comment for detail.
instead.
