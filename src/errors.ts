export const ERROR_CODES = [
  "VALIDATION_ERROR",
  "UNAUTHENTICATED",
  "INVALID_SIGNATURE",
  "TIMESTAMP_OUT_OF_WINDOW",
  "NONCE_REUSED",
  "AGENT_UNKNOWN",
  "API_KEY_UNKNOWN",
  "AGENT_NOT_DELEGATED",
  "AGENT_EXPIRED",
  "AGENT_REVOKED",
  "SCOPE_READ_ONLY",
  "SCOPE_MARKET_NOT_ALLOWED",
  "SCOPE_LEVERAGE_EXCEEDED",
  "SCOPE_SPEND_CAP_EXCEEDED",
  "TRADER_MISMATCH",
  "CHAIN_NOT_FOUND",
  "CHAIN_READ_ONLY",
  "MARKET_NOT_FOUND",
  "ORDER_NOT_FOUND",
  "POSITION_NOT_FOUND",
  "AGENT_NOT_FOUND",
  "IDEMPOTENCY_CONFLICT",
  "ORDER_NOT_MODIFIABLE",
  "PRECISION_ERROR",
  "LEVERAGE_OUT_OF_RANGE",
  "SIZE_BELOW_MINIMUM",
  "MARKET_CLOSED",
  "COLLATERAL_NOT_SUPPORTED",
  "SIMULATION_REVERTED",
  "SUBMISSION_MISMATCH",
  "UNSUPPORTED",
  "RATE_LIMITED",
  "INTERNAL",
  "UPSTREAM_UNAVAILABLE",
  "NOT_FOUND",
  "NOT_READY",
  "TOO_MANY_PREPARED_ORDERS",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

/**
 * Base class for every error the client raises. `code` is the stable machine-readable code from the
 * API error envelope (or a client-side code for transport failures), `status` the HTTP status.
 */
export class GainsApiError extends Error {
  readonly code: ErrorCode | "NETWORK_ERROR" | "TIMEOUT" | "UNEXPECTED_RESPONSE" | "NO_SENDER";
  readonly status: number;
  readonly details: Readonly<Record<string, unknown>> | undefined;
  readonly requestId: string | undefined;

  constructor(input: {
    readonly code: GainsApiError["code"];
    readonly status: number;
    readonly message: string;
    readonly details?: Readonly<Record<string, unknown>>;
    readonly requestId?: string;
  }) {
    super(input.message);
    this.name = "GainsApiError";
    this.code = input.code;
    this.status = input.status;
    this.details = input.details;
    this.requestId = input.requestId;
  }

  /** True when retrying the same request later can succeed (rate limit, not ready, upstream). */
  get retryable(): boolean {
    return (
      this.code === "RATE_LIMITED" ||
      this.code === "NOT_READY" ||
      this.code === "UPSTREAM_UNAVAILABLE" ||
      this.code === "NETWORK_ERROR" ||
      this.code === "TIMEOUT"
    );
  }
}

/** Raised by `waitForFill` when the order reaches a terminal state other than `filled`. */
export class OrderNotFilledError extends Error {
  readonly status: "rejected" | "timed_out" | "canceled" | "expired";
  readonly reason: string | null;
  readonly orderId: string;

  constructor(orderId: string, status: OrderNotFilledError["status"], reason: string | null) {
    super(`order ${orderId} ended ${status}${reason === null ? "" : ` (${reason})`}`);
    this.name = "OrderNotFilledError";
    this.orderId = orderId;
    this.status = status;
    this.reason = reason;
  }
}

/** Raised by `waitForFill` when the client-side deadline elapses while the order is still pending. */
export class FillTimeoutError extends Error {
  readonly orderId: string;

  constructor(orderId: string, timeoutMs: number) {
    super(`order ${orderId} still pending after ${String(timeoutMs)} ms`);
    this.name = "FillTimeoutError";
    this.orderId = orderId;
  }
}

/**
 * The order was broadcast but the API could not be told its hash. The position is opening on
 * chain: poll `GET /orders/{orderId}` or cancel it, do not re-send the order.
 */
export class OrderSubmitReportError extends Error {
  readonly orderId: string;
  readonly txHash: string;

  constructor(orderId: string, txHash: string, cause: unknown) {
    super(
      `order ${orderId} was broadcast as ${txHash} but reporting it to the API failed; poll or cancel it rather than re-sending`,
      { cause },
    );
    this.name = "OrderSubmitReportError";
    this.orderId = orderId;
    this.txHash = txHash;
  }
}
