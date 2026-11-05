import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  validateLoginRequest,
  validateRegisterRequest,
  validateResetPasswordRequest,
} from "../src/validators/auth.validator.ts";
import {
  IMAGE_DATA_URL_PATTERN,
  isCalendarDate,
  isClockTime,
} from "../src/utils/httpError.ts";

describe("validateRegisterRequest", () => {
  it("accepts a complete registration payload", () => {
    const result = validateRegisterRequest({
      fullName: "Ada Lovelace",
      email: "ada@example.com",
      password: "s3cret-pass",
      phoneNumber: "0712345678",
    });

    assert.equal(result.valid, true);
    assert.deepEqual(result.errors, []);
  });

  it("reports every missing field", () => {
    const result = validateRegisterRequest({});

    assert.equal(result.valid, false);
    assert.deepEqual(result.errors, [
      "fullName is required",
      "email is required",
      "password is required",
      "phoneNumber is required",
    ]);
  });

  it("rejects phone numbers that do not match the frontend format", () => {
    const result = validateRegisterRequest({
      fullName: "Ada Lovelace",
      email: "ada@example.com",
      password: "s3cret-pass",
      phoneNumber: "071234567",
    });

    assert.equal(result.valid, false);
    assert.deepEqual(result.errors, [
      "phoneNumber must contain 10 digits and start with 02, 03, or 07",
    ]);
  });
});

describe("validateLoginRequest", () => {
  it("accepts a complete login payload", () => {
    const result = validateLoginRequest({
      email: "ada@example.com",
      password: "s3cret-pass",
    });

    assert.equal(result.valid, true);
    assert.deepEqual(result.errors, []);
  });

  it("rejects a payload without credentials", () => {
    const result = validateLoginRequest({});

    assert.equal(result.valid, false);
    assert.ok(result.errors.length > 0);
  });
});

describe("password and email rules", () => {
  const base = {
    fullName: "Ada Lovelace",
    email: "ada@example.com",
    phoneNumber: "0712345678",
  };

  it("rejects passwords shorter than 8 characters", () => {
    const result = validateRegisterRequest({ ...base, password: "short1!" });
    assert.equal(result.valid, false);
    assert.deepEqual(result.errors, ["password must be at least 8 characters"]);
  });

  it("rejects passwords longer than bcrypt's 72-byte limit", () => {
    const result = validateRegisterRequest({ ...base, password: "a".repeat(73) });
    assert.equal(result.valid, false);
    assert.deepEqual(result.errors, ["password must be at most 72 characters"]);
  });

  it("rejects malformed email addresses", () => {
    const result = validateRegisterRequest({
      ...base,
      email: "not-an-email",
      password: "s3cret-pass",
    });
    assert.equal(result.valid, false);
    assert.deepEqual(result.errors, ["email must be a valid email address"]);
  });

  it("applies the same password rules to password resets", () => {
    const result = validateResetPasswordRequest({
      email: "ada@example.com",
      resetToken: "abc",
      newPassword: "short",
    });
    assert.equal(result.valid, false);
    assert.deepEqual(result.errors, ["newPassword must be at least 8 characters"]);
  });

  it("handles a missing request body", () => {
    assert.equal(validateLoginRequest(undefined).valid, false);
  });
});

describe("booking input helpers", () => {
  it("accepts real calendar dates only", () => {
    assert.equal(isCalendarDate("2026-02-28"), true);
    assert.equal(isCalendarDate("2026-02-30"), false);
    assert.equal(isCalendarDate("2026-2-3"), false);
  });

  it("accepts 24h clock times only", () => {
    assert.equal(isClockTime("09:30"), true);
    assert.equal(isClockTime("23:59:00"), true);
    assert.equal(isClockTime("24:00"), false);
    assert.equal(isClockTime("9:30"), false);
  });

  it("only allows raster image data URLs", () => {
    assert.equal(IMAGE_DATA_URL_PATTERN.test("data:image/png;base64,iVBORw0KGgo="), true);
    assert.equal(
      IMAGE_DATA_URL_PATTERN.test("data:image/svg+xml;base64,PHN2Zz48L3N2Zz4="),
      false,
    );
  });
});
