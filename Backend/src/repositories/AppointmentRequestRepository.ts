import { pool } from "../db.ts";
import { HttpError } from "../utils/httpError.ts";
import { bucharestTimeToUtc, BarberRepository } from "./BarberRepository.ts";
import { NotificationService } from "../services/NotificationService.ts";

export interface ChangeRequestRecord {
  id: string;
  type: "CANCEL" | "RESCHEDULE";
  status: string;
  requestedDate: string | null;
  requestedTime: string | null;
  reason: string | null;
}

function friendlyConflictError(error: unknown): never {
  const code = (error as { code?: string }).code;
  if (code === "23505") {
    throw new HttpError(409, "There is already a pending request for this appointment.");
  }
  if (code === "23P01") {
    throw new HttpError(409, "This new time overlaps with another appointment.");
  }
  throw error;
}

function calendarDate(value: string): string {
  const match = String(value).match(/^(\d{4}-\d{2}-\d{2})/);
  if (!match) throw new HttpError(400, "The requested date is invalid.");
  return match[1];
}

function clockTime(value: string): string {
  const match = String(value).match(/^(\d{2}:\d{2})(?::\d{2})?/);
  if (!match) throw new HttpError(400, "The requested time is invalid.");
  return match[1];
}

export class AppointmentRequestRepository {
  static async createCancelRequest(
    shopId: string,
    customerId: string,
    customerName: string,
    appointmentId: string,
    reason?: string,
  ): Promise<ChangeRequestRecord> {
    const appointment = await pool.query<{
      id: string;
      barberId: string;
      serviceName: string;
      date: string;
      time: string;
    }>(
      `SELECT a.id, a.barber_id AS "barberId", s.name AS "serviceName",
         a.appointment_date::text AS date, a.appointment_time::text AS time
       FROM appointments a
       INNER JOIN services s ON s.id = a.service_id
       WHERE a.id = $1 AND a.customer_id = $2 AND a.shop_id = $3
         AND a.status NOT IN ('COMPLETED', 'CANCELLED')`,
      [appointmentId, customerId, shopId],
    );
    if (!appointment.rowCount)
      throw new HttpError(404, "Appointment not found or can no longer be changed.");

    try {
      const { rows } = await pool.query<ChangeRequestRecord>(
        `INSERT INTO appointment_change_requests
          (shop_id, appointment_id, requested_by, type, reason)
         VALUES ($1, $2, $3, 'CANCEL', $4)
          RETURNING id, type, status, requested_date::text AS "requestedDate",
            requested_time::text AS "requestedTime", reason`,
        [shopId, appointmentId, customerId, reason ?? null],
      );
      const { barberId, serviceName, date, time } = appointment.rows[0];
      await NotificationService.notifyChangeRequested(shopId, barberId, {
        requesterName: customerName,
        type: "CANCEL",
        serviceName,
        date,
        time: time.slice(0, 5),
      });
      return rows[0];
    } catch (error) {
      friendlyConflictError(error);
    }
  }

  static async createRescheduleRequest(
    shopId: string,
    customerId: string,
    customerName: string,
    appointmentId: string,
    date: string,
    time: string,
    reason?: string,
  ): Promise<ChangeRequestRecord> {
    const requestedDate = calendarDate(date);
    const requestedTime = clockTime(time);
    const appointment = await pool.query<{
      id: string;
      barberId: string;
      durationMinutes: number;
      serviceName: string;
    }>(
      `SELECT a.id, a.barber_id AS "barberId", s.duration_minutes AS "durationMinutes",
         s.name AS "serviceName"
       FROM appointments a
       INNER JOIN services s ON s.id = a.service_id
       WHERE a.id = $1 AND a.customer_id = $2 AND a.shop_id = $3
         AND a.status NOT IN ('COMPLETED', 'CANCELLED')`,
      [appointmentId, customerId, shopId],
    );
    if (!appointment.rowCount)
      throw new HttpError(404, "Appointment not found or can no longer be changed.");

    const { barberId, durationMinutes, serviceName } = appointment.rows[0];
    await BarberRepository.assertAvailable(
      shopId,
      barberId,
      requestedDate,
      requestedTime,
      durationMinutes,
      appointmentId,
    );

    try {
      const { rows } = await pool.query<ChangeRequestRecord>(
        `INSERT INTO appointment_change_requests
          (shop_id, appointment_id, requested_by, type, requested_date, requested_time, reason)
         VALUES ($1, $2, $3, 'RESCHEDULE', $4, $5, $6)
         RETURNING id, type, status, requested_date::text AS "requestedDate",
           requested_time::text AS "requestedTime", reason`,
        [
          shopId,
          appointmentId,
          customerId,
          requestedDate,
          requestedTime,
          reason ?? null,
        ],
      );
      await NotificationService.notifyChangeRequested(shopId, barberId, {
        requesterName: customerName,
        type: "RESCHEDULE",
        serviceName,
        date: requestedDate,
        time: requestedTime,
      });
      return rows[0];
    } catch (error) {
      friendlyConflictError(error);
    }
  }

  // Approves or rejects a pending request; on approval this also applies the
  // change to the appointment itself (cancel it, or move its date/time).
  static async resolve(
    shopId: string,
    barberId: string,
    requestId: string,
    approve: boolean,
  ): Promise<"APPROVED" | "REJECTED" | null> {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const requestResult = await client.query<{
        id: string;
        appointmentId: string;
        type: "CANCEL" | "RESCHEDULE";
        requestedDate: string | null;
        requestedTime: string | null;
        requestedBy: string;
      }>(
        `SELECT r.id, r.appointment_id AS "appointmentId", r.type,
           r.requested_date::text AS "requestedDate",
           r.requested_time::text AS "requestedTime",
           r.requested_by AS "requestedBy"
         FROM appointment_change_requests r
         INNER JOIN appointments a ON a.id = r.appointment_id
         WHERE r.id = $1 AND r.shop_id = $2 AND a.barber_id = $3 AND r.status = 'PENDING'
         FOR UPDATE`,
        [requestId, shopId, barberId],
      );
      const request = requestResult.rows[0];
      if (!request) {
        await client.query("ROLLBACK");
        return null;
      }

      if (!approve) {
        await client.query(
          `UPDATE appointment_change_requests SET status = 'REJECTED', resolved_at = NOW() WHERE id = $1`,
          [requestId],
        );
        await client.query("COMMIT");
        await NotificationService.notifyChangeResolved(
          shopId,
          request.requestedBy,
          {
            approved: false,
            type: request.type,
          },
        );
        return "REJECTED";
      }

      if (request.type === "CANCEL") {
        await client.query(
          `UPDATE appointments SET status = 'CANCELLED', updated_at = NOW() WHERE id = $1`,
          [request.appointmentId],
        );
      } else {
        const serviceResult = await client.query<{ durationMinutes: number }>(
          `SELECT s.duration_minutes AS "durationMinutes"
           FROM appointments a INNER JOIN services s ON s.id = a.service_id
           WHERE a.id = $1`,
          [request.appointmentId],
        );
        const durationMinutes = serviceResult.rows[0]?.durationMinutes;
        if (!durationMinutes) throw new HttpError(404, "Service not found.");
        const requestedDate = calendarDate(request.requestedDate!);
        const requestedTime = clockTime(request.requestedTime!);
        const startsAt = bucharestTimeToUtc(
          requestedDate,
          requestedTime,
        ).toISOString();
        const endsAt = new Date(
          new Date(startsAt).getTime() + durationMinutes * 60000,
        ).toISOString();
        await client.query(
          `UPDATE appointments
           SET appointment_date = $2::date, appointment_time = $3::time,
             starts_at = $4, ends_at = $5, updated_at = NOW()
           WHERE id = $1`,
          [
            request.appointmentId,
            requestedDate,
            requestedTime,
            startsAt,
            endsAt,
          ],
        );
      }

      await client.query(
        `UPDATE appointment_change_requests SET status = 'APPROVED', resolved_at = NOW() WHERE id = $1`,
        [requestId],
      );
      await client.query("COMMIT");
      await NotificationService.notifyChangeResolved(
        shopId,
        request.requestedBy,
        {
          approved: true,
          type: request.type,
        },
      );
      return "APPROVED";
    } catch (error) {
      await client.query("ROLLBACK");
      friendlyConflictError(error);
    } finally {
      client.release();
    }
  }
}
