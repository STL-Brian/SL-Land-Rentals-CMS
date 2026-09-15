# Terminal and payment protocol

## Signed terminal requests

Required headers: `X-SL-Timestamp`, `X-SL-Nonce`, `X-SL-Event-ID`, `X-SL-Object-ID`, `X-SL-Owner-ID`, `X-SL-Shard`, `X-SL-Signature`.

The canonical UTF-8 text is exactly:

```text
<unix timestamp>\n
<nonce>\n
<event ID>\n
<lowercase SHA-256 hex of the exact HTTP body>
```

`X-SL-Signature` is standard padded Base64 HMAC-SHA256 over that text using the terminal’s per-object secret, matching `llHMAC`. GET poll has an empty body. The API rejects timestamp drift beyond 300 seconds, replayed nonces, mismatched object/owner/shard, changed bytes, or disabled devices.

- `GET /api/terminal/poll?sequence=N` returns current renter, Unix lease end, pay price, monotonic outbound sequence, and events.
- `POST /api/terminal/payment` accepts exact JSON with positive integer `amountLinden` and UUID `payerAvatarId`. Identity is terminal + event ID. An exact payment extends an active lease only when the payer is its linked avatar. On an available listing, an exact payment from a known linked avatar starts a one-week rental. Unknown payers, unauthorized payers, mismatches, and allocation conflicts are durably stored as `MANUAL_REVIEW`.

The server—not hover text or object memory—is authoritative. See README for the unavoidable LSL money-event reconciliation caveat.

## Browser and Stripe

`POST /api/checkout` accepts only a listing ID. The server locks inventory and derives customer, amount, currency, and description. In the same transaction it creates a 32-minute `PENDING` rental hold and an invoice bound to that hold; a partial unique index permits only one `PENDING` or `ACTIVE` rental per listing. Expired holds are cancelled, their open invoices voided, and unfinished checkout attempts expired before every checkout, terminal START, or reconciliation START allocation. Simulation and the raw-body-verified, idempotent Stripe webhook settle through the same transaction, which activates that exact hold for one week. `/checkout/success` is informational and performs no activation.
