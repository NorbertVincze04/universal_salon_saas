import { pool } from "../db.ts";
import { HttpError } from "../utils/httpError.ts";
import { bucharestTimeToUtc } from "./BarberRepository.ts";

export interface AppointmentRecord {
  id: string;
  appointment_date: string;
  appointment_time: string;
  status: string;
  service_id: string;
  service_name: string;
  customer_name: string | null;
  barber_id: string;
  barber_name: string | null;
  guest_name: string | null;
  guest_email: string | null;
  guest_phone: string | null;
  customer_id?: string | null;
  request_id?: string | null;
  request_type?: string | null;
  request_date?: string | null;
  request_time?: string | null;
  request_reason?: string | null;
}

// Appointments whose end time has already passed are no longer "scheduled";
// flip them to COMPLETED on read so the barber never has to set this by hand.
async function completePastAppointments(
  shopId: string,
  column: "barber_id" | "customer_id",
  id: string,
): Promise<void> {
  await pool.query(
    `UPDATE appointments SET status = 'COMPLETED', updated_at = NOW()
     WHERE shop_id = $1 AND ${column} = $2
       AND status NOT IN ('COMPLETED', 'CANCELLED') AND ends_at < NOW()`,
    [shopId, id],
  );
}

export class AppointmentRepository {
  static async findForCustomer(
    customerId: string,
    shopId: string,
  ): Promise<AppointmentRecord[]> {
    await completePastAppointments(shopId, "customer_id", customerId);
    const { rows } = await pool.query<AppointmentRecord>(
      `
      SELECT a.id, a.appointment_date::text, a.appointment_time::text, a.status, a.service_id,
        s.name AS service_name, u.full_name AS customer_name, a.barber_id, b.full_name AS barber_name,
        a.guest_name, a.guest_email, a.guest_phone,
        r.id AS request_id, r.type AS request_type,
        to_char(r.requested_date, 'YYYY-MM-DD') AS request_date,
        to_char(r.requested_time, 'HH24:MI') AS request_time,
        r.reason AS request_reason
      FROM appointments a
      INNER JOIN services s ON s.id = a.service_id AND s.shop_id = a.shop_id
      LEFT JOIN users u ON u.id = a.customer_id
      LEFT JOIN users b ON b.id = a.barber_id
      LEFT JOIN appointment_change_requests r ON r.appointment_id = a.id AND r.status = 'PENDING'
      WHERE a.customer_id = $1 AND a.shop_id = $2
      ORDER BY a.appointment_date ASC, a.appointment_time ASC
      `,
      [customerId, shopId],
    );
    return rows;
  }

  static async findForBarber(
    barberId: string,
    shopId: string,
  ): Promise<AppointmentRecord[]> {
    await completePastAppointments(shopId, "barber_id", barberId);
    const { rows } = await pool.query<AppointmentRecord>(
      `
      SELECT a.id, a.appointment_date::text, a.appointment_time::text, a.status, a.service_id,
        s.name AS service_name, u.full_name AS customer_name,
        a.guest_name, a.guest_email, a.guest_phone,
        r.id AS request_id, r.type AS request_type,
        to_char(r.requested_date, 'YYYY-MM-DD') AS request_date,
        to_char(r.requested_time, 'HH24:MI') AS request_time,
        r.reason AS request_reason
      FROM appointments a
      INNER JOIN services s ON s.id = a.service_id AND s.shop_id = a.shop_id
      LEFT JOIN users u ON u.id = a.customer_id
      LEFT JOIN appointment_change_requests r ON r.appointment_id = a.id AND r.status = 'PENDING'
      WHERE a.barber_id = $1 AND a.shop_id = $2
      ORDER BY a.appointment_date ASC, a.appointment_time ASC
      `,
      [barberId, shopId],
    );
    return rows;
  }

  static async updateForBarber(
    id: string,
    barberId: string,
    shopId: string,
    status: string,
  ): Promise<AppointmentRecord | null> {
    const { rows } = await pool.query<AppointmentRecord>(
      `
      UPDATE appointments a
      SET status = $4, updated_at = NOW()
      WHERE a.id = $1 AND a.barber_id = $2 AND a.shop_id = $3
      RETURNING a.id, a.appointment_date::text AS appointment_date,
        a.appointment_time::text AS appointment_time, a.status, a.service_id, a.customer_id,
        (SELECT s.name FROM services s WHERE s.id = a.service_id) AS service_name,
        (SELECT u.full_name FROM users u WHERE u.id = a.customer_id) AS customer_name,
        a.guest_name, a.guest_email, a.guest_phone
      `,
      [id, barberId, shopId, status],
    );
    return rows[0] ?? null;
  }

  // Lets a barber reschedule/change the service on their own appointment.
  // The DB's no-overlap exclusion constraint still guards against clashes.
  static async updateDetailsForBarber(
    id: string,
    barberId: string,
    shopId: string,
    input: { date: string; time: string; serviceId: string },
  ): Promise<AppointmentRecord | null> {
    const serviceResult = await pool.query<{ durationMinutes: number }>(
      `SELECT duration_minutes AS "durationMinutes" FROM services
       WHERE id = $1 AND shop_id = $2 AND (barber_id = $3 OR barber_id IS NULL)`,
      [input.serviceId, shopId, barberId],
    );
    const service = serviceResult.rows[0];
    if (!service) throw new HttpError(404, "Service not found.");

    const startsAt = bucharestTimeToUtc(input.date, input.time).toISOString();
    const endsAt = new Date(
      new Date(startsAt).getTime() + service.durationMinutes * 60000,
    ).toISOString();

    try {
      const { rows } = await pool.query<AppointmentRecord>(
        `
        UPDATE appointments a
        SET appointment_date = $4, appointment_time = $5, service_id = $6,
          starts_at = $7, ends_at = $8, updated_at = NOW()
        WHERE a.id = $1 AND a.barber_id = $2 AND a.shop_id = $3
        RETURNING a.id, a.appointment_date::text AS appointment_date,
        a.appointment_time::text AS appointment_time, a.status, a.service_id, a.customer_id,
          (SELECT s.name FROM services s WHERE s.id = a.service_id) AS service_name,
          (SELECT u.full_name FROM users u WHERE u.id = a.customer_id) AS customer_name,
          a.guest_name, a.guest_email, a.guest_phone
        `,
        [
          id,
          barberId,
          shopId,
          input.date,
          input.time,
          input.serviceId,
          startsAt,
          endsAt,
        ],
      );
      return rows[0] ?? null;
    } catch (error) {
      if ((error as { code?: string }).code === "23P01") {
        throw new HttpError(409, "This time overlaps with another appointment.");
      }
      throw error;
    }
  }

  static async deleteForBarber(
    id: string,
    barberId: string,
    shopId: string,
  ): Promise<boolean> {
    const result = await pool.query(
      `DELETE FROM appointments WHERE id = $1 AND barber_id = $2 AND shop_id = $3`,
      [id, barberId, shopId],
    );
    return result.rowCount === 1;
  }
}
