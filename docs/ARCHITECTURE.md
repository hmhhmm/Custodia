# Warrant — System Architecture

## Summary

Warrant is a neutral, on-chain trust and settlement layer built on Sui
that lets AI agents discover each other, negotiate privately, verify
delivered work, and get paid automatically via escrow — without a
centralized platform sitting in the middle of the transaction. Envoy is
the companion user-facing personal agent: it talks to a human in plain
language, translates their goal into a scoped mandate, and drives the
Warrant flow on their behalf. This document is the shared source of truth
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
Warrant (on-chain trust layer)
  │  identity, reputation, mandate enforcement, escrow lock/release
  ▼
Sui Move objects
     AgentIdentity · Reputation · Mandate · Deal
```

Envoy never holds funds or bypasses a Mandate — every spend it initiates
is checked against an on-chain Mandate object before Warrant will lock
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
| score | u64 | PROPOSED scoring formula — confirm with team before implementing |

### Mandate
| Field | Type | Notes |
|---|---|---|
| owner | address | The human delegating spend authority |
| delegate | address | The agent authorized to spend |
| max_spend | u64 | |
| spent_so_far | u64 | |
| allowed_categories | vector\<String\> | |
| expires_at | u64 | PROPOSED representation (epoch ms vs. epoch number) — confirm against Sui Clock docs |
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
4. **Negotiate** — Envoy and the specialist agent exchange terms;
   sensitive negotiation content may be Seal-encrypted (Person 3).
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
| Nautilus | Step 8 — attesting that delivered work matches what was promised. HIGHEST RISK; per /CLAUDE.md rule 6 the demo uses a clearly-labeled MOCKED attestation (`frontend/src/verification/nautilus.mock.ts`) as the primary deliverable, not a last-resort fallback — see "Verification Layer Implementation Notes" below |
| Walrus | Step 8 — storing deliverable artifacts / proof material off-chain. REAL, via the public testnet HTTP API (`frontend/src/verification/walrus.ts`) |
| SuiNS | Step 3 (and AgentIdentity.suins_name generally) — human-readable agent identities for discovery |

Out of scope for the working demo (roadmap only): Onchain Randomness,
DeepBook, Kiosk, full confidential balances. Do not implement these even
if a task seems to invite it.

## Verification Layer Implementation Notes

Status of Person 3's scope as of this writing:

| Piece | Status | Notes |
|---|---|---|
| Walrus | **Real** | HTTP API via public testnet publisher/aggregator, confirmed against the installed `accessing-data` Sui skill (docs.wal.app returned 403 to direct fetches this session — the skill's `walrus.md` was the working verification source). Endpoints are community-run and may change; re-verify against docs.wal.app before mainnet. |
| Seal | **Real, untested end-to-end** | `@mysten/seal` package name confirmed via docs.sui.io. Encrypt/decrypt call shapes and the `seal_approve` Move convention are documented and implemented per-spec, but have not been exercised against a live Seal key server or a deployed `warrant::deal_access` module. The allowlist policy is modeled on Mysten's own whitelist reference pattern, scoped down to exactly the two agents in a Deal. |
| Nautilus | **Mocked — by design, not as a fallback** | Real Nautilus requires deploying an actual AWS Nitro Enclave (or Marlin Oyster), registering PCR measurements on-chain, and verifying AWS certificate chains in Move — genuine infrastructure work, not an SDK call, and Mysten's own template is explicitly unaudited/incomplete. `frontend/src/verification/nautilus.mock.ts` returns a structurally drop-in attestation shape (`{ attestationId, taskId, resultHash, timestamp, verified, mocked: true }`) so a real implementation can replace it later without changing `Deal.proof_ref`'s format. Every consumer (UI, logs) must surface the `mocked` flag — never let a simulated attestation appear indistinguishable from a real one in the demo. |
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

**TBD — fill in once Person 1 deploys to testnet:**
- Exact Move function names and argument order for
  `warrant::deal::create_and_lock_escrow`, `warrant::deal::mark_delivered`,
  `warrant::deal::verify_and_release`, `warrant::mandate::assert_within_mandate`.
- Package ID / object IDs for any shared objects (e.g. a registry, if one
  turns out to be needed for discovery — not yet decided).
- Reputation scoring formula.

Do not guess any of the above in frontend or verification code — leave a
`// VERIFY` / `// TBD` comment and coordinate directly with Person 1
instead.
