import { describe, expect, it } from "vitest";
import { viemSender, type WalletClientLike } from "../src/sender.js";
import type { PreparedTransaction } from "../src/types.js";

const account = { address: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" } as const;
const hash = `0x${"ab".repeat(32)}` as const;

function transaction(overrides: Partial<PreparedTransaction> = {}): PreparedTransaction {
  return {
    to: "0xFF162c694eAA571f685030649814282eA457f169",
    data: "0x1234",
    value: "0",
    chainId: 42161,
    gas: null,
    expiresAt: Date.now() + 60_000,
    ...overrides,
  };
}

function wallet(chainId: number | undefined, sent: unknown[]): WalletClientLike {
  return {
    account,
    ...(chainId === undefined ? {} : { chain: { id: chainId } }),
    sendTransaction: (args) => {
      sent.push(args);
      return Promise.resolve(hash);
    },
  };
}

describe("viemSender", () => {
  it("broadcasts when the wallet is on the chain the transaction was prepared for", async () => {
    const sent: unknown[] = [];
    expect(await viemSender(wallet(42161, sent)).sendTransaction(transaction())).toBe(hash);
    expect(sent).toHaveLength(1);
  });

  // viem only asserts the chain when the client was created with one, so without this check a
  // wallet connected elsewhere signs and broadcasts this chain's calldata on that network.
  it("refuses to broadcast a transaction prepared for another chain", () => {
    const sent: unknown[] = [];
    const sender = viemSender(wallet(1, sent));
    expect(() => sender.sendTransaction(transaction())).toThrow(/chain 42161/);
    expect(sent).toHaveLength(0);
  });

  it("refuses to broadcast a transaction whose deadline has passed", () => {
    const sent: unknown[] = [];
    const sender = viemSender(wallet(42161, sent));
    expect(() => sender.sendTransaction(transaction({ expiresAt: Date.now() - 1 }))).toThrow(
      /expired/,
    );
    expect(sent).toHaveLength(0);
  });
});
