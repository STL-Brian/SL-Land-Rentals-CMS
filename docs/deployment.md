# Deployment

## Production configuration

Set `PUBLIC_SCHEME=https`, an HTTPS `PUBLIC_BASE_URL`, `SESSION_COOKIE_SECURE=true`, and `SIMULATION_MODE=false`. Provide PostgreSQL, Stripe, and dedicated SL bot credentials through runtime secrets. The bot account should have no unnecessary estate powers.

Run the migration job before web and bot rollout. Migrations 001–004 remain immutable; migration 005 replaces the legacy ADMIN enum value with ADMINISTRATOR, adds Manager/Agent/Resident roles and the Resident default, and creates explicit reservation state. The SQL migration is safe to rerun; schema constraints remain the final defense for money and rental state. Back up PostgreSQL and retain provider/L$ transaction records for reconciliation.

## Health and runtime

- `/api/health/live`: process liveness only.
- `/api/health/ready`: performs `SELECT 1`; returns 503 if PostgreSQL is unavailable.
- Web artifact: `node .next/standalone/server.js` as a non-root user.
- Bot: `node apps/sl-bot/dist/index.js` as a non-root user; SIGTERM closes the grid connection and pool. Compose health queries the worker heartbeat, PostgreSQL reachability, and adapter-connected state (including the real grid adapter).
- Payment worker: `node apps/sl-bot/dist/payment-worker.js` as a non-root user. It is a default, required Compose service with its own database-backed heartbeat health check. Simulation mode drains durable provider actions through a deterministic no-charge adapter; real mode requires `STRIPE_SECRET_KEY` and drains them through Stripe with the stored idempotency key. Both modes require an active drainer.

Second Life account lookup uses the official `POST https://api.secondlife.com/get_agent_id` endpoint with `SL_API_KEY`; one-part names default to the `Resident` last name. Real mode also requires `TERMINAL_SECRET_ENCRYPTION_KEY` (at least 32 characters). Terminal secrets are AES-256-GCM encrypted at rest and decrypted only while verifying a signed request. Set `TRUST_PROXY=true` only behind the documented trusted reverse proxy; otherwise forwarded client-IP headers are ignored.

The default Compose file is the nginx-fronted simulation deployment for `https://hermes-dev-2.tallofam.com`, so it enables `TRUST_PROXY=true`. It maps host port `4000` to container port 3000; PostgreSQL has no host port and the application exposes no simulation-mailbox route. The application trusts exactly one nginx boundary and uses the rightmost valid `X-Forwarded-For` address. Nginx **must** remove client-supplied forwarding headers at that boundary, then set `X-Forwarded-For` from `$proxy_add_x_forwarded_for` (or overwrite it with `$remote_addr`). Never expose port 4000 directly while proxy trust is enabled. Malformed, empty, repeated/coalesced overlong chains fail closed to the bounded `direct` bucket.

Production database configuration must provide a raw `POSTGRES_PASSWORD` to PostgreSQL and a separately constructed `DATABASE_URL` with the password RFC 3986 percent-encoded. Raw interpolation into the URI is unsupported and unsafe.

## One-shot real bot connection smoke

Keep the simulation deployment running. After `npm run build`, an authorized operator can inject only the Second Life login fields into the narrow connection consumer (no Stripe configuration is needed):

```sh
HERMES_HOME="${HERMES_HOME:-/home/brian/.hermes}" \
python3 /home/brian/.local/share/hermes-vaultwarden/vault_access.py run \
  --item-id 6559b9db-af54-4286-954c-fe2e36ac659e \
  --username-env SL_BOT_USERNAME \
  --password-env SL_BOT_PASSWORD \
  --timeout 70 -- node scripts/smoke-sl-bot-login.mjs
```

The helper supplies values only to the bounded child process and redacts exact secret bytes from output. Do not add these credentials to files, Compose, command arguments, or logs.
