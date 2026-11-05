import type { Request, Response } from "express";
import { UserRepository } from "../repositories/UserRepository.ts";
import {
  EMAIL_PATTERN,
  IMAGE_DATA_URL_PATTERN,
} from "../utils/httpError.ts";

const MAX_PROFILE_IMAGE_LENGTH = 2_500_000;

export class UserController {
  static async deleteProfile(req: Request, res: Response): Promise<Response> {
    try {
      await UserRepository.deleteProfile(req.user!.id, req.shop!.id);
      return res.json({ success: true });
    } catch (error: any) {
      if (error.message === "User profile was not found.") {
        return res.status(404).json({ success: false, message: error.message });
      }
      console.error("Profile deletion failed:", error);
      return res
        .status(500)
        .json({ success: false, message: "Profile deletion failed." });
    }
  }

  static async updateProfile(req: Request, res: Response): Promise<Response> {
    const {
      fullName,
      email,
      phoneNumber,
      profileImageData,
      profileImagePositionX,
      profileImagePositionY,
    } = req.body;
    if (
      typeof fullName !== "string" ||
      !fullName.trim() ||
      fullName.trim().length > 150 ||
      typeof email !== "string" ||
      email.trim().length > 254 ||
      !EMAIL_PATTERN.test(email.trim())
    ) {
      return res.status(400).json({
        success: false,
        message: "A name and a valid email address are required.",
      });
    }
    if (
      profileImageData !== null &&
      profileImageData !== undefined &&
      (typeof profileImageData !== "string" ||
        profileImageData.length > MAX_PROFILE_IMAGE_LENGTH ||
        !IMAGE_DATA_URL_PATTERN.test(profileImageData))
    ) {
      return res.status(400).json({
        success: false,
        message: "Profile image must be a PNG, JPEG, WebP or GIF under 2.5 MB.",
      });
    }
    if (typeof phoneNumber !== "string" || !/^0[237]\d{8}$/.test(phoneNumber)) {
      return res.status(400).json({
        success: false,
        message: "Use a valid Romanian phone number with 10 digits.",
      });
    }
    const positionX = Number(profileImagePositionX);
    const positionY = Number(profileImagePositionY);
    if (
      !Number.isInteger(positionX) ||
      positionX < 0 ||
      positionX > 100 ||
      !Number.isInteger(positionY) ||
      positionY < 0 ||
      positionY > 100
    ) {
      return res.status(400).json({
        success: false,
        message: "Image position must be between 0 and 100.",
      });
    }

    try {
      const user = await UserRepository.updateProfile(
        req.user!.id,
        req.shop!.id,
        fullName.trim(),
        email.trim().toLowerCase(),
        phoneNumber.trim(),
        typeof profileImageData === "string" ? profileImageData : null,
        positionX,
        positionY,
      );
      return res.json({
        success: true,
        payload: {
          id: user.id,
          fullName: user.full_name,
          email: user.email,
          phoneNumber: user.phone_number,
          profileImageUrl: user.profile_image_url,
          profileImagePositionX: user.profile_image_position_x,
          profileImagePositionY: user.profile_image_position_y,
          role: user.role,
          roles: user.roles,
          shopId: req.shop!.id,
          shopSlug: req.shop!.slug,
        },
      });
    } catch (error: any) {
      if (error.code === "23505") {
        return res.status(409).json({
          success: false,
          message: "An account with that email already exists.",
        });
      }
      return res
        .status(500)
        .json({ success: false, message: "Profile update failed." });
    }
  }
}
