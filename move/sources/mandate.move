// Owner: Person 1 (Move/contracts).
//
// Mandate is a scoped spending delegation from a human owner to an agent (the
// delegate) — it CUSTODIES the funds, caps total spend, restricts categories,
// and expires. Checked and drawn against by PTB #1
// (lock-escrow-and-create-deal). See /docs/ARCHITECTURE.md for the sequence.
//
// Shared object, and this is forced rather than chosen: the whole point of a
// Mandate is that the DELEGATE — an address that is not the owner — spends
// against it and mutates `spent_so_far`. An address-owned object can only be
// used in a transaction by its owner, so an owned Mandate could never be spent
// by the agent it delegates to.
//
// CUSTODY — this is what makes the cap real (changed 2026-08-31).
//
// The Mandate previously held no funds. It was a counter, and
// `create_and_lock_escrow` spent a `Coin<SUI>` from the delegate's own wallet,
// which meant the cap constrained a CHANNEL, not an AGENT: the delegate could
// move its own SUI anywhere without touching this module, and a delegate that
// hit its cap could self-issue a fresh uncapped Mandate and carry on. The
// pitch line "this cap is enforced by code, not a promise" was false.
//
// Now the human owner DEPOSITS SUI into the Mandate and
// `withdraw_for_escrow` is the only way out of it into a Deal. The delegate
// key never holds the principal at all. Two consequences worth naming:
//
//   * The self-issuance bypass evaporates without any new access control — a
//     self-issued Mandate has a zero balance and is worthless.
//   * With Enoki sponsoring gas, the agent key holds NO SUI whatsoever,
//     neither principal nor gas. That is a materially stronger claim than the
//     one this file used to carry, and it is now true.
//
// `max_spend` and `funds` are deliberately independent: `max_spend` is
// AUTHORISATION, `funds` is CUSTODY. The effective limit is
// `min(max_spend - spent_so_far, funds)`, exposed as `spendable()`. A human
// can custody 100 SUI while authorising 10, then widen later without moving
// money.
module escrow::mandate;

use std::string::String;
use sui::balance::{Self, Balance};
use sui::clock::Clock;
use sui::coin::{Self, Coin};
use sui::event;
use sui::sui::SUI;

#[error]
const ENotOwner: vector<u8> = b"Only the mandate owner can perform this action";

#[error]
const ENotDelegate: vector<u8> = b"Caller is not the delegate authorized by this mandate";

#[error]
const ERevoked: vector<u8> = b"Mandate has been revoked";

#[error]
const EExpired: vector<u8> = b"Mandate has expired";

#[error]
const ECategoryNotAllowed: vector<u8> = b"Category is not permitted by this mandate";

#[error]
const ESpendLimitExceeded: vector<u8> = b"Spend would exceed the mandate's max_spend";

#[error]
const EInsufficientMandateFunds: vector<u8> = b"Mandate does not custody enough SUI for this spend";

#[error]
const ERefundExceedsSpend: vector<u8> = b"Refund exceeds what this mandate has spent";

#[error]
const EDelegateIsOwner: vector<u8> = b"A mandate must delegate to an address other than its owner";

#[error]
const EInvalidMandate: vector<u8> = b"Mandate parameters are not usable";

public struct Mandate has key {
    id: UID,
    owner: address,
    delegate: address,
    max_spend: u64,
    spent_so_far: u64,
    allowed_categories: vector<String>,
    /// RESOLVED (was PROPOSED in /docs/ARCHITECTURE.md): epoch MILLISECONDS,
    /// compared against `sui::clock::Clock.timestamp_ms()`. Chosen over an
    /// epoch number because a mandate's time window ("within 2 hours") is
    /// sub-epoch, and Clock is the precise source — `ctx.epoch_timestamp_ms()`
    /// only returns the epoch start time.
    expires_at: u64,
    revoked: bool,
    /// NEW 2026-08-31 — the custodied principal. See the CUSTODY note above.
    /// This is a change to a core object's fields per /CLAUDE.md rule 5 and
    /// was flagged to the team before landing.
    funds: Balance<SUI>,
}

public struct MandateCreated has copy, drop {
    mandate_id: ID,
    owner: address,
    delegate: address,
    max_spend: u64,
    expires_at: u64,
}

public struct MandateRevoked has copy, drop {
    mandate_id: ID,
    owner: address,
}

public struct MandateFunded has copy, drop {
    mandate_id: ID,
    amount: u64,
    balance_after: u64,
}

public struct MandateReclaimed has copy, drop {
    mandate_id: ID,
    amount: u64,
}

public struct MandateRefunded has copy, drop {
    mandate_id: ID,
    amount: u64,
    spent_after: u64,
}

/// Creates an UNFUNDED Mandate delegating scoped spend authority to
/// `delegate`. The transaction sender becomes the owner. Deposit separately,
/// or use `create_funded_and_share`.
///
/// Returns the object rather than sharing internally, so it stays composable
/// in a PTB — consume the value with the public `share` below.
///
/// `delegate != owner` is enforced. A mandate naming its own owner as delegate
/// is not a delegation, it is a person capping themselves, and it was the
/// shape the old self-issuance bypass relied on. Note this means the demo
/// needs a SECOND address for the agent — flagged to Person 2 and Person 4.
public fun new(
    delegate: address,
    max_spend: u64,
    allowed_categories: vector<String>,
    expires_at: u64,
    ctx: &mut TxContext,
): Mandate {
    assert!(delegate != ctx.sender(), EDelegateIsOwner);
    assert!(delegate != @0x0, EInvalidMandate);
    assert!(max_spend > 0, EInvalidMandate);
    assert!(!allowed_categories.is_empty(), EInvalidMandate);

    let mandate = Mandate {
        id: object::new(ctx),
        owner: ctx.sender(),
        delegate,
        max_spend,
        spent_so_far: 0,
        allowed_categories,
        expires_at,
        revoked: false,
        funds: balance::zero(),
    };

    event::emit(MandateCreated {
        mandate_id: object::id(&mandate),
        owner: mandate.owner,
        delegate,
        max_spend,
        expires_at,
    });

    mandate
}

entry fun create_and_share(
    delegate: address,
    max_spend: u64,
    allowed_categories: vector<String>,
    expires_at: u64,
    ctx: &mut TxContext,
) {
    share(new(delegate, max_spend, allowed_categories, expires_at, ctx));
}

/// Create, fund, and share in one call — the path Person 2's UI should use,
/// since an unfunded Mandate cannot authorise anything.
entry fun create_funded_and_share(
    delegate: address,
    max_spend: u64,
    allowed_categories: vector<String>,
    expires_at: u64,
    funding: Coin<SUI>,
    ctx: &mut TxContext,
) {
    let mut mandate = new(delegate, max_spend, allowed_categories, expires_at, ctx);
    mandate.deposit(funding, ctx);
    share(mandate);
}

/// Shares a Mandate. `Mandate` has `key` and no `store`, so `share_object` is
/// restricted to this module and `public_share_object` is unavailable — a PTB
/// that called `new` would otherwise hold a value it cannot consume and the
/// whole transaction would fail with `UnusedValueWithoutDrop`.
public fun share(mandate: Mandate) {
    transfer::share_object(mandate);
}

/// Owner-only. Adds principal to the mandate. Repeated calls are a top-up.
///
/// The owner-only restriction is accounting hygiene, not a security boundary:
/// a third party depositing would merely be donating, since `reclaim` always
/// pays the owner. Stated plainly so nobody mistakes it for a guard.
public fun deposit(mandate: &mut Mandate, funding: Coin<SUI>, ctx: &TxContext) {
    assert!(ctx.sender() == mandate.owner, ENotOwner);

    let amount = funding.value();
    mandate.funds.join(funding.into_balance());

    event::emit(MandateFunded {
        mandate_id: object::id(mandate),
        amount,
        balance_after: mandate.funds.value(),
    });
}

/// Owner-only. Withdraws ALL unspent principal, unconditionally.
///
/// Deliberately NOT gated on revoked/expired: revocation governs
/// AUTHORISATION, custody governs MONEY, and coupling them buys nothing. It
/// cannot strand a live deal either — funds for a live Deal already moved into
/// the Deal object at creation. It does mean an owner can empty a mandate
/// under the delegate's feet, which is the human's prerogative over their own
/// money and belongs in Person 4's UI as a warning, not in Move as a block.
public fun reclaim(mandate: &mut Mandate, ctx: &mut TxContext): Coin<SUI> {
    assert!(ctx.sender() == mandate.owner, ENotOwner);

    let amount = mandate.funds.value();
    event::emit(MandateReclaimed { mandate_id: object::id(mandate), amount });

    coin::from_balance(mandate.funds.withdraw_all(), ctx)
}

/// Aborts unless `amount` in `category` is permitted right now. Called from
/// `escrow::deal::create_and_lock_escrow` before any funds move — if this
/// aborts, the entire PTB reverts and no escrow is locked.
///
/// Signature unchanged so Person 2's existing call site survives; the custody
/// check was added to the body, which upgrade rules permit.
public fun assert_within_mandate(
    mandate: &Mandate,
    amount: u64,
    category: String,
    clock: &Clock,
) {
    assert!(!mandate.revoked, ERevoked);
    assert!(clock.timestamp_ms() < mandate.expires_at, EExpired);
    assert!(mandate.allowed_categories.contains(&category), ECategoryNotAllowed);

    // Subtraction, not `spent_so_far + amount <= max_spend`: the addition can
    // overflow u64 and abort with a raw arithmetic error instead of the
    // intended ESpendLimitExceeded. `spent_so_far <= max_spend` is an invariant
    // held by `record_spend`, so the subtraction cannot underflow.
    assert!(mandate.spent_so_far <= mandate.max_spend, ESpendLimitExceeded);
    assert!(amount <= mandate.max_spend - mandate.spent_so_far, ESpendLimitExceeded);

    // Authorisation is not custody: a mandate may authorise more than it holds.
    assert!(mandate.funds.value() >= amount, EInsufficientMandateFunds);
}

/// Aborts unless the transaction sender is this mandate's delegate. This is
/// what stops an arbitrary address from spending someone else's mandate.
public fun assert_is_delegate(mandate: &Mandate, ctx: &TxContext) {
    assert!(ctx.sender() == mandate.delegate, ENotDelegate);
}

/// The ONLY path from custody into a Deal. `public(package)` so it can never
/// be called directly from a PTB — escrow creation is the sole consumer.
public(package) fun withdraw_for_escrow(
    mandate: &mut Mandate,
    amount: u64,
    category: String,
    clock: &Clock,
    ctx: &mut TxContext,
): Coin<SUI> {
    mandate.assert_is_delegate(ctx);
    mandate.assert_within_mandate(amount, category, clock);
    mandate.record_spend(amount);

    coin::take(&mut mandate.funds, amount, ctx)
}

/// Return path for refunds and settlements. Restores both the custodied
/// balance and the spent counter, so a refunded deal does not permanently
/// burn the human's budget.
///
/// Deliberately does NOT check `revoked` or `expires_at`. Returning the
/// human's own money to the human's own custody object must not be blockable
/// by a state the human themselves set — a revoked mandate still accepts
/// refunds, and the owner then reclaims.
public(package) fun refund(mandate: &mut Mandate, returned: Coin<SUI>) {
    let amount = returned.value();
    assert!(amount <= mandate.spent_so_far, ERefundExceedsSpend);

    mandate.spent_so_far = mandate.spent_so_far - amount;
    mandate.funds.join(returned.into_balance());

    event::emit(MandateRefunded {
        mandate_id: object::id(mandate),
        amount,
        spent_after: mandate.spent_so_far,
    });
}

/// Records a spend against the mandate. Package-visible: only Escrow's own
/// escrow flow may advance `spent_so_far`, never a direct PTB call.
fun record_spend(mandate: &mut Mandate, amount: u64) {
    assert!(amount <= mandate.max_spend - mandate.spent_so_far, ESpendLimitExceeded);
    mandate.spent_so_far = mandate.spent_so_far + amount;
}

/// Owner-only. Flipping `revoked` is the entire "revoke instantly" feature —
/// every subsequent `assert_within_mandate` aborts immediately.
public fun revoke(mandate: &mut Mandate, ctx: &TxContext) {
    assert!(ctx.sender() == mandate.owner, ENotOwner);
    mandate.revoked = true;

    event::emit(MandateRevoked {
        mandate_id: object::id(mandate),
        owner: mandate.owner,
    });
}

public fun owner(mandate: &Mandate): address {
    mandate.owner
}

public fun delegate(mandate: &Mandate): address {
    mandate.delegate
}

public fun max_spend(mandate: &Mandate): u64 {
    mandate.max_spend
}

public fun spent_so_far(mandate: &Mandate): u64 {
    mandate.spent_so_far
}

/// Custodied principal currently held.
public fun funds(mandate: &Mandate): u64 {
    mandate.funds.value()
}

/// Remaining authorised budget. Saturating: a read-only getter should never
/// abort a caller's transaction.
public fun remaining(mandate: &Mandate): u64 {
    if (mandate.spent_so_far >= mandate.max_spend) 0
    else mandate.max_spend - mandate.spent_so_far
}

/// What can actually be spent right now — `min(authorised, custodied)`. This
/// is the number Person 4's mandate snapshot should show, not `remaining()`,
/// because a mandate authorising 10 while holding 2 can only spend 2.
public fun spendable(mandate: &Mandate): u64 {
    let r = mandate.remaining();
    let f = mandate.funds.value();
    if (r < f) r else f
}

public fun allowed_categories(mandate: &Mandate): vector<String> {
    mandate.allowed_categories
}

public fun expires_at(mandate: &Mandate): u64 {
    mandate.expires_at
}

public fun is_revoked(mandate: &Mandate): bool {
    mandate.revoked
}
