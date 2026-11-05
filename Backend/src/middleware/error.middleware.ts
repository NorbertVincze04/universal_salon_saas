import type { NextFunction, Request, Response } from "express";
import { HttpError } from "../utils/httpError.ts";

// Postgres errors caused by bad client input rather than a server fault.
const CLIENT_INPUT_PG_CODES = new Set([
  "22P02", // invalid_text_representation (e.g. malformed uuid)
  "22007", // invalid_datetime_format
  "22008", // datetime_field_overflow
  "22003", // numeric_value_out_of_range
  "22001", // string_data_right_truncation
  "23514", // check_violation
]);

export function errorHandler(
  err: any,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err instanceof HttpError) {
    res.status(err.status).json({ success: false, message: err.message });
    return;
  }

  // Body parser errors (malformed JSON, payload too large) carry a 4xx status.
  if (err?.type && typeof err.status === "number" && err.status < 500) {
    res.status(err.status).json({
      success: false,
      message:
        err.status === 413 ? "Request is too large." : "Invalid request body.",
    });
    return;
  }

  if (typeof err?.code === "string" && CLIENT_INPUT_PG_CODES.has(err.code)) {
    res.status(400).json({ success: false, message: "Invalid request data." });
    return;
  }

  if (err?.code === "23P01") {
    res
      .status(409)
      .json({ success: false, message: "This time is no longer available." });
    return;
  }

  console.error("Error:", err);
  // Never echo internal error messages (SQL, stack details) to the client.
  res.status(500).json({ success: false, message: "Internal server error" });
}
