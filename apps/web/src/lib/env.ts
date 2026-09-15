import { validateRuntimeConfig } from "@lake-tech/core";

export function env() {
  const runtime = validateRuntimeConfig(process.env);
  const baseUrl = process.env.PUBLIC_BASE_URL;
  if (!baseUrl || new URL(baseUrl).protocol !== `${runtime.publicScheme}:`) {
    throw new Error("PUBLIC_BASE_URL must match PUBLIC_SCHEME");
  }
  return {
    ...runtime,
    baseUrl,
    sessionSecret: process.env.SESSION_HMAC_SECRET ?? runtime.otpSecret,
    stripeSecret: process.env.STRIPE_SECRET_KEY,
    stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
  };
}
