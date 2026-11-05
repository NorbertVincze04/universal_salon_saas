import type { UserRecord } from "../types/user.types.ts";
import { pool } from "../db.ts";

export class UserRepository {
  static async findAuthState(
    userId: string,
    shopId: string,
  ): Promise<{
    role: UserRecord["role"];
    roles: UserRecord["roles"];
    passwordChangedAt: Date | null;
  } | null> {
    const { rows } = await pool.query<{
      role: UserRecord["role"];
      roles: UserRecord["roles"];
      passwordChangedAt: Date | null;
    }>(
      `SELECT role, roles, password_changed_at AS "passwordChangedAt"
       FROM users
       WHERE id = $1 AND shop_id = $2 AND is_active = TRUE`,
      [userId, shopId],
    );
    return rows[0] ?? null;
  }

  static async listForOwner(shopId: string): Promise<
    Array<{
      id: string;
      fullName: string;
      email: string;
      phoneNumber: string | null;
      role: string;
      roles: string[];
      barberPrivateNote: string | null;
      isActive: boolean;
    }>
  > {
    const { rows } = await pool.query(
      `SELECT id, full_name AS "fullName", email,
          phone_number AS "phoneNumber", role, roles,
          barber_private_note AS "barberPrivateNote", is_active AS "isActive"
       FROM users
       WHERE shop_id = $1 AND is_active = TRUE
       ORDER BY full_name`,
      [shopId],
    );
    return rows;
  }

  static async setBarberRole(
    shopId: string,
    userId: string,
    enabled: boolean,
  ): Promise<boolean> {
    const result = await pool.query(
      `UPDATE users
       SET roles = CASE
           WHEN $3 THEN ARRAY(SELECT DISTINCT unnest(roles || ARRAY['BARBER']::TEXT[]))
           ELSE CASE
             WHEN cardinality(array_remove(roles, 'BARBER')) = 0
               THEN ARRAY['CUSTOMER']::TEXT[]
             ELSE array_remove(roles, 'BARBER')
           END
         END,
         role = CASE
           WHEN $3 AND role = 'CUSTOMER' THEN 'BARBER'
           -- Only demote the primary role when the barber role is being removed,
           -- and fall back to a role the user still holds.
           WHEN NOT $3 AND role = 'BARBER'
             THEN COALESCE((array_remove(roles, 'BARBER'))[1], 'CUSTOMER')
           ELSE role
         END,
         updated_at = NOW()
       WHERE id = $1 AND shop_id = $2 AND is_active = TRUE`,
      [userId, shopId, enabled],
    );
    return result.rowCount === 1;
  }

  static async updateBarberNote(
    shopId: string,
    userId: string,
    note: string | null,
  ): Promise<boolean> {
    const result = await pool.query(
      `UPDATE users SET barber_private_note = $3, updated_at = NOW()
       WHERE id = $1 AND shop_id = $2 AND is_active = TRUE`,
      [userId, shopId, note],
    );
    return result.rowCount === 1;
  }

  static async deleteProfile(userId: string, shopId: string): Promise<void> {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      await client.query(
        `UPDATE appointments a
         SET customer_id = NULL,
             guest_name = COALESCE(a.guest_name, u.full_name),
             updated_at = NOW()
         FROM users u
         WHERE a.customer_id = $1 AND u.id = $1 AND a.shop_id = $2 AND a.status = 'COMPLETED'`,
        [userId, shopId],
      );

      await client.query(
        `DELETE FROM appointments
         WHERE customer_id = $1 AND shop_id = $2 AND status <> 'COMPLETED'`,
        [userId, shopId],
      );

      const result = await client.query(
        `DELETE FROM users WHERE id = $1 AND shop_id = $2 RETURNING id`,
        [userId, shopId],
      );
      if (result.rowCount !== 1) {
        throw new Error("User profile was not found.");
      }

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  static async findByEmail(
    shopId: string,
    email: string,
  ): Promise<UserRecord | null> {
    const { rows } = await pool.query<UserRecord>(
      `
            SELECT u.id, u.shop_id, s.slug AS shop_slug, u.full_name,
              u.email, u.phone_number, u.profile_image_url,
              u.profile_image_position_x, u.profile_image_position_y,
              u.password_hash, u.role, u.roles, u.barber_private_note
            FROM users u
            INNER JOIN shops s ON s.id = u.shop_id
            WHERE u.shop_id = $1 AND u.email = $2 AND u.is_active = TRUE
      `,
      [shopId, email],
    );

    return rows[0] || null;
  }

  static async create(
    fullName: string,
    email: string,
    passwordHash: string,
    shopId: string,
    role: "OWNER" | "ADMIN" | "BARBER" | "CUSTOMER" = "CUSTOMER",
    phoneNumber: string | null = null,
  ): Promise<UserRecord> {
    const { rows } = await pool.query<UserRecord>(
      `
      INSERT INTO users
        (shop_id, full_name, email, password_hash, role, roles, phone_number)
      VALUES
        ($1, $2, $3, $4, $5::varchar, ARRAY[$5::text]::TEXT[], $6)
      RETURNING id, shop_id, full_name, email, phone_number, profile_image_url,
        password_hash, role, roles, barber_private_note
      `,
      [shopId, fullName, email, passwordHash, role, phoneNumber],
    );

    return rows[0];
  }

  static async updateProfile(
    userId: string,
    shopId: string,
    fullName: string,
    email: string,
    phoneNumber: string | null,
    profileImageUrl: string | null,
    profileImagePositionX: number,
    profileImagePositionY: number,
  ): Promise<UserRecord> {
    const { rows } = await pool.query<UserRecord>(
      `
      UPDATE users
      SET full_name = $3, email = $4, phone_number = $5,
          profile_image_url = $6, profile_image_position_x = $7,
          profile_image_position_y = $8, updated_at = NOW()
      WHERE id = $1 AND shop_id = $2 AND is_active = TRUE
      RETURNING id, shop_id, full_name, email, phone_number, profile_image_url,
        profile_image_position_x, profile_image_position_y, password_hash, role, roles, barber_private_note
      `,
      [
        userId,
        shopId,
        fullName,
        email,
        phoneNumber,
        profileImageUrl,
        profileImagePositionX,
        profileImagePositionY,
      ],
    );

    if (!rows[0]) {
      throw new Error("User profile was not found.");
    }

    return rows[0];
  }

  // used when registering a new user
  static async existsByEmail(shopId: string, email: string): Promise<boolean> {
    const { rows } = await pool.query(
      `
      SELECT id FROM users
      WHERE shop_id = $1 AND email = $2
      `,
      [shopId, email],
    );

    return rows.length > 0;
  }

  static async updatePasswordHash(
    userId: string,
    shopId: string,
    passwordHash: string,
  ): Promise<boolean> {
    const result = await pool.query(
      `UPDATE users
       SET password_hash = $3, password_changed_at = NOW(), updated_at = NOW()
       WHERE id = $1 AND shop_id = $2 AND is_active = TRUE`,
      [userId, shopId, passwordHash],
    );
    return result.rowCount === 1;
  }
}
