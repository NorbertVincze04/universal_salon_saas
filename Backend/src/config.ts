import dotenv from "dotenv";
import type { SignOptions } from "jsonwebtoken";

// load settings from .env file
dotenv.config();

// configure app
export const PORT = Number(process.env.PORT || 3000);
export const CORS_ORIGINS = (process.env.CORS_ORIGIN || "http://localhost:4200")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
export const JWT_SECRET = process.env.JWT_SECRET ?? "";
if (!JWT_SECRET) {
  throw new Error("JWT_SECRET must be configured.");
}
if (JWT_SECRET.length < 32) {
  throw new Error("JWT_SECRET must be at least 32 characters long.");
}
export const JWT_EXPIRES_IN = (process.env.JWT_EXPIRES_IN ||
  "1d") as SignOptions["expiresIn"];

// Number of proxy hops to trust (e.g. "1"), "true", or unset/"false" to trust none.
const rawTrustProxy = (process.env.TRUST_PROXY || "").trim().toLowerCase();
export const TRUST_PROXY: boolean | number =
  rawTrustProxy === "" || rawTrustProxy === "false"
    ? false
    : rawTrustProxy === "true"
      ? true
      : Number.isInteger(Number(rawTrustProxy))
        ? Number(rawTrustProxy)
        : false;

// SMTP is optional: when unset, outgoing mail (e.g. password reset codes) is
// logged to the console instead of sent, so local development works without setup.
export const SMTP_HOST = process.env.SMTP_HOST || "";
export const SMTP_PORT = Number(process.env.SMTP_PORT || 587);
export const SMTP_USER = process.env.SMTP_USER || "";
export const SMTP_PASS = process.env.SMTP_PASS || "";
export const SMTP_FROM = process.env.SMTP_FROM || "no-reply@example.com";
export const SMTP_SECURE = process.env.SMTP_SECURE === "true";
