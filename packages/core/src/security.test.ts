import { describe, expect, it } from "vitest";
import {
  canonicalTerminalSignature,
  createTerminalCallbackEnvelope,
  createOtp,
  createSessionToken,
  digestOtp,
  hashSessionToken,
  hashPassword,
  verifyPassword,
  openMessage,
  openTerminalSecret,
  parseMoneyDecimal,
  sealMessage,
  sealTerminalSecret,
  verifyOtp,
  verifyTerminalSignature,
  verifyTerminalCallbackEnvelope,
} from "./index.js";

describe("OTP and sessions", () => {
  it("creates an 8 digit OTP and stores only deterministic HMAC digests", () => {
    const otp = createOtp();
    expect(otp).toMatch(/^\d{8}$/);
    const digest = digestOtp(otp, "pepper", "challenge-1");
    expect(digest).not.toContain(otp);
    expect(verifyOtp(otp, digest, "pepper", "challenge-1")).toBe(true);
    expect(verifyOtp("00000000", digest, "pepper", "challenge-1")).toBe(false);
  });

  it("creates opaque session tokens and hashes them", () => {
    const token = createSessionToken();
    expect(token.length).toBeGreaterThan(30);
    expect(hashSessionToken(token)).not.toBe(token);
  });

  it("hashes passwords with unique salts and verifies them", async () => {
    const first = await hashPassword("correct horse battery staple");
    const second = await hashPassword("correct horse battery staple");
    expect(first).not.toBe(second);
    expect(first).toMatch(/^scrypt\$v=1\$/);
    expect(await verifyPassword("correct horse battery staple", first)).toBe(true);
    expect(await verifyPassword("wrong password", first)).toBe(false);
    expect(await verifyPassword("correct horse battery staple", "malformed")).toBe(false);
  });

  it("encrypts transient outbox messages at rest", () => {
    const key = "12345678901234567890123456789012";
    const sealed = sealMessage("Code 12345678", key);
    expect(sealed).not.toContain("12345678");
    expect(openMessage(sealed, key)).toBe("Code 12345678");
  });
});

describe("terminal security", () => {
  it("uses Base64 HMAC and rejects changed bodies and hex signatures", () => {
    const input = { timestamp: "1760000000", nonce: "n-1", eventId: "e-1", body: '{"amount":1000}' };
    const sig = canonicalTerminalSignature(input, "secret");
    expect(sig).toMatch(/^[A-Za-z0-9+/]{43}=$/);
    expect(verifyTerminalSignature(input, "secret", sig)).toBe(true);
    expect(verifyTerminalSignature({ ...input, body: '{"amount":1001}' }, "secret", sig)).toBe(false);
    expect(verifyTerminalSignature(input, "secret", "0".repeat(64))).toBe(false);
  });

  it("encrypts terminal secrets with authenticated encryption", () => {
    const encryptionKey = "terminal-encryption-key-at-least-32-characters";
    const sealed = sealTerminalSecret("per-object-secret", encryptionKey);
    expect(sealed).not.toContain("per-object-secret");
    expect(openTerminalSecret(sealed, encryptionKey)).toBe("per-object-secret");
    const tampered = Buffer.from(sealed, "base64url");
    tampered[tampered.length - 1] = tampered[tampered.length - 1]! ^ 1;
    expect(() => openTerminalSecret(tampered.toString("base64url"), encryptionKey)).toThrow();
  });

  it("creates an LSL-compatible body envelope with a signature over exact signedBody", () => {
    const envelope = createTerminalCallbackEnvelope({ eventId: "evt-1", kind: "PAYMENT_RESULT", sequence: 7, payload: { status: "CONFIRMED" }, createdAt: "2026-09-15T12:00:00.000Z" }, "callback-secret");
    expect(envelope.signedBody).toBe('{"version":1,"eventId":"evt-1","kind":"PAYMENT_RESULT","sequence":7,"payload":{"status":"CONFIRMED"},"createdAt":"2026-09-15T12:00:00.000Z"}');
    expect(envelope.signature).toBe("99lHXYkOIyku/AaIjh29k4Ts0kiHqnKev0iVvyT8/jo=");
    expect(JSON.parse(envelope.body)).toEqual({ version: 1, signedBody: envelope.signedBody, signature: envelope.signature });
    expect(JSON.parse(envelope.signedBody)).toEqual({ version: 1, eventId: "evt-1", kind: "PAYMENT_RESULT", sequence: 7, payload: { status: "CONFIRMED" }, createdAt: "2026-09-15T12:00:00.000Z" });
    expect(verifyTerminalCallbackEnvelope(envelope.body, "callback-secret")).toBe(true);
    expect(verifyTerminalCallbackEnvelope(envelope.body.replace(envelope.signature, "0".repeat(44)), "callback-secret")).toBe(false);
    expect(verifyTerminalCallbackEnvelope(envelope.body, "wrong-secret")).toBe(false);
  });
});

describe("money", () => {
  it("converts decimal UI strings to minor integer units without floats", () => {
    expect(parseMoneyDecimal("12.34", 2)).toBe(1234);
    expect(() => parseMoneyDecimal("1.234", 2)).toThrow();
    expect(() => parseMoneyDecimal("-1.00", 2)).toThrow();
  });
});
