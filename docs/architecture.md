# Architecture

The monorepo uses npm workspaces:

- `apps/web`: Next.js 16 App Router UI and HTTPS API, emitted as standalone output.
- `apps/sl-bot`: one long-lived outbox worker. `NodeMetaverseAdapter` is the only module touching pinned `@caspertech/node-metaverse@0.8.21`; `SimulationAdapter` writes a gated test mailbox.
- `packages/contracts`: Zod request/domain contracts.
- `packages/core`: cryptography, accounting parsing, runtime policy, and terminal canonicalization.
- `packages/db`: typed `pg` query boundary, idempotent migration, and seed.
- `lsl`: deployable in-world terminal.

PostgreSQL is authoritative. Browser, Stripe, bot, and terminal adapters only propose events. Transactions and row locks serialize OTP attempts, checkout inventory, invoices, Stripe webhooks, and terminal payments. Durable bot and terminal outboxes decouple world connectivity from requests.

Listings belong to properties and active integer pricing. Rentals retain history. Explicit reservations store creator, target account, expiry, status, notes, and idempotency key without creating payment or lease state. Listing advisory locks and live-row uniqueness serialize reservations against checkout holds and leases. Invoices express exactly one integer denomination: L$ or currency minor units. Payments retain provider references and review status. Audit records cover privileged mutation and authentication events.

`packages/core/src/role-policy.ts` is the permission source for Administrator, Manager, Agent, Renter, and Resident. The authenticated Next.js app uses a responsive shell with distinct dashboard, listings, rentals, reservations, payments, terminals, users, audit, and portal routes. UI visibility is convenience only; routes and transactional services re-authorize. Agent customer lookup is a three-character minimum prefix search capped at ten results rather than a customer-directory download.
