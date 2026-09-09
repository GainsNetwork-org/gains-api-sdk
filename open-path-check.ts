// Proves the open path on production: a trader nobody granted anything registers an agent and gets
// back the delegation transaction. Two throwaway keys, generated here and never printed, never
// funded, and nothing is broadcast: registering an agent is a database write, not a transaction.
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const BASE = process.argv[2] ?? "https://api.halize.net";
const CHAIN = "arbitrum";
const DIAMOND = "0xFF162c694eAA571f685030649814282eA457f169";

const trader = privateKeyToAccount(generatePrivateKey());
const agent = privateKeyToAccount(generatePrivateKey());

const scope = {
  markets: ["BTC/USD"],
  maxLeverage: "5",
  dailySpendCapUsd: "100",
  expiresAt: null,
  permissions: "trade" as const,
};
const timestamp = Date.now();

const signature = await trader.signTypedData({
  domain: {
    name: "Gains Trading API",
    version: "1",
    chainId: 42161,
    verifyingContract: DIAMOND,
  },
  types: {
    AgentAuthorization: [
      { name: "agent", type: "address" },
      { name: "name", type: "string" },
      { name: "markets", type: "string" },
      { name: "maxLeverage", type: "string" },
      { name: "dailySpendCapUsd", type: "string" },
      { name: "expiresAt", type: "uint256" },
      { name: "permissions", type: "string" },
      { name: "timestamp", type: "uint256" },
    ],
  },
  primaryType: "AgentAuthorization",
  message: {
    agent: agent.address,
    name: "open-path-check",
    markets: scope.markets.join(","),
    maxLeverage: scope.maxLeverage,
    dailySpendCapUsd: scope.dailySpendCapUsd,
    expiresAt: 0n,
    permissions: scope.permissions,
    timestamp: BigInt(timestamp),
  },
});

const response = await fetch(`${BASE}/v1/${CHAIN}/agents`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ trader: trader.address, agent: agent.address, name: "open-path-check", scope, timestamp, signature }),
});

const body: unknown = await response.json();
console.log("status", response.status);
console.log(JSON.stringify(body, null, 2).slice(0, 700));
