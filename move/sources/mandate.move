// Owner: Person 1 (Move/contracts).
//
// Mandate is a scoped spending delegation from a human owner to an agent (the
// delegate) — caps total spend, restricts categories, and expires. Checked
// before PTB #1 (lock-escrow-and-create-deal) is allowed to proceed. See
// /docs/ARCHITECTURE.md for the end-to-end sequence.
//
// Shared object, and this is forced rather than chosen: the whole point of a
// Mandate is that the DELEGATE — an address that is not the owner — spends
// against it and mutates `spent_so_far`. An address-owned object can only be
// used in a transaction by its owner, so an owned Mandate could never be spent
// by the agent it delegates to.
//
// WHAT THIS DOES AND DOES NOT ENFORCE — read before repeating a pitch line.
//
// A Mandate is a counter, not a custodian: it holds no Balance, and
// `deal::create_and_lock_escrow` spends a `Coin<SUI>` from the delegate's own
// wallet. So the cap constrains A CHANNEL, NOT AN AGENT. Conditional on the
// spend going through Escrow's escrow flow, the cap, category allowlist,
// expiry and revocation are hard aborts and `record_spend` is
// `public(package)`, so the counter cannot be reset from outside the package.
// That much genuinely is enforced by code. But the delegate address holds its
// own SUI and can move it anywhere without touching this module at all, and a
// delegate that hits its cap can self-issue a fresh uncapped Mandate, since
// `new` makes the sender the owner.
//
// Accurate: "spending through Escrow is capped by an on-chain mandate the
// human can revoke instantly." NOT accurate: "this agent cannot spend more
// than X." Making the stronger claim true requires the Mandate to custody the
// funds (a `Balance<SUI>` deposited by the owner, withdrawn by
// `create_and_lock_escrow`) so the delegate key never has spend authority over
// the principal. That adds a field to a core object, so per /CLAUDE.md rule 5
// it needs team sign-off — it is deliberately NOT done here. Ship custody or
// ship the accurate sentence; do not ship the strong claim over this code.
module escrow::mandate;

use std::string::String;
use sui::clock::Clock;
use sui::event;

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

/// Creates a Mandate delegating scoped spend authority to `delegate`.
/// The transaction sender becomes the owner.
///
/// Returns the object rather than sharing internally, so it stays composable
/// in a PTB. Use `create_and_share` for the convenience path.
public fun new(
    delegate: address,
    max_spend: u64,
    allowed_categories: vector<String>,
    expires_at: u64,
    ctx: &mut TxContext,
): Mandate {
    let mandate = Mandate {
        id: object::new(ctx),
        owner: ctx.sender(),
        delegate,
        max_spend,
        spent_so_far: 0,
        allowed_categories,
        expires_at,
        revoked: false,
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

/// Shares a Mandate. `Mandate` has `key` and no `store`, so `share_object` is
/// restricted to this module and `public_share_object` is unavailable — a PTB
/// that called `new` would otherwise hold a value it cannot consume and the
/// whole transaction would fail with `UnusedValueWithoutDrop`. This is the
/// public consume path that makes `new` genuinely composable.
public fun share(mandate: Mandate) {
    transfer::share_object(mandate);
}

/// Aborts unless `amount` in `category` is permitted right now. Called from
/// `escrow::deal::create_and_lock_escrow` before any funds move — if this
/// aborts, the entire PTB reverts and no escrow is locked.
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
}

/// Aborts unless the transaction sender is this mandate's delegate. This is
/// what stops an arbitrary address from spending someone else's mandate.
public fun assert_is_delegate(mandate: &Mandate, ctx: &TxContext) {
    assert!(ctx.sender() == mandate.delegate, ENotDelegate);
}

/// Records a spend against the mandate. Package-visible: only Escrow's own
/// escrow flow may advance `spent_so_far`, never a direct PTB call.
///
/// The assert restates what `assert_within_mandate` already guarantees at the
/// only real call site. It is here because nothing structurally forces the two
/// to be called as a pair — a future module in this package could call
/// `record_spend` alone and push `spent_so_far` past `max_spend`, after which
/// `remaining()` would be permanently broken.
public(package) fun record_spend(mandate: &mut Mandate, amount: u64) {
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

/// Remaining spendable budget. Convenience for Person 4's mandate snapshot UI.
/// Saturating: a read-only getter should never abort a caller's transaction,
/// even if the invariant above were ever violated.
public fun remaining(mandate: &Mandate): u64 {
    if (mandate.spent_so_far >= mandate.max_spend) 0
    else mandate.max_spend - mandate.spent_so_far
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
