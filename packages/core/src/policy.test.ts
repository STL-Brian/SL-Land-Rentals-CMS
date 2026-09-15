import { describe, expect, it } from "vitest";
import { decideLindenPayment, paymentDisposition, validateBotRuntimeConfig, validatePaymentWorkerConfig, validateRuntimeConfig } from "./index.js";

describe("payment disposition", () => {
  it("accepts exact amount and flags every mismatch for manual review", () => {
    expect(paymentDisposition(1000, 1000)).toBe("CONFIRMED");
    expect(paymentDisposition(999, 1000)).toBe("MANUAL_REVIEW");
    expect(paymentDisposition(1001, 1000)).toBe("MANUAL_REVIEW");
  });

  it("authorizes only the linked renter for active rentals", () => {
    expect(decideLindenPayment({ received: 1000, expected: 1000, activeRenterAvatarId: "avatar-a", payerAvatarId: "avatar-a", payerKnown: true })).toBe("EXTEND");
    expect(decideLindenPayment({ received: 1000, expected: 1000, activeRenterAvatarId: "avatar-a", payerAvatarId: "avatar-b", payerKnown: true })).toBe("MANUAL_REVIEW");
  });

  it("starts an available rental only for a known exact payer", () => {
    expect(decideLindenPayment({ received: 1000, expected: 1000, activeRenterAvatarId: null, payerAvatarId: "avatar-a", payerKnown: true })).toBe("START");
    expect(decideLindenPayment({ received: 1000, expected: 1000, activeRenterAvatarId: null, payerAvatarId: "avatar-a", payerKnown: false })).toBe("MANUAL_REVIEW");
    expect(decideLindenPayment({ received: 999, expected: 1000, activeRenterAvatarId: null, payerAvatarId: "avatar-a", payerKnown: true })).toBe("MANUAL_REVIEW");
  });
});

describe("runtime safeguards", () => {
  const base = { NODE_ENV: "development", PUBLIC_SCHEME: "http", DATABASE_URL: "postgresql://x:***@db/x", OTP_HMAC_SECRET: "12345678901234567890123456789012", SESSION_COOKIE_SECURE: "false", SIMULATION_MODE: "true" };

  it("refuses simulation in production unless explicitly allowed", () => {
    expect(() => validateRuntimeConfig({ ...base, NODE_ENV: "production" })).toThrow(/simulation/i);
    expect(validateRuntimeConfig({ ...base, NODE_ENV: "production", ALLOW_SIMULATION_IN_PRODUCTION: "true" }).simulation).toBe(true);
  });

  it("fails closed when public https and cookie security disagree", () => {
    expect(() => validateRuntimeConfig({ ...base, PUBLIC_SCHEME: "https" })).toThrow(/secure/i);
  });

  it("requires every real-mode secret", () => {
    expect(() => validateRuntimeConfig({ ...base, SIMULATION_MODE: "false" })).toThrow(/SL_BOT/i);
    const adapters = { ...base, SIMULATION_MODE: "false", SL_BOT_USERNAME: "bot", SL_BOT_PASSWORD: "pass", STRIPE_SECRET_KEY: "stripe", STRIPE_WEBHOOK_SECRET: "webhook" };
    expect(() => validateRuntimeConfig(adapters)).toThrow(/SL_API_KEY/i);
    expect(() => validateRuntimeConfig({ ...adapters, SL_API_KEY: "api" })).toThrow(/TERMINAL_SECRET_ENCRYPTION_KEY/i);
  });

  it("validates bot and payment worker credentials independently", () => {
    const shared={DATABASE_URL:base.DATABASE_URL,OTP_HMAC_SECRET:base.OTP_HMAC_SECRET,SIMULATION_MODE:"false"};
    expect(()=>validateBotRuntimeConfig(shared)).toThrow(/SL_BOT/i);
    expect(validateBotRuntimeConfig({...shared,SL_BOT_USERNAME:"bot",SL_BOT_PASSWORD:"pass"}).simulation).toBe(false);
    expect(()=>validatePaymentWorkerConfig(shared)).toThrow(/STRIPE/i);
    expect(validatePaymentWorkerConfig({...shared,STRIPE_SECRET_KEY:"sk_test"}).stripeSecret).toBe("sk_test");
    expect(validateBotRuntimeConfig({...shared,SIMULATION_MODE:"true"})).toMatchObject({simulation:true});
    expect(()=>validateBotRuntimeConfig({...shared,SIMULATION_MODE:"true",SL_BOT_SIMULATION_MODE:"false"})).toThrow(/SL_BOT/i);
    expect(validateBotRuntimeConfig({...shared,SIMULATION_MODE:"true",SL_BOT_SIMULATION_MODE:"false",SL_BOT_USERNAME:"bot",SL_BOT_PASSWORD:"pass"})).toMatchObject({simulation:false});
    expect(validatePaymentWorkerConfig({...shared,SIMULATION_MODE:"true"})).toMatchObject({simulation:true,stripeSecret:undefined});
  });
});
