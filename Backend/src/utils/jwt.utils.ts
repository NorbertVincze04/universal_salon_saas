import jwt from "jsonwebtoken";
import type { UserPayload, UserRole } from "../types/user.types.ts";
import { JWT_EXPIRES_IN, JWT_SECRET } from "../config.ts";

// jwt token used for authentication and authorization

export function generateToken(user: UserPayload): string {
  return jwt.sign(
    {
      id: user.id,
      shopId: user.shopId,
      shopSlug: user.shopSlug,
      fullName: user.fullName,
      email: user.email,
      role: user.role,
      roles: user.roles,
    },
    JWT_SECRET,
    {
      expiresIn: JWT_EXPIRES_IN,
      algorithm: "HS256",
    },
  );
}

export function verifyToken(token: string): UserPayload | null {
  try {
    const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ["HS256"] });
    if (typeof decoded !== "object" || decoded === null) {
      return null;
    }

    const payload = decoded as Partial<UserPayload>;
    if (
      typeof payload.id !== "string" ||
      typeof payload.shopId !== "string" ||
      typeof payload.shopSlug !== "string" ||
      typeof payload.fullName !== "string" ||
      typeof payload.email !== "string" ||
      !["OWNER", "ADMIN", "BARBER", "CUSTOMER"].includes(payload.role ?? "")
    ) {
      return null;
    }

    const primaryRole = payload.role as UserRole;
    const roles: UserRole[] = Array.isArray(payload.roles)
      ? payload.roles
      : [primaryRole];
    if (
      !roles.every(
        (role) =>
          typeof role === "string" &&
          ["OWNER", "ADMIN", "BARBER", "CUSTOMER"].includes(role),
      )
    ) {
      return null;
    }

    payload.roles = roles;
    payload.issuedAt =
      typeof (decoded as { iat?: unknown }).iat === "number"
        ? (decoded as { iat: number }).iat
        : undefined;

    return payload as UserPayload;
  } catch (error) {
    return null;
  }
}
