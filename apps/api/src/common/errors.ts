import { IllegalTransitionError } from "@tp/domain";
import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from "@nestjs/common";
import { ZodError } from "zod";

/** Domain error with a stable code + Farsi message (data-model doc §3.1 error format). */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly messageFa: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export const Errors = {
  unauthenticated: () => new ApiError(401, "UNAUTHENTICATED", "Authentication required", "ابتدا وارد شوید."),
  forbidden: (msg = "Not allowed") => new ApiError(403, "FORBIDDEN", msg, "دسترسی مجاز نیست."),
  notFound: (what = "Resource") => new ApiError(404, "NOT_FOUND", `${what} not found`, "مورد درخواستی یافت نشد."),
  validation: (details: Record<string, unknown>) =>
    new ApiError(400, "VALIDATION_ERROR", "Invalid request", "اطلاعات ارسالی معتبر نیست.", details),
};

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  catch(err: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse();
    const req = host.switchToHttp().getRequest();
    const requestId = req.id;
    let status = 500;
    let body: Record<string, unknown> = { code: "INTERNAL", message: "Internal error", message_fa: "خطای داخلی رخ داد." };

    if (err instanceof ApiError) {
      status = err.status;
      body = { code: err.code, message: err.message, message_fa: err.messageFa, details: err.details };
    } else if (err instanceof ZodError) {
      status = 400;
      body = {
        code: "VALIDATION_ERROR",
        message: "Invalid request",
        message_fa: "اطلاعات ارسالی معتبر نیست.",
        details: { issues: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })) },
      };
    } else if (err instanceof HttpException) {
      status = err.getStatus();
      body = { code: status === 404 ? "NOT_FOUND" : "HTTP_ERROR", message: err.message, message_fa: "درخواست قابل انجام نیست." };
    } else if (err instanceof IllegalTransitionError) {
      // An action not allowed in the current state (e.g. reviewing a case that was not submitted): a clear 409, not a 500.
      status = 409;
      body = { code: "WRONG_STATE", message: err.message, message_fa: "این کار در وضعیت فعلی ممکن نیست." };
    } else if (isPgError(err) && err.code === "23505") {
      status = 409;
      body = { code: "CONFLICT", message: "Duplicate value", message_fa: "این مورد قبلاً ثبت شده است.", details: { constraint: err.constraint } };
    } else if (isPgError(err) && err.code === "P0001" && /LEDGER_NEGATIVE_BALANCE/.test(String((err as any).message))) {
      // Last line of defence in the database: a posting would have taken an account below zero.
      status = 409;
      body = { code: "INSUFFICIENT_BALANCE", message: "Not enough balance", message_fa: "موجودی کافی نیست." };
    } else {
      // eslint-disable-next-line no-console
      if (process.env.APP_ENV !== "test" || process.env.DEBUG_500) console.error(`[${requestId}]`, err);
    }
    res.status(status).json({ error: { ...body, request_id: requestId } });
  }
}

function isPgError(e: unknown): e is { code: string; constraint?: string } {
  return typeof e === "object" && e !== null && typeof (e as any).code === "string" && /^[0-9A-Z]{5}$/.test((e as any).code);
}
