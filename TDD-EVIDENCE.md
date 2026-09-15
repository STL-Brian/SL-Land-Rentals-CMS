# TDD evidence

Focused regressions were authored first, observed RED, then made GREEN:

1. `apps/web/src/lib/sl-name.test.ts`: RED because `sl-name.js` did not exist; GREEN with 4 tests covering canonical/default-Resident parsing, official POST shape, API-key header, failures, and UUID validation.
2. `packages/core/src/security.test.ts` and `policy.test.ts`: RED with 5 failures for hex terminal signatures, missing terminal-secret encryption, missing L$ authorization decisions, and missing real-mode keys; GREEN with 12 tests.
3. `apps/web/src/lib/http.test.ts` and `rate-limit.test.ts`: RED with a missing limiter module and missing trusted-proxy handling; GREEN with 6 tests covering fixed-window and hit-limit boundaries plus forwarded-IP trust.
4. `apps/web/src/lib/checkout.test.ts`: RED because `checkout.js` did not exist; GREEN with 3 tests covering pending-hold creation order, exact one-week settlement, and binding mismatch rejection.
5. `scripts/smoke-terminal-event-conflict.mjs`: RED when a reused event ID with changed signed body incorrectly returned 200; GREEN after binding idempotency to the stored body hash, payer, and amount.

6. `apps/web/src/lib/review-regressions.test.ts`: seven repair-cycle requirements tests were observed RED (7/7), then GREEN; a database-timeout regression and terminal setup-price regression were each added and independently observed RED before implementation.
7. `apps/web/src/lib/otp-postgres.integration.test.ts`: exercises the canonical identity advisory lock using two real PostgreSQL connections and verifies a new challenge invalidates the prior challenge.

Repair-cycle final local suite: 36 tests passed; the PostgreSQL-only test is skipped without `DATABASE_URL` and separately passed against the Compose PostgreSQL network.

## Cycle 3

1. `checkout-snapshot.test.ts` and `cycle3-payment-postgres.integration.test.ts` were first run RED because the checkout snapshot and reconciliation services did not exist. They are GREEN with real invoice/pricing mutation, synchronized row-lock retry, expired-hold allocation, state-gate, exhausted-action, and worker crash-recovery behavior.
2. `policy.test.ts` was observed RED with `STRIPE_SECRET_KEY is required` for simulation, then GREEN after separating simulation and real payment-worker configuration.
3. `control-room-ui.test.ts` was observed RED with a missing pricing editor and missing terminal rebind control, then GREEN against rendered React markup.
4. The checkout price-recovery PostgreSQL case was independently observed RED with `loadExistingCheckoutAttempt is not a function`, then GREEN after moving the locked invoice-snapshot load into the shared checkout-attempt service used by the route.

Cycle-3 focused suite: 18 tests passed. Final full PostgreSQL suite: 17 files and 65 tests passed.
