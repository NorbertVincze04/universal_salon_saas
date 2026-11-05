import { pool } from "../db.ts";
import bcrypt from "bcrypt";
import crypto from "node:crypto";

const CODE_TTL_MS = 15 * 60 * 1000; // 15 minutes
const RESET_TOKEN_TTL_MS = 10 * 60 * 1000; // 10 minutes
// A 6-digit code has only 1,000,000 values, so each code gets a handful of
// guesses before it is burned and the user has to request a new one.
const MAX_CODE_ATTEMPTS = 5;

function generateSixDigitCode(): string {
  // Cryptographically secure; Math.random() is predictable.
  return crypto.randomInt(100000, 1000000).toString();
}

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export class PasswordResetRepository {
  // Replaces any previous codes for this user with a freshly generated one
  // and returns the plain code so the caller can email it (only the hash is stored).
  static async createCode(shopId: string, userId: string): Promise<string> {
    const code = generateSixDigitCode();
    const codeHash = await bcrypt.hash(code, 10);
    const expiresAt = new Date(Date.now() + CODE_TTL_MS).toISOString();

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `DELETE FROM password_reset_codes WHERE shop_id = $1 AND user_id = $2`,
        [shopId, userId],
      );
      await client.query(
        `INSERT INTO password_reset_codes (shop_id, user_id, code_hash, expires_at)
         VALUES ($1, $2, $3, $4)`,
        [shopId, userId, codeHash, expiresAt],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    return code;
  }

  // Verifies the latest unused, unexpired code and, on success, issues a
  // one-time reset token so the raw code never has to be resent alongside
  // the new password.
  static async verifyCode(
    shopId: string,
    userId: string,
    code: string,
  ): Promise<string | null> {
    const { rows } = await pool.query<{ id: string; codeHash: string }>(
      `SELECT id, code_hash AS "codeHash" FROM password_reset_codes
       WHERE shop_id = $1 AND user_id = $2 AND used_at IS NULL AND expires_at > NOW()
         AND failed_attempts < $3
       ORDER BY created_at DESC LIMIT 1`,
      [shopId, userId, MAX_CODE_ATTEMPTS],
    );
    const record = rows[0];
    if (!record) return null;

    const matches = await bcrypt.compare(code, record.codeHash);
    if (!matches) {
      await pool.query(
        `UPDATE password_reset_codes SET failed_attempts = failed_attempts + 1
         WHERE id = $1`,
        [record.id],
      );
      return null;
    }

    const resetToken = crypto.randomBytes(32).toString("hex");
    const resetTokenExpiresAt = new Date(
      Date.now() + RESET_TOKEN_TTL_MS,
    ).toISOString();

    // Conditional update so two concurrent requests cannot both redeem the code.
    const updated = await pool.query(
      `UPDATE password_reset_codes
       SET used_at = NOW(), reset_token_hash = $2, reset_token_expires_at = $3
       WHERE id = $1 AND used_at IS NULL AND failed_attempts < $4`,
      [record.id, hashToken(resetToken), resetTokenExpiresAt, MAX_CODE_ATTEMPTS],
    );
    return updated.rowCount === 1 ? resetToken : null;
  }

  // Verifies and consumes a reset token issued by verifyCode; single use.
  static async consumeResetToken(
    shopId: string,
    userId: string,
    resetToken: string,
  ): Promise<boolean> {
    // The token is 256 bits of randomness, so matching on its SHA-256 hash
    // directly in SQL is safe; the conditional update makes it single use.
    const result = await pool.query(
      `UPDATE password_reset_codes SET reset_token_used_at = NOW()
       WHERE shop_id = $1 AND user_id = $2 AND reset_token_hash = $3
         AND reset_token_used_at IS NULL AND reset_token_expires_at > NOW()`,
      [shopId, userId, hashToken(resetToken)],
    );
    return result.rowCount === 1;
  }
}
