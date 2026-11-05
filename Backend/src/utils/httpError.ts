// An error whose message is safe to show to the client. Anything else that
// reaches the error handler is treated as internal and its message is hidden.
export class HttpError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;
export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const PHONE_PATTERN = /^0[237]\d{8}$/;
// Raster formats only: SVG data URLs can carry script.
export const IMAGE_DATA_URL_PATTERN =
  /^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+$/;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

export function isCalendarDate(value: unknown): value is string {
  if (typeof value !== "string" || !DATE_PATTERN.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}

export function isClockTime(value: unknown): value is string {
  return typeof value === "string" && TIME_PATTERN.test(value);
}

// For controller catch blocks: answers with a known HttpError, and rethrows
// anything else so the central error handler logs it and hides its message.
export function respondWithHttpError(
  res: { status(code: number): { json(body: unknown): any } },
  error: unknown,
) {
  if (error instanceof HttpError) {
    return res
      .status(error.status)
      .json({ success: false, message: error.message });
  }
  throw error;
}
