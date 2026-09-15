export * from "./role-policy.js";

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  randomInt,
  scrypt,
  timingSafeEqual,
} from "node:crypto";

const scryptAsync = (password: string, salt: Buffer, keylen: number): Promise<Buffer> =>
  new Promise((resolve, reject) => scrypt(password, salt, keylen, { N: 32_768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (error, derivedKey) => error ? reject(error) : resolve(derivedKey)));
const PASSWORD_HASH_PREFIX = "scrypt$v=1$N=32768,r=8,p=1";

export async function hashPassword(password: string): Promise<string> {
  if (password.length < 12 || password.length > 1024) throw new Error("invalid password length");
  const salt = randomBytes(16);
    const digest = await scryptAsync(password, salt, 32);
  return `${PASSWORD_HASH_PREFIX}$${salt.toString("base64url")}$${digest.toString("base64url")}`;
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  if (password.length > 1024) return false;
  const match = /^(scrypt[$]v=1[$]N=32768,r=8,p=1)[$]([A-Za-z0-9_-]{22})[$]([A-Za-z0-9_-]{43})$/.exec(encoded);
  if (!match) return false;
  try {
    const expected = Buffer.from(match[3]!, "base64url");
    const actual = await scryptAsync(password, Buffer.from(match[2]!, "base64url"), 32);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}
export function createOtp(): string {
  return randomInt(0, 100_000_000).toString().padStart(8, "0");
}

export function digestOtp(otp: string, pepper: string, challengeId: string): string {
  return createHmac("sha256", pepper).update(`${challengeId}:${otp}`, "utf8").digest("hex");
}

function safeHexEqual(a: string, b: string): boolean {
  try {
    if (!/^[0-9a-f]+$/i.test(a) || !/^[0-9a-f]+$/i.test(b)) return false;
    const aa = Buffer.from(a, "hex");
    const bb = Buffer.from(b, "hex");
    return aa.length === bb.length && timingSafeEqual(aa, bb);
  } catch {
    return false;
  }
}

export function verifyOtp(otp: string, digest: string, pepper: string, challengeId: string): boolean {
  return safeHexEqual(digestOtp(otp, pepper, challengeId), digest);
}

export function createSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function encryptionKey(secret: string, purpose = "message"): Buffer {
  return createHash("sha256").update(`${purpose}\0${secret}`, "utf8").digest();
}

function seal(value: string, secret: string, purpose: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(secret, purpose), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64url");
}

function open(sealed: string, secret: string, purpose: string): string {
  const data = Buffer.from(sealed, "base64url");
  if (data.length < 29) throw new Error("invalid encrypted value");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(secret, purpose), data.subarray(0, 12));
  decipher.setAuthTag(data.subarray(12, 28));
  return Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString("utf8");
}

export function sealMessage(message: string, secret: string): string {
  return seal(message, secret, "message");
}

export function openMessage(sealed: string, secret: string): string {
  return open(sealed, secret, "message");
}

export function sealTerminalSecret(value: string, secret: string): string {
  return seal(value, secret, "terminal-secret");
}

export function openTerminalSecret(sealed: string, secret: string): string {
  return open(sealed, secret, "terminal-secret");
}

export interface TerminalSignatureInput {
  timestamp: string;
  nonce: string;
  eventId: string;
  body: string;
}

export function terminalCanonical(input: TerminalSignatureInput): string {
  const bodyHash = createHash("sha256").update(input.body, "utf8").digest("hex");
  return `${input.timestamp}\n${input.nonce}\n${input.eventId}\n${bodyHash}`;
}

export function canonicalTerminalSignature(input: TerminalSignatureInput, secret: string): string {
  return createHmac("sha256", secret).update(terminalCanonical(input), "utf8").digest("base64");
}

export function verifyTerminalSignature(input: TerminalSignatureInput, secret: string, signature: string): boolean {
  if (!/^[A-Za-z0-9+/]{43}=$/.test(signature)) return false;
  const expected = Buffer.from(canonicalTerminalSignature(input, secret), "base64");
  const received = Buffer.from(signature, "base64");
  return expected.length === received.length && timingSafeEqual(expected, received);
}

export function assertFreshTimestamp(timestamp: string, nowMs = Date.now(), windowSeconds = 300): void {
  const seconds = Number(timestamp);
  if (!Number.isInteger(seconds) || Math.abs(Math.floor(nowMs / 1000) - seconds) > windowSeconds) {
    throw new Error("stale terminal request");
  }
}

export function parseMoneyDecimal(value: string, scale = 2): number {
  const match = new RegExp(`^(0|[1-9]\\d*)(?:\\.(\\d{1,${scale}}))?$`).exec(value);
  if (!match) throw new Error("invalid money value");
  const minor = BigInt(match[1]!) * 10n ** BigInt(scale) + BigInt((match[2] ?? "").padEnd(scale, "0"));
  if (minor > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("money value too large");
  return Number(minor);
}

export function formatMoneyMinor(value: number, scale = 2): string {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error("invalid minor amount");
  const factor = 10 ** scale;
  return `${Math.floor(value / factor)}.${String(value % factor).padStart(scale, "0")}`;
}

export function paymentDisposition(received: number, expected: number): "CONFIRMED" | "MANUAL_REVIEW" {
  return received === expected ? "CONFIRMED" : "MANUAL_REVIEW";
}

export interface LindenPaymentDecisionInput {
  received: number;
  expected: number;
  activeRenterAvatarId: string | null;
  payerAvatarId: string;
  payerKnown: boolean;
}

export function decideLindenPayment(input: LindenPaymentDecisionInput): "START" | "EXTEND" | "MANUAL_REVIEW" {
  if (input.received !== input.expected || !input.payerKnown) return "MANUAL_REVIEW";
  if (input.activeRenterAvatarId !== null) {
    return input.activeRenterAvatarId === input.payerAvatarId ? "EXTEND" : "MANUAL_REVIEW";
  }
  return "START";
}

export interface BotRuntimeConfig { databaseUrl:string;otpSecret:string;simulation:boolean;botUsername?:string;botPassword?:string }
export function validateBotRuntimeConfig(env:Record<string,string|undefined>):BotRuntimeConfig {
  if(!env.DATABASE_URL)throw new Error("DATABASE_URL is required");
  if(!env.OTP_HMAC_SECRET||env.OTP_HMAC_SECRET.length<32)throw new Error("OTP_HMAC_SECRET must have at least 32 characters");
  if(env.SL_BOT_SIMULATION_MODE!==undefined&&!['true','false'].includes(env.SL_BOT_SIMULATION_MODE))throw new Error("SL_BOT_SIMULATION_MODE must be true or false");
  const simulation=env.SL_BOT_SIMULATION_MODE===undefined?env.SIMULATION_MODE==="true":env.SL_BOT_SIMULATION_MODE==="true";
  if(!simulation&&(!env.SL_BOT_USERNAME||!env.SL_BOT_PASSWORD))throw new Error("Real bot mode requires SL_BOT_USERNAME and SL_BOT_PASSWORD");
  return {databaseUrl:env.DATABASE_URL,otpSecret:env.OTP_HMAC_SECRET,simulation,botUsername:env.SL_BOT_USERNAME,botPassword:env.SL_BOT_PASSWORD};
}
export function validatePaymentWorkerConfig(env:Record<string,string|undefined>):{databaseUrl:string;stripeSecret:string|undefined;simulation:boolean} {
  if(!env.DATABASE_URL)throw new Error("DATABASE_URL is required");
  const simulation=env.SIMULATION_MODE==="true";
  if(!simulation&&!env.STRIPE_SECRET_KEY)throw new Error("STRIPE_SECRET_KEY is required");
  return {databaseUrl:env.DATABASE_URL,stripeSecret:env.STRIPE_SECRET_KEY,simulation};
}

export interface RuntimeConfig {
  databaseUrl: string;
  otpSecret: string;
  terminalEncryptionKey: string;
  slApiKey?: string;
  simulation: boolean;
  cookieSecure: boolean;
  publicScheme: "http" | "https";
  trustProxy: boolean;
}

export function validateRuntimeConfig(env: Record<string, string | undefined>): RuntimeConfig {
  const simulation = env.SIMULATION_MODE === "true";
  const production = env.NODE_ENV === "production";
  const publicScheme = env.PUBLIC_SCHEME;
  if (publicScheme !== "http" && publicScheme !== "https") throw new Error("PUBLIC_SCHEME must be explicitly http or https");
  const cookieSecure = env.SESSION_COOKIE_SECURE === "true";
  if (publicScheme === "https" && !cookieSecure) throw new Error("HTTPS requires secure session cookies");
  if (production && simulation && env.ALLOW_SIMULATION_IN_PRODUCTION !== "true") throw new Error("simulation is refused in production");
  if (!simulation && (!env.SL_BOT_USERNAME || !env.SL_BOT_PASSWORD || !env.STRIPE_SECRET_KEY || !env.STRIPE_WEBHOOK_SECRET)) {
    throw new Error("Real mode requires SL_BOT_USERNAME, SL_BOT_PASSWORD and Stripe credentials");
  }
  if (!simulation && !env.SL_API_KEY) throw new Error("Real mode requires SL_API_KEY");
  if (!simulation && (!env.TERMINAL_SECRET_ENCRYPTION_KEY || env.TERMINAL_SECRET_ENCRYPTION_KEY.length < 32)) {
    throw new Error("Real mode requires TERMINAL_SECRET_ENCRYPTION_KEY with at least 32 characters");
  }
  if (!env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  if (!env.OTP_HMAC_SECRET || env.OTP_HMAC_SECRET.length < 32) throw new Error("OTP_HMAC_SECRET must have at least 32 characters");
  return {
    databaseUrl: env.DATABASE_URL,
    otpSecret: env.OTP_HMAC_SECRET,
    terminalEncryptionKey: env.TERMINAL_SECRET_ENCRYPTION_KEY ?? env.OTP_HMAC_SECRET,
    slApiKey: env.SL_API_KEY,
    simulation,
    cookieSecure,
    publicScheme,
    trustProxy: env.TRUST_PROXY === "true",
  };
}
