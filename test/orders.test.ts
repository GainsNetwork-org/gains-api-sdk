import { describe, expect, it } from "vitest";
import { FillTimeoutError, OrderNotFilledError } from "../src/errors.js";
import { TrackedOrder } from "../src/orders.js";
import type { Order } from "../src/types.js";

const base: Order = {
  id: "123",
  trader: "0x73b3A111C5BCCf9086c97B96e0AbAad69Dc4f523",
  market: "BTC/USD",
  side: "long",
  type: "market",
  size: "0.1",
  price: null,
  leverage: "10",
  collateral: "USDC",
  sl: null,
  tp: null,
  reduceOnly: false,
  slippage: "1",
  clientId: null,
  status: "pending",
  expiresAt: null,
  txHash: "0x01",
  fill: null,
  reason: null,
  createdAt: 0,
  updatedAt: 0,
};

describe("TrackedOrder.waitForFill", () => {
  it("resolves once the order is filled", async () => {
    const states: Order[] = [
      base,
      {
        ...base,
        status: "filled",
        fill: {
          price: "100",
          size: "0.1",
          collateral: "1",
          feeCollateral: "0.01",
          txHash: "0x02",
          timestamp: 1,
          positionId: "9",
        },
      },
    ];
    let calls = 0;
    const tracked = new TrackedOrder(base, () =>
      Promise.resolve(states[Math.min(calls++, states.length - 1)] ?? base),
    );
    const filled = await tracked.waitForFill({ pollIntervalMs: 1, timeoutMs: 1_000 });
    expect(filled.status).toBe("filled");
    expect(calls).toBe(2);
  });

  it("throws OrderNotFilledError on rejection with the reason", async () => {
    const tracked = new TrackedOrder(base, () =>
      Promise.resolve({ ...base, status: "rejected", reason: "SLIPPAGE" }),
    );
    await expect(tracked.waitForFill({ pollIntervalMs: 1 })).rejects.toBeInstanceOf(
      OrderNotFilledError,
    );
    await expect(tracked.waitForFill({ pollIntervalMs: 1 })).rejects.toMatchObject({
      status: "rejected",
      reason: "SLIPPAGE",
    });
  });

  it("throws FillTimeoutError when the deadline elapses", async () => {
    const tracked = new TrackedOrder(base, () => Promise.resolve(base));
    await expect(tracked.waitForFill({ pollIntervalMs: 1, timeoutMs: 5 })).rejects.toBeInstanceOf(
      FillTimeoutError,
    );
  });
});
