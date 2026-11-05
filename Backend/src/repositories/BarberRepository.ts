import { pool } from "../db.ts";
import { HttpError } from "../utils/httpError.ts";

const BOOKING_TIME_ZONE = "Europe/Bucharest";

function normalizeTime(time: string): string {
  return time.split(":").slice(0, 2).join(":");
}

function timeToMinutes(time: string): number {
  const [hours, minutes] = normalizeTime(time).split(":").map(Number);
  return hours * 60 + minutes;
}

export function bucharestTimeToUtc(date: string, time: string): Date {
  const wallClock = new Date(`${date}T${normalizeTime(time)}:00Z`);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: BOOKING_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(wallClock);
  const values = Object.fromEntries(
    parts
      .filter(({ type }) => type !== "literal")
      .map(({ type, value }) => [type, Number(value)]),
  );
  const offset =
    Date.UTC(
      values.year,
      values.month - 1,
      values.day,
      values.hour,
      values.minute,
      values.second,
    ) - wallClock.getTime();
  return new Date(wallClock.getTime() - offset);
}

export function formatBucharestTime(value: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: BOOKING_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(value);
}

export interface BarberProfile {
  id: string;
  name: string;
  phoneNumber: string | null;
  profileImageUrl: string | null;
  profileImagePositionX: number;
  profileImagePositionY: number;
  roles: string[];
  rating: number | null;
  ratingCount: number;
}

export interface ServiceRecord {
  id: string;
  name: string;
  durationMinutes: number;
  price: string;
}

export class BarberRepository {
  static async createService(
    shopId: string,
    barberId: string,
    name: string,
    durationMinutes: number,
    price: number,
  ) {
    const barber = await pool.query(
      `SELECT id FROM users
       WHERE id = $1 AND shop_id = $2 AND 'BARBER' = ANY(roles) AND is_active = TRUE`,
      [barberId, shopId],
    );
    if (!barber.rowCount) throw new HttpError(404, "Barber not found.");
    const { rows } = await pool.query(
      `INSERT INTO services (shop_id, barber_id, name, duration_minutes, price)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, name, duration_minutes AS "durationMinutes", price::text`,
      [shopId, barberId, name.trim(), durationMinutes, price],
    );
    return rows[0];
  }

  static async updateService(
    shopId: string,
    barberId: string,
    serviceId: string,
    name: string,
    durationMinutes: number,
    price: number,
  ): Promise<ServiceRecord | null> {
    const { rows } = await pool.query(
      `UPDATE services SET name = $4, duration_minutes = $5, price = $6
       WHERE id = $1 AND shop_id = $2 AND barber_id = $3
       RETURNING id, name, duration_minutes AS "durationMinutes", price::text`,
      [serviceId, shopId, barberId, name.trim(), durationMinutes, price],
    );
    return rows[0] ?? null;
  }

  static async deleteService(
    shopId: string,
    barberId: string,
    serviceId: string,
  ): Promise<boolean> {
    const result = await pool.query(
      `DELETE FROM services WHERE id = $1 AND shop_id = $2 AND barber_id = $3`,
      [serviceId, shopId, barberId],
    );
    return result.rowCount === 1;
  }

  static async saveWorkingHours(
    shopId: string,
    barberId: string,
    hours: Array<{
      weekday: number;
      startTime: string;
      endTime: string;
      isActive?: boolean;
    }>,
  ) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      for (const hour of hours) {
        await client.query(
          `INSERT INTO barber_working_hours (shop_id, barber_id, weekday, start_time, end_time, is_active)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (barber_id, weekday) DO UPDATE SET start_time = $4, end_time = $5, is_active = $6`,
          [
            shopId,
            barberId,
            hour.weekday,
            hour.startTime,
            hour.endTime,
            hour.isActive ?? true,
          ],
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  static async getWorkingHours(shopId: string, barberId: string) {
    const { rows } = await pool.query(
      `SELECT weekday, start_time::text AS "startTime", end_time::text AS "endTime", is_active AS "isActive"
       FROM barber_working_hours WHERE shop_id = $1 AND barber_id = $2 ORDER BY weekday`,
      [shopId, barberId],
    );
    return rows;
  }

  static async addBlockedPeriod(
    shopId: string,
    barberId: string,
    startsAt: string,
    endsAt: string,
    reason?: string,
  ) {
    const { rows } = await pool.query(
      `INSERT INTO barber_blocked_periods (shop_id, barber_id, starts_at, ends_at, reason)
       VALUES ($1, $2, $3, $4, $5) RETURNING id, starts_at AS "startsAt", ends_at AS "endsAt", reason`,
      [shopId, barberId, startsAt, endsAt, reason ?? null],
    );
    return rows[0];
  }

  static async listBlockedPeriods(shopId: string, barberId: string) {
    const { rows } = await pool.query(
      `SELECT id, starts_at AS "startsAt", ends_at AS "endsAt", reason
       FROM barber_blocked_periods WHERE shop_id = $1 AND barber_id = $2 ORDER BY starts_at`,
      [shopId, barberId],
    );
    return rows;
  }

  static async updateBlockedPeriod(
    shopId: string,
    barberId: string,
    id: string,
    startsAt: string,
    endsAt: string,
    reason?: string,
  ) {
    const { rows } = await pool.query(
      `UPDATE barber_blocked_periods SET starts_at = $4, ends_at = $5, reason = $6
       WHERE id = $1 AND shop_id = $2 AND barber_id = $3
       RETURNING id, starts_at AS "startsAt", ends_at AS "endsAt", reason`,
      [id, shopId, barberId, startsAt, endsAt, reason ?? null],
    );
    return rows[0] ?? null;
  }

  static async deleteBlockedPeriod(
    shopId: string,
    barberId: string,
    id: string,
  ) {
    await pool.query(
      `DELETE FROM barber_blocked_periods WHERE id = $1 AND shop_id = $2 AND barber_id = $3`,
      [id, shopId, barberId],
    );
  }

  static async list(shopId: string): Promise<BarberProfile[]> {
    const { rows } = await pool.query(
      `SELECT u.id, u.full_name AS name, u.phone_number AS "phoneNumber",
        u.profile_image_url AS "profileImageUrl", u.profile_image_position_x AS "profileImagePositionX", u.profile_image_position_y AS "profileImagePositionY",
        u.roles,
        (SELECT ROUND(AVG(r.rating)::numeric, 1) FROM barber_ratings r WHERE r.barber_id = u.id) AS rating,
        (SELECT COUNT(*) FROM barber_ratings r WHERE r.barber_id = u.id)::int AS "ratingCount"
      FROM users u WHERE u.shop_id = $1 AND 'BARBER' = ANY(u.roles) AND u.is_active = TRUE
       ORDER BY u.full_name`,
      [shopId],
    );
    return rows;
  }

  static async find(
    shopId: string,
    barberId: string,
  ): Promise<BarberProfile | null> {
    const { rows } = await pool.query(
      `SELECT u.id, u.full_name AS name, u.phone_number AS "phoneNumber",
        u.profile_image_url AS "profileImageUrl", u.profile_image_position_x AS "profileImagePositionX", u.profile_image_position_y AS "profileImagePositionY",
        u.roles,
        (SELECT ROUND(AVG(r.rating)::numeric, 1) FROM barber_ratings r WHERE r.barber_id = u.id) AS rating,
        (SELECT COUNT(*) FROM barber_ratings r WHERE r.barber_id = u.id)::int AS "ratingCount"
      FROM users u WHERE u.id = $1 AND u.shop_id = $2 AND 'BARBER' = ANY(u.roles) AND u.is_active = TRUE`,
      [barberId, shopId],
    );
    return rows[0] ?? null;
  }

  static async listServices(
    shopId: string,
    barberId?: string,
  ): Promise<ServiceRecord[]> {
    const { rows } = await pool.query(
      `SELECT id, name, duration_minutes AS "durationMinutes", price::text
      FROM services
      WHERE shop_id = $1 AND ($2::uuid IS NULL OR barber_id = $2 OR barber_id IS NULL)
      ORDER BY name`,
      [shopId, barberId ?? null],
    );
    return rows;
  }

  static async availability(
    shopId: string,
    barberId: string,
    serviceId: string,
    date: string,
    excludeAppointmentId?: string,
  ) {
    const barber = await this.find(shopId, barberId);
    if (!barber) return null;

    const serviceResult = await pool.query<ServiceRecord>(
      `SELECT id, name, duration_minutes AS "durationMinutes", price::text
      FROM services
      WHERE id = $1 AND shop_id = $2 AND (barber_id = $3 OR barber_id IS NULL)`,
      [serviceId, shopId, barberId],
    );
    const service = serviceResult.rows[0];
    if (!service) return null;

    const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
    const hoursResult = await pool.query(
      `SELECT start_time::text, end_time::text FROM barber_working_hours
       WHERE shop_id = $1 AND barber_id = $2 AND weekday = $3 AND is_active = TRUE`,
      [shopId, barberId, weekday],
    );
    if (!hoursResult.rows[0]) return { barber, service, slots: [] };

    const blocksResult = await pool.query(
      `SELECT starts_at, ends_at FROM barber_blocked_periods
       WHERE shop_id = $1 AND barber_id = $2
         AND starts_at < (($3::date + INTERVAL '1 day') AT TIME ZONE '${BOOKING_TIME_ZONE}')
         AND ends_at > ($3::date AT TIME ZONE '${BOOKING_TIME_ZONE}')`,
      [shopId, barberId, date],
    );
    const appointmentsResult = await pool.query(
      `SELECT starts_at, ends_at FROM appointments
       WHERE shop_id = $1 AND barber_id = $2 AND status <> 'CANCELLED'
         AND ($4::uuid IS NULL OR id <> $4)
         AND starts_at < (($3::date + INTERVAL '1 day') AT TIME ZONE '${BOOKING_TIME_ZONE}')
         AND ends_at > ($3::date AT TIME ZONE '${BOOKING_TIME_ZONE}')`,
      [shopId, barberId, date, excludeAppointmentId ?? null],
    );

    const hours = hoursResult.rows[0];
    const dayStart = bucharestTimeToUtc(date, hours.start_time).getTime();
    const dayEnd = bucharestTimeToUtc(date, hours.end_time).getTime();
    const now = Date.now();
    const occupied = [...blocksResult.rows, ...appointmentsResult.rows];
    const slots: string[] = [];
    for (
      let start = dayStart;
      start + service.durationMinutes * 60000 <= dayEnd;
      start += 30 * 60000
    ) {
      const end = start + service.durationMinutes * 60000;
      if (
        start > now &&
        !occupied.some(
          (item) =>
            start < new Date(item.ends_at).getTime() &&
            end > new Date(item.starts_at).getTime(),
        )
      ) {
        slots.push(formatBucharestTime(new Date(start)));
      }
    }
    return { barber, service, slots };
  }

  // Rejects a date/time that falls outside working hours, inside a blocked
  // period, or overlapping another appointment. Shared by direct booking and
  // by reschedule requests so both paths only offer times the barber can honor.
  static async assertAvailable(
    shopId: string,
    barberId: string,
    date: string,
    time: string,
    durationMinutes: number,
    excludeAppointmentId?: string,
  ): Promise<void> {
    const startsAt = bucharestTimeToUtc(date, time).toISOString();
    const endsAt = new Date(
      new Date(startsAt).getTime() + durationMinutes * 60000,
    ).toISOString();
    if (new Date(startsAt).getTime() <= Date.now()) {
      throw new HttpError(409, "This time is in the past.");
    }
    const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
    const hoursResult = await pool.query(
      `SELECT start_time::text, end_time::text FROM barber_working_hours
       WHERE shop_id = $1 AND barber_id = $2 AND weekday = $3 AND is_active = TRUE`,
      [shopId, barberId, weekday],
    );
    const hours = hoursResult.rows[0];
    if (
      !hours ||
      timeToMinutes(time) < timeToMinutes(hours.start_time) ||
      timeToMinutes(formatBucharestTime(new Date(endsAt))) >
        timeToMinutes(hours.end_time)
    ) {
      throw new HttpError(409, "This time is outside the barber's working hours.");
    }
    const blockedResult = await pool.query(
      `SELECT 1 FROM barber_blocked_periods
       WHERE shop_id = $1 AND barber_id = $2 AND starts_at < $4 AND ends_at > $3 LIMIT 1`,
      [shopId, barberId, startsAt, endsAt],
    );
    if (blockedResult.rowCount)
      throw new HttpError(409, "This time is blocked by the barber.");

    const overlapResult = await pool.query(
      `SELECT 1 FROM appointments
       WHERE shop_id = $1 AND barber_id = $2 AND status <> 'CANCELLED'
         AND starts_at < $4 AND ends_at > $3
         AND ($5::uuid IS NULL OR id <> $5)
       LIMIT 1`,
      [shopId, barberId, startsAt, endsAt, excludeAppointmentId ?? null],
    );
    if (overlapResult.rowCount)
      throw new HttpError(409, "This time overlaps with another appointment.");
  }

  static async createAppointment(input: {
    shopId: string;
    barberId: string;
    serviceId: string;
    date: string;
    time: string;
    customerId?: string;
    guestName?: string;
    guestEmail?: string;
    guestPhone?: string;
  }) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const serviceResult = await client.query<ServiceRecord>(
        `SELECT id, name, duration_minutes AS "durationMinutes", price::text
         FROM services
         WHERE id = $1 AND shop_id = $2 AND (barber_id = $3 OR barber_id IS NULL)`,
        [input.serviceId, input.shopId, input.barberId],
      );
      const service = serviceResult.rows[0];
      if (!service) throw new HttpError(404, "Service not found.");
      const barberResult = await client.query(
        `SELECT id FROM users
         WHERE id = $1 AND shop_id = $2 AND 'BARBER' = ANY(roles) AND is_active = TRUE`,
        [input.barberId, input.shopId],
      );
      if (!barberResult.rowCount) throw new HttpError(404, "Barber not found.");

      const startsAt = bucharestTimeToUtc(input.date, input.time).toISOString();
      const endsAt = new Date(
        new Date(startsAt).getTime() + service.durationMinutes * 60000,
      ).toISOString();
      if (new Date(startsAt).getTime() <= Date.now()) {
        throw new HttpError(409, "This time is in the past.");
      }
      const weekday = new Date(`${input.date}T12:00:00Z`).getUTCDay();
      const hoursResult = await client.query(
        `SELECT start_time::text, end_time::text FROM barber_working_hours
         WHERE shop_id = $1 AND barber_id = $2 AND weekday = $3 AND is_active = TRUE`,
        [input.shopId, input.barberId, weekday],
      );
      const hours = hoursResult.rows[0];
      if (
        !hours ||
        timeToMinutes(input.time) < timeToMinutes(hours.start_time) ||
        timeToMinutes(formatBucharestTime(new Date(endsAt))) >
          timeToMinutes(hours.end_time)
      ) {
        throw new HttpError(409, "This time is outside the barber's working hours.");
      }
      const blockedResult = await client.query(
        `SELECT 1 FROM barber_blocked_periods
         WHERE shop_id = $1 AND barber_id = $2 AND starts_at < $4 AND ends_at > $3 LIMIT 1`,
        [input.shopId, input.barberId, startsAt, endsAt],
      );
      if (blockedResult.rowCount)
        throw new HttpError(409, "This time is blocked by the barber.");
      const result = await client.query(
        `INSERT INTO appointments
          (shop_id, customer_id, service_id, barber_id, appointment_date, appointment_time,
           starts_at, ends_at, guest_name, guest_email, guest_phone)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         RETURNING id, appointment_date::text AS date, appointment_time::text AS time, status`,
        [
          input.shopId,
          input.customerId ?? null,
          input.serviceId,
          input.barberId,
          input.date,
          input.time,
          startsAt,
          endsAt,
          input.guestName ?? null,
          input.guestEmail ?? null,
          input.guestPhone ?? null,
        ],
      );
      await client.query("COMMIT");
      return { ...result.rows[0], serviceName: service.name };
    } catch (error) {
      await client.query("ROLLBACK");
      if ((error as { code?: string }).code === "23P01") {
        throw new HttpError(409, "This time is no longer available.");
      }
      throw error;
    } finally {
      client.release();
    }
  }
}
