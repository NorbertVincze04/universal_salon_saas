import type { Request, Response } from "express";
import { BarberRepository } from "../repositories/BarberRepository.ts";
import { NotificationService } from "../services/NotificationService.ts";
import { hasRole } from "../types/user.types.ts";
import {
  EMAIL_PATTERN,
  PHONE_PATTERN,
  isCalendarDate,
  isClockTime,
  isUuid,
} from "../utils/httpError.ts";

// ISO-like timestamps, e.g. "2026-11-06T10:00" from <input type="datetime-local">
// or a full ISO string with offset. Passed through unchanged so Postgres keeps
// interpreting zone-less values exactly as before.
const TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}(:?\d{2})?)?$/;

function parseTimestamp(value: unknown): string | null {
  if (typeof value !== "string" || !TIMESTAMP_PATTERN.test(value)) return null;
  return Number.isNaN(new Date(value).getTime()) ? null : value;
}

type WorkingHourInput = {
  weekday: number;
  startTime: string;
  endTime: string;
  isActive?: boolean;
};

function parseWorkingHours(value: unknown): WorkingHourInput[] | null {
  if (!Array.isArray(value) || value.length > 7) return null;
  const seen = new Set<number>();
  const hours: WorkingHourInput[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") return null;
    const { weekday, startTime, endTime, isActive } = item as Record<
      string,
      unknown
    >;
    if (
      !Number.isInteger(weekday) ||
      (weekday as number) < 0 ||
      (weekday as number) > 6 ||
      seen.has(weekday as number) ||
      !isClockTime(startTime) ||
      !isClockTime(endTime) ||
      startTime.slice(0, 5) >= endTime.slice(0, 5) ||
      (isActive !== undefined && typeof isActive !== "boolean")
    ) {
      return null;
    }
    seen.add(weekday as number);
    hours.push({
      weekday: weekday as number,
      startTime,
      endTime,
      isActive: isActive as boolean | undefined,
    });
  }
  return hours;
}

function parseServiceInput(body: any): {
  name: string;
  durationMinutes: number;
  price: number;
} | null {
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const durationMinutes = Number(body?.durationMinutes);
  const price = Number(body?.price);
  if (
    !name ||
    name.length > 120 ||
    !Number.isInteger(durationMinutes) ||
    durationMinutes <= 0 ||
    durationMinutes > 24 * 60 ||
    !Number.isFinite(price) ||
    price < 0 ||
    price > 99_999_999
  ) {
    return null;
  }
  return { name, durationMinutes, price };
}

function parseBlockedPeriod(body: any): {
  startsAt: string;
  endsAt: string;
  reason: string | null;
} | null {
  const startsAt = parseTimestamp(body?.startsAt);
  const endsAt = parseTimestamp(body?.endsAt);
  const reason = body?.reason;
  if (
    !startsAt ||
    !endsAt ||
    (reason !== undefined &&
      reason !== null &&
      (typeof reason !== "string" || reason.trim().length > 255))
  ) {
    return null;
  }
  // Ordering (starts_at < ends_at) is enforced by a DB CHECK constraint.
  return {
    startsAt,
    endsAt,
    reason: typeof reason === "string" && reason.trim() ? reason.trim() : null,
  };
}

export class PublicController {
  static async listBarbers(req: Request, res: Response) {
    return res.json({
      success: true,
      payload: await BarberRepository.list(req.shop!.id),
    });
  }

  static async getBarber(req: Request, res: Response) {
    const barberId = req.params.barberId;
    if (typeof barberId !== "string") {
      return res
        .status(400)
        .json({ success: false, message: "A barber is required." });
    }
    const barber = await BarberRepository.find(req.shop!.id, barberId);
    return barber
      ? res.json({ success: true, payload: barber })
      : res.status(404).json({ success: false, message: "Barber not found." });
  }

  static async listServices(req: Request, res: Response) {
    const barberId =
      typeof req.query.barberId === "string" ? req.query.barberId : undefined;
    return res.json({
      success: true,
      payload: await BarberRepository.listServices(req.shop!.id, barberId),
    });
  }

  static async listMyServices(req: Request, res: Response) {
    if (!hasRole(req.user!, "BARBER"))
      return res.status(403).json({
        success: false,
        message: "Only barbers can view their services.",
      });
    return res.json({
      success: true,
      payload: await BarberRepository.listServices(req.shop!.id, req.user!.id),
    });
  }

  static async availability(req: Request, res: Response) {
    const { barberId, serviceId, date, excludeAppointmentId } = req.query;
    if (
      typeof barberId !== "string" ||
      typeof serviceId !== "string" ||
      typeof date !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      (excludeAppointmentId !== undefined &&
        typeof excludeAppointmentId !== "string")
    ) {
      return res.status(400).json({
        success: false,
        message: "barberId, serviceId and date are required.",
      });
    }
    const result = await BarberRepository.availability(
      req.shop!.id,
      barberId,
      serviceId,
      date,
      excludeAppointmentId,
    );
    return result
      ? res.json({ success: true, payload: result })
      : res
          .status(404)
          .json({ success: false, message: "Barber or service not found." });
  }

  static async createGuestAppointment(req: Request, res: Response) {
    const layout = req.shop!.config?.["layout"] as
      | Record<string, any>
      | undefined;
    if (layout?.["booking"]?.["allowGuestBooking"] === false) {
      return res.status(403).json({
        success: false,
        message: "Guest booking is disabled. Please sign in to book.",
      });
    }
    const {
      barberId,
      serviceId,
      date,
      time,
      guestName,
      guestEmail,
      guestPhone,
    } = req.body ?? {};
    if (
      !isUuid(barberId) ||
      !isUuid(serviceId) ||
      !isCalendarDate(date) ||
      !isClockTime(time) ||
      typeof guestName !== "string" ||
      !guestName.trim() ||
      guestName.trim().length > 150 ||
      typeof guestEmail !== "string" ||
      guestEmail.trim().length > 254 ||
      !EMAIL_PATTERN.test(guestEmail.trim()) ||
      typeof guestPhone !== "string" ||
      !PHONE_PATTERN.test(guestPhone.trim())
    ) {
      return res.status(400).json({
        success: false,
        message: "All booking details are required and must be valid.",
      });
    }
    const appointment = await BarberRepository.createAppointment({
      shopId: req.shop!.id,
      barberId,
      serviceId,
      date,
      time,
      guestName: guestName.trim(),
      guestEmail: guestEmail.trim().toLowerCase(),
      guestPhone: guestPhone.trim(),
    });
    await NotificationService.notifyAppointmentBooked(req.shop!.id, barberId, {
      customerName: guestName.trim(),
      serviceName: appointment.serviceName,
      date: appointment.date,
      time: String(appointment.time).slice(0, 5),
    });
    return res.status(201).json({ success: true, payload: appointment });
  }

  static async createAccountAppointment(req: Request, res: Response) {
    const { barberId, serviceId, date, time } = req.body ?? {};
    if (
      !isUuid(barberId) ||
      !isUuid(serviceId) ||
      !isCalendarDate(date) ||
      !isClockTime(time)
    ) {
      return res.status(400).json({
        success: false,
        message: "Barber, service, date and time are required.",
      });
    }
    const appointment = await BarberRepository.createAppointment({
      shopId: req.shop!.id,
      barberId,
      serviceId,
      date,
      time,
      customerId: req.user!.id,
    });
    await NotificationService.notifyAppointmentBooked(req.shop!.id, barberId, {
      customerName: req.user!.fullName,
      serviceName: appointment.serviceName,
      date: appointment.date,
      time: String(appointment.time).slice(0, 5),
    });
    return res.status(201).json({ success: true, payload: appointment });
  }

  static async getSchedule(req: Request, res: Response) {
    if (!hasRole(req.user!, "BARBER"))
      return res.status(403).json({
        success: false,
        message: "Only barbers can manage schedules.",
      });
    const barberId = req.user!.id;
    return res.json({
      success: true,
      payload: {
        hours: await BarberRepository.getWorkingHours(req.shop!.id, barberId),
        blockedPeriods: await BarberRepository.listBlockedPeriods(
          req.shop!.id,
          barberId,
        ),
      },
    });
  }

  static async saveSchedule(req: Request, res: Response) {
    if (!hasRole(req.user!, "BARBER"))
      return res.status(403).json({
        success: false,
        message: "Only barbers can manage schedules.",
      });
    const barberId = req.user!.id;
    const hours = parseWorkingHours(req.body?.hours ?? []);
    if (!hours) {
      return res.status(400).json({
        success: false,
        message:
          "Working hours need a weekday (0-6) and a start time before the end time.",
      });
    }
    await BarberRepository.saveWorkingHours(req.shop!.id, barberId, hours);
    return res.json({ success: true });
  }

  static async blockTime(req: Request, res: Response) {
    if (!hasRole(req.user!, "BARBER"))
      return res.status(403).json({
        success: false,
        message: "Only barbers can manage schedules.",
      });
    const barberId = req.user!.id;
    const period = parseBlockedPeriod(req.body);
    if (!period)
      return res
        .status(400)
        .json({ success: false, message: "A valid start and end are required." });
    return res.status(201).json({
      success: true,
      payload: await BarberRepository.addBlockedPeriod(
        req.shop!.id,
        barberId,
        period.startsAt,
        period.endsAt,
        period.reason ?? undefined,
      ),
    });
  }

  static async unblockTime(req: Request, res: Response) {
    if (!hasRole(req.user!, "BARBER"))
      return res.status(403).json({
        success: false,
        message: "Only barbers can manage schedules.",
      });
    const blockedId = req.params.id;
    if (typeof blockedId !== "string")
      return res
        .status(400)
        .json({ success: false, message: "A blocked period is required." });
    await BarberRepository.deleteBlockedPeriod(
      req.shop!.id,
      req.user!.id,
      blockedId,
    );
    return res.status(204).send();
  }

  static async updateBlockedTime(req: Request, res: Response) {
    if (!hasRole(req.user!, "BARBER"))
      return res.status(403).json({
        success: false,
        message: "Only barbers can manage schedules.",
      });
    const blockedId = req.params.id;
    if (typeof blockedId !== "string")
      return res
        .status(400)
        .json({ success: false, message: "A blocked period is required." });
    const input = parseBlockedPeriod(req.body);
    if (!input)
      return res
        .status(400)
        .json({ success: false, message: "A valid start and end are required." });
    const period = await BarberRepository.updateBlockedPeriod(
      req.shop!.id,
      req.user!.id,
      blockedId,
      input.startsAt,
      input.endsAt,
      input.reason ?? undefined,
    );
    return period
      ? res.json({ success: true, payload: period })
      : res
          .status(404)
          .json({ success: false, message: "Blocked period not found." });
  }

  static async createService(req: Request, res: Response) {
    if (!hasRole(req.user!, "BARBER"))
      return res
        .status(403)
        .json({ success: false, message: "Only barbers can create services." });
    const input = parseServiceInput(req.body);
    if (!input) {
      return res.status(400).json({
        success: false,
        message: "Name, duration and a valid price are required.",
      });
    }
    const service = await BarberRepository.createService(
      req.shop!.id,
      req.user!.id,
      input.name,
      input.durationMinutes,
      input.price,
    );
    return res.status(201).json({ success: true, payload: service });
  }

  static async updateService(req: Request, res: Response) {
    if (!hasRole(req.user!, "BARBER"))
      return res
        .status(403)
        .json({ success: false, message: "Only barbers can manage services." });
    const serviceId = req.params.id;
    if (typeof serviceId !== "string")
      return res
        .status(400)
        .json({ success: false, message: "A service is required." });
    const input = parseServiceInput(req.body);
    if (!input) {
      return res.status(400).json({
        success: false,
        message: "Name, duration and a valid price are required.",
      });
    }
    const service = await BarberRepository.updateService(
      req.shop!.id,
      req.user!.id,
      serviceId,
      input.name,
      input.durationMinutes,
      input.price,
    );
    return service
      ? res.json({ success: true, payload: service })
      : res.status(404).json({ success: false, message: "Service not found." });
  }

  static async deleteService(req: Request, res: Response) {
    if (!hasRole(req.user!, "BARBER"))
      return res
        .status(403)
        .json({ success: false, message: "Only barbers can manage services." });
    const serviceId = req.params.id;
    if (typeof serviceId !== "string")
      return res
        .status(400)
        .json({ success: false, message: "A service is required." });
    const deleted = await BarberRepository.deleteService(
      req.shop!.id,
      req.user!.id,
      serviceId,
    );
    return deleted
      ? res.status(204).send()
      : res.status(404).json({ success: false, message: "Service not found." });
  }
}
