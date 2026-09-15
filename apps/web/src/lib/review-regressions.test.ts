import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../../../..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

describe("fail-closed review regressions", () => {
  it("has no public simulation mailbox route and provides operator CLI", () => {
    expect(existsSync(resolve(root, "apps/web/src/app/api/dev-mailbox/route.ts"))).toBe(false);
    expect(read("scripts/read-simulation-mailbox.mjs")).toContain("DATABASE_URL");
  });
  it("does not seed a terminal secret and exposes terminal lifecycle APIs", () => {
    expect(read("packages/db/src/seed.ts")).not.toMatch(/simulation-terminal-secret|INSERT INTO terminals/);
    expect(read("apps/web/src/app/api/admin/terminals/route.ts")).toMatch(/randomBytes|sealTerminalSecret/);
    expect(read("apps/web/src/app/api/admin/terminals/[id]/route.ts")).toMatch(/ROTATE|REVOKE/);
  });
  it("uses one canonical OTP lock and invalidates old challenges", () => {
    const auth = read("apps/web/src/lib/auth.ts");
    expect(auth.match(/login:\$\{canonical\}/g)?.length).toBe(2);
    expect(auth).toContain("consumed_at=now()");
  });
  it("guards LSL persistence before HTTP", () => {
    expect(read("lsl/rental-terminal.lsl")).toMatch(/llLinksetDataWrite[\s\S]*XP_ERROR_NONE[\s\S]*sendPayment/);
    expect(read("apps/web/src/app/api/terminal/poll/route.ts")).toContain("setup_linden");
  });
  it("keeps one terminal poll in flight so delayed responses remain identifiable", () => {
    const source = read("lsl/rental-terminal.lsl");
    expect(source).toMatch(/sendPoll\(\)\s*\{\s*if \(gPollRequest != NULL_KEY\) return;/);
    expect(source).toMatch(/if \(requestID == gPollRequest\)\s*\{\s*gPollRequest = NULL_KEY;/);
  });
  it("restricts admin extension and secures checkout success", () => {
    expect(read("apps/web/src/app/api/admin/rentals/[id]/route.ts")).toMatch(/status.?=.?'ACTIVE'|status='ACTIVE'/);
    expect(read("apps/web/src/app/checkout/success/page.tsx")).toContain("viewer.id");
  });
  it("guards legacy paid activation with reservation targeting and renter promotion", () => {
    const route=read("apps/web/src/app/api/admin/rentals/route.ts");
    expect(route).toContain("reservations");
    expect(route).toContain("target_user_id");
    expect(route).toContain("status='COMPLETED'");
    expect(route).toContain("role='RENTER'");
  });
  it("has reconciliation, retention and meaningful bot health", () => {
    expect(read("apps/web/src/app/api/admin/reconciliation/[id]/route.ts")).toMatch(/APPROVE|REJECT/);
    expect(read("apps/sl-bot/src/index.ts")).toMatch(/dead_lettered_at|challenge_id|health/);
    expect(read("docker-compose.yml")).not.toContain("pgrep");
  });
  it("bounds database health probes so dependency failure returns promptly", () => {
    expect(read("packages/db/src/index.ts")).toMatch(/connectionTimeoutMillis.*query_timeout/);
  });
  it("enforces reservations in terminal and reconciliation allocation paths", () => {
    const payment = read("apps/web/src/app/api/terminal/payment/route.ts");
    const poll = read("apps/web/src/app/api/terminal/poll/route.ts");
    const reconcile = read("apps/web/src/app/api/admin/reconciliation/[id]/route.ts");
    expect(payment).toMatch(/reservations[\s\S]*target_user_id/);
    expect(payment).toContain("status='COMPLETED'");
    expect(payment).toContain("role='RENTER'");
    expect(poll).toMatch(/reservations[\s\S]*payPrice/);
    expect(reconcile).toMatch(/reservations[\s\S]*target_user_id/);
    expect(reconcile).toContain("status='COMPLETED'");
    expect(reconcile).toContain("role='RENTER'");
  });
  it("renders every finance recovery queue without inert search controls", () => {
    const payments = read("apps/web/src/app/management/payments/page.tsx");
    const audit = read("apps/web/src/app/management/audit/page.tsx");
    expect(payments).toMatch(/terminal_payment_events/);
    expect(payments).toMatch(/stripe_events/);
    expect(payments).toMatch(/provider_actions/);
    expect(payments).not.toContain('type="search"');
    expect(audit).not.toContain('type="search"');
    expect(audit).toContain("details");
  });
});
