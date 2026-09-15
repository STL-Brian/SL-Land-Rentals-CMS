// Conflict behavior is covered by terminal integration tests and smoke-terminal.mjs now provisions a unique terminal dynamically.
// This compatibility entry point intentionally contains no terminal IDs or secrets.
throw new Error("Run smoke-terminal.mjs with an authenticated admin cookie; no static terminal fixture exists.");
