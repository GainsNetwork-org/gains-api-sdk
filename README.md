# @gainsnetwork/api

TypeScript client for the Gains Network trading API. Types are generated from the API's OpenAPI
contract; on top sits a small ergonomic layer: EIP-712 request signing with an agent key,
`orders.create(...)` returning an order you can `waitForFill()`, cursor helpers, and a WebSocket
client that survives reconnects.

## Install

```
npm install @gainsnetwork/api viem
```

Node 20 or newer. On Node 20 pass a WebSocket implementation (`ws`) to `client.websocket()`.

## Quick start

The agent signs API requests **and** broadcasts the transactions the API prepares, so it needs a
wallet client and a little native currency for gas. Nothing is sponsored on this path.

```ts
import { GainsClient, viemSender } from "@gainsnetwork/api";
import { createWalletClient, defineChain, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const agent = privateKeyToAccount(process.env.GAINS_AGENT_KEY as `0x${string}`);
const chain = await new GainsClient({ chain: "arbitrum-sepolia" }).signingChain();
const wallet = createWalletClient({
  account: agent,
  chain: defineChain({
    id: chain.chainId,
    name: "gains",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [process.env.RPC_URL!] } },
  }),
  transport: http(process.env.RPC_URL!),
});

const client = new GainsClient({
  chain: "arbitrum-sepolia",
  agent,
  sender: viemSender(wallet),
});

const markets = await client.markets.list();
const btc = markets.find((m) => m.symbol === "BTC/USD")!;

const order = await client.orders.create({
  market: btc.symbol,
  side: "long",
  type: "market",
  size: "0.01",
  leverage: "10",
  collateral: "USDC",
  slippage: "1",
  reduceOnly: false,
});

const filled = await order.waitForFill({ timeoutMs: 90_000 });
console.log(filled.fill?.price, filled.fill?.positionId);
```

The agent key never leaves your process. It must be authorised once by the trader's wallet:

```ts
const { delegationTx } = await client.agents.authorize(masterWallet, {
  agent: agent.address,
  name: "my-bot",
  scope: { markets: "all", maxLeverage: "20", dailySpendCapUsd: "5000", expiresAt: null, permissions: "trade" },
});
await masterWallet.sendTransaction({ to: delegationTx.to, data: delegationTx.data, chainId: delegationTx.chainId });
```

## Streaming

```ts
const ws = client.websocket();
await ws.subscribe({ channel: "book", market: "BTC/USD" });
await ws.subscribe({ channel: "orders" });
for await (const message of ws.messages("orders")) {
  console.log(message.data);
}
```

## Errors

Every failure is a `GainsApiError` with the API's stable `code`, the HTTP `status` and `details`.
`waitForFill` throws `OrderNotFilledError` (rejected, timed out, canceled) or `FillTimeoutError`.

## Regenerating the types

```
npm run generate
```

reads `apps/trading-api/openapi/gains-trading-api.v1.json` and rewrites `src/generated/schema.ts`.
