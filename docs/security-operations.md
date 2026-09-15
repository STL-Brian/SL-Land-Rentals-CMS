# Security operations

## Simulation login (operator only)

There is no HTTP mailbox endpoint. In simulation, request the OTP in the browser/API and read it only from a host with direct access to the unpublished PostgreSQL service:

```sh
DATABASE_URL='postgresql://lake_tech:lake_tech_local_dev@127.0.0.1:5432/lake_tech' \
  node scripts/read-simulation-mailbox.mjs 'admin resident'
```

Do not publish PostgreSQL or this command through the web application. Simulation identities are test fixtures, never production accounts.

## Terminal provisioning and LSL limitations

An ADMIN pairs a terminal in **Control room → Terminal pairing** using the exact object UUID, owner UUID, listing, and shard. The server generates a 256-bit secret, stores only AES-256-GCM ciphertext, and shows plaintext once. Put that value into `TERMINAL_SECRET` in `lsl/rental-terminal.lsl`, then make the script **no-modify** and the containing object no-modify for recipients. Revoke a missing/replaced object; rotate after any accidental disclosure and update the object immediately.

LSL cannot provide perfect secret protection: an owner or sufficiently privileged editor can inspect or replace scripts/configuration. Use a dedicated, low-balance terminal owner account; restrict object/script modify and take/copy/transfer permissions; do not deed to an uncontrolled group; keep the object owned by the paired owner UUID. Treat a transferred or modifiable object as compromised.

The terminal writes each payment event to linkset data before sending HTTPS. The queue is bounded at 32. Persistence failure stops the request and alerts payer and owner.

## Retention

Authenticated terminal traffic removes replay nonces older than 7 days and outbound poll events older than 30 days using indexed timestamps. OTP outbox rows dead-letter after eight attempts or challenge expiry. Operational backups and audit logs follow the estate retention policy and are not hard-deleted by reconciliation.

## Production database credentials and proxies

`docker-compose.yml` is explicitly a local simulation stack and uses the fixed non-secret `lake_tech_local_dev` password consistently. Production must inject two separately prepared values: raw `POSTGRES_PASSWORD`, and a `DATABASE_URL` whose password component is RFC 3986 percent-encoded. Never interpolate a raw password into a URI.

The checked-in nginx-fronted stack uses `TRUST_PROXY=true` for `https://hermes-dev-2.tallofam.com`. Nginx must be the only reachable boundary, strip every inbound `X-Forwarded-For`/`X-Real-IP` field, and then write/append its trusted value (`proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for`). The app selects the rightmost valid address and rejects malformed or overlong coalesced/repeated forms. Use `TRUST_PROXY=false` for any deployment whose application port is directly reachable.
