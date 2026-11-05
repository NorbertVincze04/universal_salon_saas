import type { Request, Response } from "express";
import { AuthService } from "../services/AuthService.ts";
import {
  validateForgotPasswordRequest,
  validateLoginRequest,
  validateRegisterRequest,
  validateResetPasswordRequest,
  validateVerifyResetCodeRequest,
  type ForgotPasswordRequest,
  type LoginRequest,
  type RegisterRequest,
  type ResetPasswordRequest,
  type VerifyResetCodeRequest,
} from "../validators/auth.validator.ts";

export class AuthController {
  static async register(
    req: Request<{}, {}, RegisterRequest>,
    res: Response,
  ): Promise<Response> {
    try {
      const { valid, errors } = validateRegisterRequest(req.body);
      if (!valid) {
        return res.status(400).json({
          success: false,
          message: "Validation error",
          errors,
        });
      }

      const { fullName, email, password, phoneNumber } = req.body;

      const user = await AuthService.registerUser(
        fullName,
        email,
        password,
        req.shop!,
        phoneNumber,
      );

      return res.json({
        success: true,
        payload: user,
      });
    } catch (error: any) {
      console.error("Register failed:", error);

      if (error?.message?.includes("already exists") || error?.code === "23505") {
        return res.status(409).json({
          success: false,
          message: "An account with that email already exists.",
        });
      }

      return res.status(500).json({
        success: false,
        message: "Register failed.",
      });
    }
  }

  static async login(
    req: Request<{}, {}, LoginRequest>,
    res: Response,
  ): Promise<Response> {
    try {
      const { valid, errors } = validateLoginRequest(req.body);
      if (!valid) {
        return res.status(400).json({
          success: false,
          message: "Validation error",
          errors,
        });
      }

      const { email, password } = req.body;

      const result = await AuthService.loginUser(email, password, req.shop!);

      return res.json({
        success: true,
        payload: result,
      });
    } catch (error: any) {
      if (error?.message === "Email or password is incorrect.") {
        return res.status(401).json({ success: false, message: error.message });
      }
      console.error("Login failed:", error);
      return res.status(500).json({ success: false, message: "Login failed." });
    }
  }

  static async forgotPassword(
    req: Request<{}, {}, ForgotPasswordRequest>,
    res: Response,
  ): Promise<Response> {
    const { valid, errors } = validateForgotPasswordRequest(req.body);
    if (!valid) {
      return res.status(400).json({
        success: false,
        message: "Validation error",
        errors,
      });
    }

    // Always returns success, whether or not the email is registered, so we
    // never leak which accounts exist on this tenant.
    await AuthService.requestPasswordReset(req.body.email, req.shop!);

    return res.json({
      success: true,
      message: "If that email exists, a reset code has been sent.",
    });
  }

  static async verifyResetCode(
    req: Request<{}, {}, VerifyResetCodeRequest>,
    res: Response,
  ): Promise<Response> {
    const { valid, errors } = validateVerifyResetCodeRequest(req.body);
    if (!valid) {
      return res.status(400).json({
        success: false,
        message: "Validation error",
        errors,
      });
    }

    try {
      const { email, code } = req.body;
      const resetToken = await AuthService.verifyResetCode(
        email,
        code,
        req.shop!,
      );
      return res.json({ success: true, payload: { resetToken } });
    } catch (error: any) {
      return res.status(400).json({
        success: false,
        message: "Invalid or expired code.",
      });
    }
  }

  static async resetPassword(
    req: Request<{}, {}, ResetPasswordRequest>,
    res: Response,
  ): Promise<Response> {
    const { valid, errors } = validateResetPasswordRequest(req.body);
    if (!valid) {
      return res.status(400).json({
        success: false,
        message: "Validation error",
        errors,
      });
    }

    try {
      const { email, resetToken, newPassword } = req.body;
      await AuthService.resetPassword(
        email,
        resetToken,
        newPassword,
        req.shop!,
      );
      return res.json({
        success: true,
        message: "Password reset successfully.",
      });
    } catch (error: any) {
      return res.status(400).json({
        success: false,
        message: "Invalid or expired reset session.",
      });
    }
  }
}
