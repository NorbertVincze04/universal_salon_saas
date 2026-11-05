import type { Request, Response } from "express";
import {
  AppointmentRepository,
  type AppointmentRecord,
} from "../repositories/AppointmentRepository.ts";
import { AppointmentRequestRepository } from "../repositories/AppointmentRequestRepository.ts";
import { NotificationService } from "../services/NotificationService.ts";
import { hasRole } from "../types/user.types.ts";
import {
  isCalendarDate,
  isClockTime,
  isUuid,
  respondWithHttpError,
} from "../utils/httpError.ts";

function toPayload(appointment: AppointmentRecord) {
  return {
    id: appointment.id,
    date: appointment.appointment_date,
    hour: appointment.appointment_time.slice(0, 5),
    status: appointment.status,
    serviceId: appointment.service_id,
    serviceName: appointment.service_name,
    customerName: appointment.customer_name,
    barberId: appointment.barber_id,
    barberName: appointment.barber_name,
    guestName: appointment.guest_name,
    guestEmail: appointment.guest_email,
    guestPhone: appointment.guest_phone,
    pendingRequest: appointment.request_id
      ? {
          id: appointment.request_id,
          type: appointment.request_type,
          requestedDate: appointment.request_date,
          requestedTime: appointment.request_time?.slice(0, 5) ?? null,
          reason: appointment.request_reason,
        }
      : null,
  };
}

export class AppointmentController {
  static async listMine(req: Request, res: Response): Promise<Response> {
    const appointments = hasRole(req.user!, "BARBER")
      ? await AppointmentRepository.findForBarber(req.user!.id, req.shop!.id)
      : await AppointmentRepository.findForCustomer(req.user!.id, req.shop!.id);
    return res.json({
      success: true,
      payload: appointments.map(toPayload),
    });
  }

  static async updateMine(req: Request, res: Response): Promise<Response> {
    if (!hasRole(req.user!, "BARBER")) {
      return res.status(403).json({
        success: false,
        message: "Only barbers can manage appointments.",
      });
    }
    if (typeof req.params.id !== "string") {
      return res
        .status(400)
        .json({ success: false, message: "An appointment is required." });
    }
    const { status, date, time, serviceId } = req.body ?? {};
    let appointment: AppointmentRecord | null;
    if (status !== undefined) {
      if (
        !["SCHEDULED", "CONFIRMED", "COMPLETED", "CANCELLED"].includes(status)
      ) {
        return res.status(400).json({
          success: false,
          message: "A valid appointment status is required.",
        });
      }
      appointment = await AppointmentRepository.updateForBarber(
        req.params.id,
        req.user!.id,
        req.shop!.id,
        status,
      );
      if (appointment?.customer_id) {
        await NotificationService.notifyAppointmentStatusChanged(
          req.shop!.id,
          appointment.customer_id,
          {
            status: appointment.status,
            serviceName: appointment.service_name,
            date: appointment.appointment_date,
            time: appointment.appointment_time.slice(0, 5),
          },
        );
      }
    } else if (date !== undefined || time !== undefined || serviceId !== undefined) {
      if (!isCalendarDate(date) || !isClockTime(time) || !isUuid(serviceId)) {
        return res.status(400).json({
          success: false,
          message: "A valid date, time and service are required.",
        });
      }
      try {
        appointment = await AppointmentRepository.updateDetailsForBarber(
          req.params.id,
          req.user!.id,
          req.shop!.id,
          { date, time, serviceId },
        );
        if (appointment?.customer_id) {
          await NotificationService.notifyAppointmentStatusChanged(
            req.shop!.id,
            appointment.customer_id,
            {
              status: "RESCHEDULED",
              serviceName: appointment.service_name,
              date: appointment.appointment_date,
              time: appointment.appointment_time.slice(0, 5),
            },
          );
        }
      } catch (error) {
      return respondWithHttpError(res, error);
      }
    } else {
      return res.status(400).json({
        success: false,
        message: "Provide a status, or a date, time and service to update.",
      });
    }
    return appointment
      ? res.json({ success: true, payload: toPayload(appointment) })
      : res
          .status(404)
          .json({ success: false, message: "Appointment not found." });
  }

  static async deleteMine(req: Request, res: Response): Promise<Response> {
    if (!hasRole(req.user!, "BARBER")) {
      return res.status(403).json({
        success: false,
        message: "Only barbers can manage appointments.",
      });
    }
    if (typeof req.params.id !== "string") {
      return res
        .status(400)
        .json({ success: false, message: "An appointment is required." });
    }
    const deleted = await AppointmentRepository.deleteForBarber(
      req.params.id,
      req.user!.id,
      req.shop!.id,
    );
    return deleted
      ? res.status(204).send()
      : res
          .status(404)
          .json({ success: false, message: "Appointment not found." });
  }

  static async requestCancel(req: Request, res: Response): Promise<Response> {
    if (hasRole(req.user!, "BARBER")) {
      return res.status(403).json({
        success: false,
        message: "Only customers can request a cancellation.",
      });
    }
    if (typeof req.params.id !== "string") {
      return res
        .status(400)
        .json({ success: false, message: "An appointment is required." });
    }
    try {
      const request = await AppointmentRequestRepository.createCancelRequest(
        req.shop!.id,
        req.user!.id,
        req.user!.fullName,
        req.params.id,
        typeof req.body?.reason === "string"
          ? req.body.reason.trim().slice(0, 255) || undefined
          : undefined,
      );
      return res.status(201).json({ success: true, payload: request });
    } catch (error) {
      return respondWithHttpError(res, error);
    }
  }

  static async requestReschedule(
    req: Request,
    res: Response,
  ): Promise<Response> {
    if (hasRole(req.user!, "BARBER")) {
      return res.status(403).json({
        success: false,
        message: "Only customers can request a reschedule.",
      });
    }
    if (typeof req.params.id !== "string") {
      return res
        .status(400)
        .json({ success: false, message: "An appointment is required." });
    }
    const { date, time, reason } = req.body ?? {};
    if (
      !isCalendarDate(date) ||
      !isClockTime(time) ||
      (reason !== undefined &&
        reason !== null &&
        (typeof reason !== "string" || reason.length > 255))
    ) {
      return res.status(400).json({
        success: false,
        message: "A new date and time are required.",
      });
    }
    try {
      const request =
        await AppointmentRequestRepository.createRescheduleRequest(
          req.shop!.id,
          req.user!.id,
          req.user!.fullName,
          req.params.id,
          date,
          time,
          reason,
        );
      return res.status(201).json({ success: true, payload: request });
    } catch (error) {
      return respondWithHttpError(res, error);
    }
  }

  static async resolveRequest(req: Request, res: Response): Promise<Response> {
    if (!hasRole(req.user!, "BARBER")) {
      return res.status(403).json({
        success: false,
        message: "Only barbers can resolve change requests.",
      });
    }
    if (typeof req.params.id !== "string") {
      return res
        .status(400)
        .json({ success: false, message: "A request is required." });
    }
    const approve = req.body?.action === "APPROVE";
    if (!approve && req.body?.action !== "REJECT") {
      return res.status(400).json({
        success: false,
        message: "action must be APPROVE or REJECT.",
      });
    }
    try {
      const resolved = await AppointmentRequestRepository.resolve(
        req.shop!.id,
        req.user!.id,
        req.params.id,
        approve,
      );
      return resolved
        ? res.json({ success: true, payload: { status: resolved } })
        : res
            .status(404)
            .json({ success: false, message: "Request not found." });
    } catch (error) {
      return respondWithHttpError(res, error);
    }
  }
}
