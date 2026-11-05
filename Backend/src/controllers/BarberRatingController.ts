import type { Request, Response } from "express";
import { BarberRatingRepository } from "../repositories/BarberRatingRepository.ts";
import { NotificationService } from "../services/NotificationService.ts";
import { hasRole } from "../types/user.types.ts";
import { respondWithHttpError } from "../utils/httpError.ts";

export class BarberRatingController {
  static async mineReceived(req: Request, res: Response): Promise<Response> {
    if (!hasRole(req.user!, "BARBER")) {
      return res.status(403).json({
        success: false,
        message: "Only barbers can view their received ratings.",
      });
    }

    return res.json({
      success: true,
      payload: await BarberRatingRepository.listForBarber(
        req.shop!.id,
        req.user!.id,
      ),
    });
  }

  static async summary(req: Request, res: Response): Promise<Response> {
    const barberId = req.params.barberId;
    if (typeof barberId !== "string") {
      return res
        .status(400)
        .json({ success: false, message: "A barber is required." });
    }
    return res.json({
      success: true,
      payload: await BarberRatingRepository.summary(req.shop!.id, barberId),
    });
  }

  static async list(req: Request, res: Response): Promise<Response> {
    const barberId = req.params.barberId;
    if (typeof barberId !== "string") {
      return res
        .status(400)
        .json({ success: false, message: "A barber is required." });
    }
    return res.json({
      success: true,
      payload: await BarberRatingRepository.listForBarber(
        req.shop!.id,
        barberId,
      ),
    });
  }

  static async mine(req: Request, res: Response): Promise<Response> {
    const barberId = req.params.barberId;
    if (typeof barberId !== "string") {
      return res
        .status(400)
        .json({ success: false, message: "A barber is required." });
    }
    if (req.user!.role !== "CUSTOMER") {
      return res
        .status(403)
        .json({ success: false, message: "Only customers can rate barbers." });
    }
    return res.json({
      success: true,
      payload: await BarberRatingRepository.findMine(
        req.shop!.id,
        barberId,
        req.user!.id,
      ),
    });
  }

  static async rate(req: Request, res: Response): Promise<Response> {
    const barberId = req.params.barberId;
    const { rating, comment } = req.body;
    const numericRating = Number(rating);
    if (
      typeof barberId !== "string" ||
      !Number.isInteger(numericRating) ||
      numericRating < 1 ||
      numericRating > 5 ||
      typeof comment !== "string" ||
      !comment.trim() ||
      comment.trim().length > 2000
    ) {
      return res.status(400).json({
        success: false,
        message: "A rating (1-5) and a comment are required.",
      });
    }
    if (req.user!.role !== "CUSTOMER") {
      return res
        .status(403)
        .json({ success: false, message: "Only customers can rate barbers." });
    }
    try {
      const rated = await BarberRatingRepository.rate(
        req.shop!.id,
        barberId,
        req.user!.id,
        numericRating,
        comment.trim(),
      );
      await NotificationService.notifyBarberRatingReceived(
        req.shop!.id,
        barberId,
        {
          rating: rated.rating,
        },
      );
      return res.status(201).json({ success: true, payload: rated });
    } catch (error) {
      return respondWithHttpError(res, error);
    }
  }

  static async remove(req: Request, res: Response): Promise<Response> {
    const barberId = req.params.barberId;
    if (typeof barberId !== "string") {
      return res
        .status(400)
        .json({ success: false, message: "A barber is required." });
    }
    if (req.user!.role !== "CUSTOMER") {
      return res.status(403).json({
        success: false,
        message: "Only customers can delete their rating.",
      });
    }
    const deleted = await BarberRatingRepository.remove(
      req.shop!.id,
      barberId,
      req.user!.id,
    );
    return deleted
      ? res.status(204).send()
      : res.status(404).json({ success: false, message: "Rating not found." });
  }
}
