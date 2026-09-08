import { FillTimeoutError, OrderNotFilledError } from "./errors.js";
import type { Order } from "./types.js";

export interface WaitForFillOptions {
  readonly timeoutMs?: number;
  readonly pollIntervalMs?: number;
  readonly signal?: AbortSignal;
}

export type OrderWatcher = (id: string, signal: AbortSignal | undefined) => Promise<Order>;

function delay(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new Error("aborted"));
    });
  });
}

/**
 * An order as returned by `orders.create` / `positions.close`, with helpers to wait for the oracle
 * to settle it. The plain `Order` fields are available on `.order`.
 */
export class TrackedOrder {
  readonly order: Order;
  private readonly fetchOrder: OrderWatcher;

  constructor(order: Order, fetchOrder: OrderWatcher) {
    this.order = order;
    this.fetchOrder = fetchOrder;
  }

  get id(): string {
    return this.order.id;
  }

  get status(): Order["status"] {
    return this.order.status;
  }

  /** Re-fetches the order and returns a fresh tracked copy. */
  async refresh(signal?: AbortSignal): Promise<TrackedOrder> {
    return new TrackedOrder(await this.fetchOrder(this.order.id, signal), this.fetchOrder);
  }

  /**
   * Polls until the order reaches one of `statuses`, or throws `FillTimeoutError` at the deadline.
   * Use it to wait for a cancel (`["canceled", "timed_out"]`) or for a resting order to be placed.
   */
  async waitFor(
    statuses: readonly Order["status"][],
    options: WaitForFillOptions = {},
  ): Promise<Order> {
    const timeoutMs = options.timeoutMs ?? 90_000;
    const pollIntervalMs = options.pollIntervalMs ?? 1_000;
    const deadline = Date.now() + timeoutMs;
    let current = this.order;
    for (;;) {
      if (statuses.includes(current.status)) return current;
      if (Date.now() >= deadline) throw new FillTimeoutError(current.id, timeoutMs);
      await delay(Math.min(pollIntervalMs, Math.max(deadline - Date.now(), 0)), options.signal);
      current = await this.fetchOrder(current.id, options.signal);
    }
  }

  /**
   * Polls until the order is `filled`, or throws: `OrderNotFilledError` on `rejected`, `timed_out`
   * or `canceled`, `FillTimeoutError` when the client deadline elapses first. Resting limit and
   * stop orders stay `open` until triggered, so give them a deadline that matches your strategy.
   */
  async waitForFill(options: WaitForFillOptions = {}): Promise<Order> {
    const timeoutMs = options.timeoutMs ?? 90_000;
    const pollIntervalMs = options.pollIntervalMs ?? 1_000;
    const deadline = Date.now() + timeoutMs;
    let current = this.order;
    for (;;) {
      switch (current.status) {
        case "filled":
          return current;
        case "rejected":
        case "timed_out":
        case "canceled":
        case "expired":
          throw new OrderNotFilledError(current.id, current.status, current.reason);
        case "prepared":
        case "pending":
        case "open":
          break;
      }
      if (Date.now() >= deadline) throw new FillTimeoutError(current.id, timeoutMs);
      await delay(Math.min(pollIntervalMs, Math.max(deadline - Date.now(), 0)), options.signal);
      current = await this.fetchOrder(current.id, options.signal);
    }
  }
}
