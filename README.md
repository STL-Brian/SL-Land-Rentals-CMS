# Lake Tech Estates

A production-minded Second Life land-rental MVP: a Next.js 16 website, PostgreSQL system of record, dedicated Node.js bot, Stripe and simulation payment adapters, and a signed LSL rental terminal.

## Run the complete simulation stack

```bash
cp .env.example .env
docker compose up --build --wait
```

The default stack always starts both durable queue drainers: `sl-bot` for Second Life outbox work and the healthy `payment-worker` for provider actions. In the checked-in simulation mode the payment worker records deterministic simulated refund completion without contacting Stripe. In real mode (`SIMULATION_MODE=false`), provide `STRIPE_SECRET_KEY`; the same worker submits Stripe refunds with the durable action's stable idempotency key. Do not deploy either mode without the payment worker.

The container listens on `0.0.0.0:3000`, mapped to host port `4000`. The configured public URL is <https://hermes-dev-2.tallofam.com>; nginx reverse-proxies that origin to `http://192.168.6.56:4000`. No database port is published and no external credentials are needed.

### Demo login

1. Use one of the seeded simulation identities: `avery administrator`, `morgan manager`, `alex agent`, `mira renter`, or `riley resident`.
2. From an operator shell with direct database access, run
   `DATABASE_URL='postgresql://lake_tech:***@DATABASE_HOST:5432/lake_tech' node scripts/read-simulation-mailbox.mjs 'avery administrator'`.
3. Enter the eight-digit code. The web application has no mailbox endpoint; PostgreSQL is not published by Compose.

Role destinations are `/dashboard` for Administrator/Manager, `/management/reservations` for Agent, and `/portal` for Renter/Resident. `/admin` remains a compatibility redirect. Management is split across listings, rentals, reservations, payments, terminals, users, and audit pages; navigation and server authorization both derive from the central permission policy.

Run `node scripts/smoke-roles.mjs` against the HTTPS simulation stack to verify all five seeded identities, role redirects and API denials, scoped account search, renter ownership checks, Agent reservation create/cancel, security headers, and the absence of a web mailbox route.

For an API smoke flow, preserve cookies and send the configured browser Origin:

```bash
curl -s -X POST -H 'Origin: https://hermes-dev-2.tallofam.com' -H 'Content-Type: application/json' -d '{"username":"avery administrator"}' https://hermes-dev-2.tallofam.com/api/auth/challenge
# Read the code with scripts/read-simulation-mailbox.mjs from the operator network, then:
curl -si -c /tmp/lake-tech-estates.cookies -X POST -H 'Origin: https://hermes-dev-2.tallofam.com' -H 'Content-Type: application/json' -d '{"username":"avery administrator","code":"00000000"}' https://hermes-dev-2.tallofam.com/api/auth/verify
curl -b /tmp/lake-tech-estates.cookies https://hermes-dev-2.tallofam.com/dashboard
```

## Local development

Node 24 and npm 12 are supported.

```bash
npm ci
docker compose up -d postgres
export DATABASE_URL=postgresql://lake_tech:lake_tech_local_dev@localhost:5432/lake_tech # only for a separately published local DB
npm run db:migrate && npm run db:seed
npm run dev
```

The Compose database intentionally is not exposed. Use a disposable PostgreSQL or `docker compose run` for host-side migration testing.

## Quality gates

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm audit --omit=dev
docker compose config -q
```

The web production command is exactly `node .next/standalone/server.js`. See [deployment](docs/deployment.md), [architecture](docs/architecture.md), [security](docs/security.md), [security operations](docs/security-operations.md), and the [terminal/API protocol](docs/protocol.md).

## Important L$ caveat

Second Life’s LSL `money` event provides payer and amount but **no transaction ID**. The terminal persists its own event UUID before calling HTTPS, and the server deduplicates by terminal + event ID. A script reset, object replacement, or platform delivery anomaly can still require manual reconciliation against the account transaction history. Wrong amounts are never silently credited: they become `MANUAL_REVIEW`. Refunds are an estate operator action; this app does not claim it can safely issue automated L$ refunds.
