import { hashTypedData } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";
import { CHAINS } from "../src/client.js";
import { AgentSigner, agentAuthorizationTypedData, requestTypedData } from "../src/signing.js";

const account = privateKeyToAccount(
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
);

describe("request typed data parity with the API", () => {
  it("hashes the golden request exactly like the server", () => {
    const digest = hashTypedData(
      requestTypedData(
        CHAINS.arbitrum,
        {
          operationId: "createOrder",
          method: "POST",
          path: "/v1/arbitrum/orders?x=1",
          body: '{"market":"BTC/USD","size":"0.1"}',
        },
        1700000000000n,
        1700000000000001n,
      ),
    );
    expect(digest).toBe("0x61dfaa03e9cc0db4071308623b33593ae1643182149ec742e2549fe9fd804d4a");
  });

  it("hashes the golden agent authorisation exactly like the server", () => {
    const digest = hashTypedData(
      agentAuthorizationTypedData(CHAINS.arbitrum, {
        agent: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
        name: "bot",
        scope: {
          markets: ["BTC/USD", "ETH/USD"],
          maxLeverage: "20",
          dailySpendCapUsd: "1000",
          expiresAt: null,
          permissions: "trade",
        },
        timestamp: 1700000000000,
      }),
    );
    expect(digest).toBe("0x39c515ea9b58c9f56a101c82f6025b8395bde9e547229def730bf1a4ec680b97");
  });
});

describe("AgentSigner", () => {
  it("produces monotonic nonces and a recoverable signature", async () => {
    let now = 1700000000000;
    const signer = new AgentSigner({ chain: CHAINS.arbitrum, account, now: () => now });
    const first = await signer.sign({
      operationId: "getAccount",
      method: "GET",
      path: "/v1/arbitrum/account/0xabc",
      body: "",
    });
    const second = await signer.sign({
      operationId: "getAccount",
      method: "GET",
      path: "/v1/arbitrum/account/0xabc",
      body: "",
    });
    expect(second.nonce).toBeGreaterThan(first.nonce);
    expect(first.agent).toBe(account.address);
    expect(first.signature).toMatch(/^0x[0-9a-f]{130}$/);
    now += 5;
    const third = await signer.sign({
      operationId: "getAccount",
      method: "GET",
      path: "/v1/arbitrum/account/0xabc",
      body: "",
    });
    expect(third.nonce).toBe(1700000000005n * 1000n);
  });
});
