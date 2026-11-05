export interface RegisterRequest {
  fullName: string;
  email: string;
  password: string;
  phoneNumber: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface ForgotPasswordRequest {
  email: string;
}

export interface VerifyResetCodeRequest {
  email: string;
  code: string;
}

export interface ResetPasswordRequest {
  email: string;
  resetToken: string;
  newPassword: string;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const PASSWORD_MIN_LENGTH = 8;
// bcrypt silently ignores everything past 72 bytes.
export const PASSWORD_MAX_BYTES = 72;

function passwordError(password: string, field: string): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `${field} must be at least ${PASSWORD_MIN_LENGTH} characters`;
  }
  if (Buffer.byteLength(password, "utf8") > PASSWORD_MAX_BYTES) {
    return `${field} must be at most ${PASSWORD_MAX_BYTES} characters`;
  }
  return null;
}

export function validateRegisterRequest(data: any): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];
  data = data ?? {};

  if (!data.fullName || typeof data.fullName !== "string") {
    errors.push("fullName is required");
  } else if (!data.fullName.trim() || data.fullName.trim().length > 150) {
    errors.push("fullName must be between 1 and 150 characters");
  }
  if (!data.email || typeof data.email !== "string") {
    errors.push("email is required");
  } else if (
    data.email.trim().length > 254 ||
    !EMAIL_PATTERN.test(data.email.trim())
  ) {
    errors.push("email must be a valid email address");
  }
  if (!data.password || typeof data.password !== "string") {
    errors.push("password is required");
  } else {
    const error = passwordError(data.password, "password");
    if (error) errors.push(error);
  }
  if (!data.phoneNumber || typeof data.phoneNumber !== "string") {
    errors.push("phoneNumber is required");
  } else if (!/^0[237]\d{8}$/.test(data.phoneNumber)) {
    errors.push(
      "phoneNumber must contain 10 digits and start with 02, 03, or 07",
    );
  }
  return {
    valid: errors.length === 0,
    errors,
  };
}

export function validateLoginRequest(data: any): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];
  data = data ?? {};

  if (!data.email || typeof data.email !== "string") {
    errors.push("email is required");
  }
  if (!data.password || typeof data.password !== "string") {
    errors.push("password is required");
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

export function validateForgotPasswordRequest(data: any): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];
  data = data ?? {};

  if (!data.email || typeof data.email !== "string") {
    errors.push("email is required");
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

export function validateVerifyResetCodeRequest(data: any): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];
  data = data ?? {};

  if (!data.email || typeof data.email !== "string") {
    errors.push("email is required");
  }
  if (
    !data.code ||
    typeof data.code !== "string" ||
    !/^\d{6}$/.test(data.code)
  ) {
    errors.push("a valid 6-digit code is required");
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

export function validateResetPasswordRequest(data: any): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];
  data = data ?? {};

  if (!data.email || typeof data.email !== "string") {
    errors.push("email is required");
  }
  if (!data.resetToken || typeof data.resetToken !== "string") {
    errors.push("resetToken is required");
  }
  if (!data.newPassword || typeof data.newPassword !== "string") {
    errors.push(`newPassword must be at least ${PASSWORD_MIN_LENGTH} characters`);
  } else {
    const error = passwordError(data.newPassword, "newPassword");
    if (error) errors.push(error);
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
