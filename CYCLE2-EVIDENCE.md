# Cycle 2 repair evidence

## Finding-to-fix mapping

1. **Rate limit / proxy** — `docker-compose.yml` enables `TRUST_PROXY`; `http.ts` validates a maximum one-boundary chain and selects the rightmost valid address; `rate-limit.ts` charges the bounded IP bucket before a username bucket and removes expired rows; migration 003 adds the expiry index. Nginx overwrite/append requirements are in `docs/deployment.md` and `docs/security-operations.md`. Behavioral coverage: `http.test.ts`, `rate-limit.test.ts`; runtime spray showed `otp-create-ip=2`, `otp-create-username=21` after 25 names from one IP plus one name from a second IP.
2. **Stripe event retries** — `stripe-events.ts` implements durable PROCESSING leases, FAILED/stale retries, COMPLETE-only duplicate acknowledgement and event digest/type conflict detection. The webhook claims first, applies all DB effects and the final state in one transaction, and records failures separately. PostgreSQL coverage: `stripe-events-postgres.integration.test.ts` exercises first claim, busy duplicate, failure/retry, stale lease, completion duplicate and identity conflict.
3. **Refunds** — `stripe-payments.ts` contains typed expandable-ID helpers for Session, Refund, Charge and Dispute relationships. `stripe-event-handler.ts` stores individual refunds, uses cumulative successful amounts, and leaves partial/pending/failed refunds in MANUAL_REVIEW; only a full successful cumulative refund becomes REFUNDED. Coverage: `stripe-payments.test.ts` and `stripe-payment-postgres.integration.test.ts` exercise string/object/malformed IDs and partial, pending, failed, cumulative success, charge refund and dispute behavior against PostgreSQL.
4. **Durable late refunds** — migration 003 adds `provider_actions` with stable unique idempotency keys, attempts, leases, availability, terminal/resolved states, errors and provider IDs/status. Late payment insertion and action enqueue happen in the webhook effect transaction. `apps/sl-bot/src/payment-worker.ts` is a bounded worker that safely reuses the idempotency key after a crash. Compose exposes it under the explicit `payments` profile. The PostgreSQL payment integration test verifies payment+action durability.
5. **Admin reconciliation** — admin API/page now expose Stripe event exceptions and provider actions. Authorized audited RETRY/RESOLVE operations are available. Unknown terminal payers require explicit identity resolution. Known L$ mismatches require explicit START or EXTENSION and lock current rental state. Payment approval/rejection locks and rejects unresolved refund actions.
6. **Listing PATCH/setup** — `listingMutationSchema` and `listingPatchSchema` are separate; only create has defaults. PATCH includes `stripeSetup` and changes only submitted fields. Public cards/detail/admin show weekly and one-time setup prices in both L$ and decimal fiat. Initial invoice remains setup+week; terminal extensions remain weekly. Coverage: contracts and checkout behavioral tests.
7. **Stripe Checkout** — local holds are 32 minutes and provider expiry is 31 minutes. Open sessions are reused, completed sessions await webhook convergence without relabeling, and expired sessions are transactionally voided/cancelled and replaced. Late completion flows into the durable refund path. `stripe-checkout.test.ts`, checkout hold tests, and PostgreSQL late-payment tests cover these decisions. A bounded Stripe test-mode create/retrieve succeeded with status `open`; no charge was created. Managed Payments is explicitly disabled because the account otherwise rejects inline products without tax codes.
8. **Bot** — node-metaverse login and simulator connection have bounded timeouts; disconnect events immediately clear health; sends and close remain bounded. Bot and payment worker have service-specific configuration validators, so bot startup does not require Stripe. Coverage: adapter timeout/backoff and core runtime-config tests. Compose bot health reached healthy.
9. **Behavioral tests / CI** — payment source-substring assertions were removed. Synthetic provider fixtures now execute real service behavior and PostgreSQL transactions. Existing CI provisions PostgreSQL, migrates/seeds, exports DATABASE_URL, and runs the complete Vitest suite including integration files.
10. **Cleanup / verification** — `*.tsbuildinfo` is ignored and all generated instances were removed after the final build. Branding and `https://hermes-dev-2.tallofam.com` remain intact.

## Verification results

- `npm ci`: pass; 518 packages audited, 0 vulnerabilities.
- ESLint: pass.
- TypeScript project build/typecheck: pass.
- Vitest with PostgreSQL: 14 files, 55 tests passed.
- Production Next/Node build: pass; standalone artifact normalized.
- `npm audit --omit=dev --audit-level=high`: 0 vulnerabilities.
- `docker compose config -q`: pass.
- Final no-cache web image build: pass; earlier full no-cache Compose image build also passed.
- Compose migrate/seed/web/bot: healthy; HTTPS readiness 200, protected admin 307, mailbox 404.
- HTTPS OTP, Secure/HttpOnly/SameSite cookie, admin auth, simulation checkout, dynamic terminal, idempotency and reconciliation smoke: pass.
- Deliberate DB outage: web stayed running and readiness returned 503 with `database:"down"`; recovery returned ready.
- Stripe test-mode Checkout create/retrieve: pass (`open`); no payment/charge submitted.
- LSL: no compiler is installed; local protocol/syntax assertions and JavaScript smoke-script syntax checks passed.

No commit or push was performed.
