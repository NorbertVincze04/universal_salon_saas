import type { Request, Response } from "express";
import { BarberGalleryRepository } from "../repositories/BarberGalleryRepository.ts";
import { hasRole } from "../types/user.types.ts";
import { IMAGE_DATA_URL_PATTERN } from "../utils/httpError.ts";

const MAX_GALLERY_PHOTOS = 12;
const MAX_IMAGE_DATA_LENGTH = 2_500_000;

export class BarberGalleryController {
  static async listMine(req: Request, res: Response): Promise<Response> {
    if (!hasRole(req.user!, "BARBER")) {
      return res.status(403).json({
        success: false,
        message: "Only barbers can manage a photo gallery.",
      });
    }

    return res.json({
      success: true,
      payload: await BarberGalleryRepository.listForBarber(
        req.shop!.id,
        req.user!.id,
      ),
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
      payload: await BarberGalleryRepository.listForBarber(
        req.shop!.id,
        barberId,
      ),
    });
  }

  static async createMine(req: Request, res: Response): Promise<Response> {
    if (!hasRole(req.user!, "BARBER")) {
      return res.status(403).json({
        success: false,
        message: "Only barbers can manage a photo gallery.",
      });
    }

    const { imageData, caption, imagePositionX, imagePositionY } = req.body;
    const trimmedCaption = typeof caption === "string" ? caption.trim() : "";
    const positionX = Number(imagePositionX ?? 50);
    const positionY = Number(imagePositionY ?? 50);
    if (
      typeof imageData !== "string" ||
      !IMAGE_DATA_URL_PATTERN.test(imageData) ||
      imageData.length > MAX_IMAGE_DATA_LENGTH ||
      trimmedCaption.length > 160 ||
      !Number.isInteger(positionX) ||
      positionX < 0 ||
      positionX > 100 ||
      !Number.isInteger(positionY) ||
      positionY < 0 ||
      positionY > 100
    ) {
      return res.status(400).json({
        success: false,
        message: "Choose a valid image and preview position.",
      });
    }

    const count = await BarberGalleryRepository.countForBarber(
      req.shop!.id,
      req.user!.id,
    );
    if (count >= MAX_GALLERY_PHOTOS) {
      return res.status(409).json({
        success: false,
        message: `You can upload up to ${MAX_GALLERY_PHOTOS} gallery photos.`,
      });
    }

    const photo = await BarberGalleryRepository.create(
      req.shop!.id,
      req.user!.id,
      imageData,
      positionX,
      positionY,
      trimmedCaption || null,
    );
    return res.status(201).json({ success: true, payload: photo });
  }

  static async deleteMine(req: Request, res: Response): Promise<Response> {
    if (!hasRole(req.user!, "BARBER")) {
      return res.status(403).json({
        success: false,
        message: "Only barbers can manage a photo gallery.",
      });
    }

    const photoId = req.params.photoId;
    if (typeof photoId !== "string") {
      return res
        .status(400)
        .json({ success: false, message: "A gallery photo is required." });
    }

    const deleted = await BarberGalleryRepository.deleteMine(
      req.shop!.id,
      req.user!.id,
      photoId,
    );
    return deleted
      ? res.status(204).send()
      : res
          .status(404)
          .json({ success: false, message: "Gallery photo not found." });
  }
}
