# Terminal callback validation

The repository has TypeScript protocol vectors and worker tests, but no runnable LSL compiler or in-world simulator. Validate the final object manually in Second Life after pairing a disposable terminal:

1. Rez the configured `lsl/rental-terminal.lsl` object, set the per-object secret and terminal UUID, and confirm it obtains an HTTPS URL and registers its callback.
2. Deliver a valid worker callback body. The outer JSON is `{version:1,signedBody,signature}`; the signature is HMAC-SHA256 base64 over the exact UTF-8 `signedBody` string. Confirm the script returns HTTP 200 and updates hovertext/payment state.
3. Replay the same body and confirm HTTP 409 with no second state change.
4. Send a body with a modified signed body, invalid signature, missing required field, or stale/lower sequence and confirm a non-2xx response and unchanged display state.
5. Send a non-POST HTTP-in request and confirm HTTP 405.
6. Reset the script and replay the previously accepted event; confirm Linkset Data still rejects it. Send the next higher sequence and confirm it is accepted.

Do not treat TypeScript tests as an LSL compilation or grid-integration result. Record region, object UUID, script revision, callback event IDs, response codes, and observed hovertext for the manual run; never record the terminal secret.
