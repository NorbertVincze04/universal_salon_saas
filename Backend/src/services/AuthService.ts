import bcrypt from "bcrypt";
import crypto from "node:crypto";
import { UserRepository } from "../repositories/UserRepository.ts";
import { PasswordResetRepository } from "../repositories/PasswordResetRepository.ts";
import { MailService } from "./MailService.ts";
import { generateToken } from "../utils/jwt.utils.ts";
import type { UserPayload } from "../types/user.types.ts";
import type { ShopRecord } from "../types/tenant.types.ts";

const BCRYPT_ROUNDS = 12;
// Hash of a random value nobody knows; compared against when the email is
// unknown so failed logins take the same time whether or not the user exists.
const DUMMY_PASSWORD_HASH = bcrypt.hashSync(
  crypto.randomBytes(32).toString("hex"),
  BCRYPT_ROUNDS,
);

export class AuthService {
  static async registerUser(
    fullName: string,
    email: string,
    password: string,
    shop: ShopRecord,
    phoneNumber: string,
  ): Promise<{
    id: string;
    fullName: string;
    email: string;
    role: string;
    roles: string[];
    shopId: string;
    shopSlug: string;
    phoneNumber: string | null;
    profileImageUrl: string | null;
    profileImagePositionX: number;
    profileImagePositionY: number;
  }> {
    const normalizedEmail = email.trim().toLowerCase();
    const existingUser = await UserRepository.existsByEmail(
      shop.id,
      normalizedEmail,
    );
    if (existingUser) {
      throw new Error("An account with that email already exists.");
    }

    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

    const user = await UserRepository.create(
      fullName,
      normalizedEmail,
      passwordHash,
      shop.id,
      "CUSTOMER",
      phoneNumber?.trim() || null,
    );

    return {
      id: user.id,
      fullName: user.full_name,
      email: user.email,
      role: user.role,
      roles: user.roles,
      shopId: shop.id,
      shopSlug: shop.slug,
      phoneNumber: user.phone_number,
      profileImageUrl: user.profile_image_url,
      profileImagePositionX: user.profile_image_position_x,
      profileImagePositionY: user.profile_image_position_y,
    };
  }

  static async loginUser(
    email: string,
    password: string,
    shop: ShopRecord,
  ): Promise<{
    id: string;
    fullName: string;
    email: string;
    role: string;
    roles: string[];
    shopId: string;
    shopSlug: string;
    phoneNumber: string | null;
    profileImageUrl: string | null;
    profileImagePositionX: number;
    profileImagePositionY: number;
    token: string;
  }> {
    const user = await UserRepository.findByEmail(
      shop.id,
      email.trim().toLowerCase(),
    );
    // Always run a bcrypt comparison, even for unknown emails, so response
    // timing does not reveal which accounts exist on this tenant.
    const passwordMatches = await bcrypt.compare(
      password,
      user?.password_hash ?? DUMMY_PASSWORD_HASH,
    );
    if (!user || !passwordMatches) {
      throw new Error("Email or password is incorrect.");
    }

    const userPayload: UserPayload = {
      id: user.id,
      shopId: user.shop_id,
      shopSlug: user.shop_slug,
      fullName: user.full_name,
      email: user.email,
      role: user.role,
      roles: user.roles,
    };

    const token = generateToken(userPayload);

    return {
      id: user.id,
      fullName: user.full_name,
      email: user.email,
      role: user.role,
      roles: user.roles,
      shopId: user.shop_id,
      shopSlug: user.shop_slug,
      phoneNumber: user.phone_number,
      profileImageUrl: user.profile_image_url,
      profileImagePositionX: user.profile_image_position_x,
      profileImagePositionY: user.profile_image_position_y,
      token,
    };
  }

  // Always resolves without error, even if the email doesn't exist, so
  // callers never leak which emails are registered on this tenant.
  static async requestPasswordReset(
    email: string,
    shop: ShopRecord,
  ): Promise<void> {
    const user = await UserRepository.findByEmail(
      shop.id,
      email.trim().toLowerCase(),
    );
    if (!user) return;

    const code = await PasswordResetRepository.createCode(shop.id, user.id);

    try {
      await MailService.send({
        to: user.email,
        subject: `${shop.name} password reset code`,
        text: `Your password reset code is ${code}. It expires in 15 minutes. If you did not request this, you can ignore this email.`,
        html: `<p>Your password reset code is <strong>${code}</strong>.</p><p>It expires in 15 minutes. If you did not request this, you can ignore this email.</p>`,
      });
    } catch (error) {
      // A mail failure must not change the response, or it would reveal
      // that this email belongs to a registered account.
      console.error("Failed to send password reset email:", error);
    }
  }

  static async verifyResetCode(
    email: string,
    code: string,
    shop: ShopRecord,
  ): Promise<string> {
    const user = await UserRepository.findByEmail(
      shop.id,
      email.trim().toLowerCase(),
    );
    if (!user) {
      throw new Error("Invalid or expired code.");
    }

    const resetToken = await PasswordResetRepository.verifyCode(
      shop.id,
      user.id,
      code.trim(),
    );
    if (!resetToken) {
      throw new Error("Invalid or expired code.");
    }

    return resetToken;
  }

  static async resetPassword(
    email: string,
    resetToken: string,
    newPassword: string,
    shop: ShopRecord,
  ): Promise<void> {
    const user = await UserRepository.findByEmail(
      shop.id,
      email.trim().toLowerCase(),
    );
    if (!user) {
      throw new Error("Invalid or expired reset session.");
    }

    const isValid = await PasswordResetRepository.consumeResetToken(
      shop.id,
      user.id,
      resetToken.trim(),
    );
    if (!isValid) {
      throw new Error("Invalid or expired reset session.");
    }

    const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    // Also stamps password_changed_at, which revokes every token issued before now.
    await UserRepository.updatePasswordHash(user.id, shop.id, passwordHash);
  }
}
