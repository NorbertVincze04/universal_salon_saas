import type { Request, Response, NextFunction } from "express";
import { verifyToken } from "../utils/jwt.utils.ts";
import type { UserPayload } from "../types/user.types.ts";
import { UserRepository } from "../repositories/UserRepository.ts";

declare global {
  namespace Express {
    interface Request {
      user?: UserPayload;
    }
  }
}

export async function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void | Response> {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        success: false,
        message: "Missing or invalid authorization header",
      });
    }

    const token = authHeader.substring(7);
    const user = verifyToken(token);

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Invalid or expired token",
      });
    }

    // Tenant isolation: a token is only valid on the salon that issued it.
    // 401 (not 403) so clients drop the foreign session and re-authenticate.
    if (!req.shop || user.shopId !== req.shop.id) {
      return res.status(401).json({
        success: false,
        message: "Your session belongs to a different salon. Please log in.",
      });
    }

    const authState = await UserRepository.findAuthState(user.id, req.shop.id);
    const tokenRoles = [...user.roles].sort();
    const databaseRoles = authState ? [...authState.roles].sort() : [];
    const rolesChanged =
      tokenRoles.length !== databaseRoles.length ||
      tokenRoles.some((role, index) => role !== databaseRoles[index]);

    if (!authState || authState.role !== user.role || rolesChanged) {
      return res.status(401).json({
        success: false,
        message: "Your account permissions changed. Please log in again.",
      });
    }

    // Tokens issued before the last password change are revoked.
    if (
      authState.passwordChangedAt &&
      (user.issuedAt === undefined ||
        user.issuedAt <
          Math.floor(new Date(authState.passwordChangedAt).getTime() / 1000))
    ) {
      return res.status(401).json({
        success: false,
        message: "Your password was changed. Please log in again.",
      });
    }

    req.user = user;
    next();
  } catch (error) {
    console.error("Auth middleware error:", error);

    return res.status(401).json({
      success: false,
      message: "Authentication failed",
    });
  }
}
