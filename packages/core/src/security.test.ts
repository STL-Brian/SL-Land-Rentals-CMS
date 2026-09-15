import { describe, expect, it } from "vitest";
import {
  canonicalTerminalSignature,
  createOtp,
  createSessionToken,
  digestOtp,
  hashSessionToken,
  openMessage,
  openTerminalSecret,
  parseMoneyDecimal,
  sealMessage,
  sealTerminalSecret,
  verifyOtp,
  verifyTerminalSignature,
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
});

describe("money", () => {
  it("converts decimal UI strings to minor integer units without floats", () => {
    expect(parseMoneyDecimal("12.34", 2)).toBe(1234);
    expect(() => parseMoneyDecimal("1.234", 2)).toThrow();
    expect(() => parseMoneyDecimal("-1.00", 2)).toThrow();
  });
});
