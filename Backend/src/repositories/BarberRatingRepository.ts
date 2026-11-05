import { pool } from "../db.ts";
import { HttpError } from "../utils/httpError.ts";

const RATING_COOLDOWN_MS = 1000 * 60 * 60 * 24 * 90; // 3 months
const REMINDER_INTERVAL_MS = 1000 * 60 * 60 * 24 * 7; // 1 week

export interface BarberRatingRecord {
  id: string;
  rating: number;
  comment: string;
  createdAt: string;
}

export interface BarberReceivedRatingRecord {
  id: string;
  authorName: string;
  authorAvatarUrl: string | null;
  rating: number;
  comment: string;
  date: string;
}

export interface BarberRatingSummary {
  rating: number | null;
  ratingCount: number;
}

export interface MyBarberRatingStatus {
  rating: BarberRatingRecord | null;
  eligible: boolean;
  canRate: boolean;
  nextEligibleDate: string | null;
}

async function hasCompletedAppointment(
  shopId: string,
  barberId: string,
  customerId: string,
): Promise<boolean> {
  const { rowCount } = await pool.query(
    `SELECT 1 FROM appointments
     WHERE shop_id = $1 AND barber_id = $2 AND customer_id = $3 AND status = 'COMPLETED'
     LIMIT 1`,
    [shopId, barberId, customerId],
  );
  return (rowCount ?? 0) > 0;
}

export class BarberRatingRepository {
  static async summary(
    shopId: string,
    barberId: string,
  ): Promise<BarberRatingSummary> {
    const { rows } = await pool.query<{
      average: string | null;
      count: string;
    }>(
      `SELECT ROUND(AVG(rating)::numeric, 1)::text AS average, COUNT(*)::text AS count
       FROM barber_ratings WHERE shop_id = $1 AND barber_id = $2`,
      [shopId, barberId],
    );
    return {
      rating: rows[0]?.average ? Number(rows[0].average) : null,
      ratingCount: Number(rows[0]?.count ?? 0),
    };
  }

  static async findMine(
    shopId: string,
    barberId: string,
    customerId: string,
  ): Promise<MyBarberRatingStatus> {
    const eligible = await hasCompletedAppointment(
      shopId,
      barberId,
      customerId,
    );
    const { rows } = await pool.query<BarberRatingRecord>(
      `SELECT id, rating, comment, created_at AS "createdAt"
       FROM barber_ratings WHERE shop_id = $1 AND barber_id = $2 AND customer_id = $3`,
      [shopId, barberId, customerId],
    );
    const existing = rows[0] ?? null;
    let canRate = eligible;
    let nextEligibleDate: string | null = null;
    if (existing) {
      const ageMs = Date.now() - new Date(existing.createdAt).getTime();
      if (ageMs < RATING_COOLDOWN_MS) {
        canRate = false;
        nextEligibleDate = new Date(
          new Date(existing.createdAt).getTime() + RATING_COOLDOWN_MS,
        ).toISOString();
      }
    }
    return { rating: existing, eligible, canRate, nextEligibleDate };
  }

  static async rate(
    shopId: string,
    barberId: string,
    customerId: string,
    rating: number,
    comment: string,
  ): Promise<BarberRatingRecord> {
    if (!(await hasCompletedAppointment(shopId, barberId, customerId))) {
      throw new HttpError(409,
        "You can only rate a barber after a completed appointment with them.",
      );
    }

    const existing = await pool.query<{ createdAt: string }>(
      `SELECT created_at AS "createdAt" FROM barber_ratings
       WHERE shop_id = $1 AND barber_id = $2 AND customer_id = $3`,
      [shopId, barberId, customerId],
    );
    if (existing.rows[0]) {
      const ageMs = Date.now() - new Date(existing.rows[0].createdAt).getTime();
      if (ageMs < RATING_COOLDOWN_MS) {
        throw new HttpError(409,
          "You can rate a barber once every 3 months. Delete your existing rating to rate again sooner.",
        );
      }
    }

    const { rows } = await pool.query<BarberRatingRecord>(
      `INSERT INTO barber_ratings (shop_id, barber_id, customer_id, rating, comment)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (barber_id, customer_id)
       DO UPDATE SET rating = $4, comment = $5, created_at = NOW()
       RETURNING id, rating, comment, created_at AS "createdAt"`,
      [shopId, barberId, customerId, rating, comment],
    );
    return rows[0];
  }

  static async listForBarber(
    shopId: string,
    barberId: string,
  ): Promise<BarberReceivedRatingRecord[]> {
    const { rows } = await pool.query<BarberReceivedRatingRecord>(
      `SELECT r.id, c.full_name AS "authorName",
          c.profile_image_url AS "authorAvatarUrl", r.rating, r.comment,
          r.created_at::date::text AS date
       FROM barber_ratings r
       JOIN users c ON c.id = r.customer_id AND c.shop_id = r.shop_id
       WHERE r.shop_id = $1 AND r.barber_id = $2
       ORDER BY r.created_at DESC`,
      [shopId, barberId],
    );
    return rows;
  }

  static async remove(
    shopId: string,
    barberId: string,
    customerId: string,
  ): Promise<boolean> {
    const result = await pool.query(
      `DELETE FROM barber_ratings WHERE shop_id = $1 AND barber_id = $2 AND customer_id = $3`,
      [shopId, barberId, customerId],
    );
    return result.rowCount === 1;
  }

  // Barbers the customer has completed a visit with, over a week ago, but
  // never rated. Used to drive the weekly "leave a rating" reminder.
  static async findBarbersNeedingReminder(
    shopId: string,
    customerId: string,
  ): Promise<Array<{ barberId: string; barberName: string }>> {
    const { rows } = await pool.query<{ barberId: string; barberName: string }>(
      `SELECT a.barber_id AS "barberId", b.full_name AS "barberName"
       FROM appointments a
       JOIN users b ON b.id = a.barber_id
       WHERE a.shop_id = $1 AND a.customer_id = $2 AND a.status = 'COMPLETED'
         AND NOT EXISTS (
           SELECT 1 FROM barber_ratings r
           WHERE r.shop_id = a.shop_id AND r.barber_id = a.barber_id AND r.customer_id = a.customer_id
         )
       GROUP BY a.barber_id, b.full_name
       HAVING MIN(a.ends_at) <= NOW() - INTERVAL '7 days'`,
      [shopId, customerId],
    );
    return rows;
  }

  static async lastReminderSentAt(
    shopId: string,
    customerId: string,
    barberId: string,
  ): Promise<string | null> {
    const { rows } = await pool.query<{ createdAt: string }>(
      `SELECT created_at AS "createdAt" FROM notifications
       WHERE shop_id = $1 AND recipient_id = $2 AND type = 'RATING_REMINDER' AND related_id = $3
       ORDER BY created_at DESC LIMIT 1`,
      [shopId, customerId, barberId],
    );
    return rows[0]?.createdAt ?? null;
  }

  static isReminderDue(lastSentAt: string | null): boolean {
    if (!lastSentAt) return true;
    return Date.now() - new Date(lastSentAt).getTime() >= REMINDER_INTERVAL_MS;
  }
}
