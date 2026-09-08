import { keccak256, stringToBytes, type Hex, type TypedDataDomain } from "viem";
import type { Address } from "./types.js";

export const REQUEST_DOMAIN_NAME = "Gains Trading API";
export const REQUEST_DOMAIN_VERSION = "1";

export const REQUEST_FIELDS = [
  { name: "method", type: "string" },
  { name: "path", type: "string" },
  { name: "bodyHash", type: "bytes32" },
  { name: "timestamp", type: "uint256" },
  { name: "nonce", type: "uint256" },
] as const;

/** The chain a signer is bound to: EVM chain id plus the Gains Diamond, which is the EIP-712 verifying contract. */
export interface SigningChain {
  readonly chainId: number;
  readonly diamond: Address;
}

export const AGENT_AUTHORIZATION_FIELDS = [
  { name: "agent", type: "address" },
  { name: "name", type: "string" },
  { name: "markets", type: "string" },
  { name: "maxLeverage", type: "string" },
  { name: "dailySpendCapUsd", type: "string" },
  { name: "expiresAt", type: "uint256" },
  { name: "permissions", type: "string" },
  { name: "timestamp", type: "uint256" },
] as const;

export const AGENT_REVOCATION_FIELDS = [
  { name: "agent", type: "address" },
  { name: "timestamp", type: "uint256" },
] as const;

export const API_KEY_ISSUE_FIELDS = [
  { name: "label", type: "string" },
  { name: "timestamp", type: "uint256" },
] as const;

/** Minimal signer contract: anything that can sign EIP-712 typed data for one address. */
export interface TypedDataSigner {
  readonly address: Address;
  signTypedData(typedData: {
    readonly domain: TypedDataDomain;
    readonly types: Record<string, readonly { readonly name: string; readonly type: string }[]>;
    readonly primaryType: string;
    readonly message: Record<string, string | bigint | boolean>;
  }): Promise<Hex>;
}

export interface UnsignedRequest {
  readonly operationId: string;
  readonly method: string;
  readonly path: string;
  readonly body: string;
}

export interface SignedRequest {
  readonly agent: Address;
  readonly timestamp: bigint;
  readonly nonce: bigint;
  readonly signature: Hex;
}

export interface RequestSigner {
  readonly address: Address;
  sign(request: UnsignedRequest): Promise<SignedRequest>;
}

export function requestDomain(chain: SigningChain): TypedDataDomain {
  return {
    name: REQUEST_DOMAIN_NAME,
    version: REQUEST_DOMAIN_VERSION,
    chainId: chain.chainId,
    verifyingContract: chain.diamond,
  };
}

/** keccak256 of the exact request body bytes. An empty body hashes the empty string. */
export function bodyHashOf(rawBody: string): Hex {
  return keccak256(stringToBytes(rawBody));
}

/**
 * Builds the exact EIP-712 payload the API verifies: one domain per chain (chain id + Diamond
 * address), the primary type named after the operation, and the request bound by method, path
 * (with query string), the hash of the body bytes, timestamp and nonce.
 */
export function requestTypedData(
  chain: SigningChain,
  request: UnsignedRequest,
  timestamp: bigint,
  nonce: bigint,
) {
  return {
    domain: requestDomain(chain),
    types: { [request.operationId]: REQUEST_FIELDS },
    primaryType: request.operationId,
    message: {
      method: request.method,
      path: request.path,
      bodyHash: bodyHashOf(request.body),
      timestamp,
      nonce,
    },
  } as const;
}

export type SigningChainSource = SigningChain | (() => Promise<SigningChain>);

export interface AgentSignerOptions {
  /** The signing domain, or a function that resolves it (for example from `GET /v1/{chain}`). */
  readonly chain: SigningChainSource;
  readonly account: TypedDataSigner;
  readonly now?: () => number;
}

/**
 * Signs API requests with an agent key. Nonces are millisecond timestamps with a per-process
 * counter so concurrent requests never collide within the replay window.
 */
export class AgentSigner implements RequestSigner {
  readonly address: Address;
  private readonly chain: SigningChainSource;
  private readonly account: TypedDataSigner;
  private readonly now: () => number;
  private lastNonce = 0n;

  constructor(options: AgentSignerOptions) {
    this.chain = options.chain;
    this.account = options.account;
    this.address = options.account.address;
    this.now = options.now ?? (() => Date.now());
  }

  private nextNonce(): bigint {
    const candidate = BigInt(this.now()) * 1000n;
    this.lastNonce = candidate > this.lastNonce ? candidate : this.lastNonce + 1n;
    return this.lastNonce;
  }

  async sign(request: UnsignedRequest): Promise<SignedRequest> {
    const timestamp = BigInt(this.now());
    const nonce = this.nextNonce();
    const chain = typeof this.chain === "function" ? await this.chain() : this.chain;
    const signature = await this.account.signTypedData(
      requestTypedData(chain, request, timestamp, nonce),
    );
    return { agent: this.address, timestamp, nonce, signature };
  }
}

export interface AgentAuthorizationInput {
  readonly agent: Address;
  readonly name: string | null;
  readonly scope: {
    readonly markets: readonly string[] | "all";
    readonly maxLeverage: string | null;
    readonly dailySpendCapUsd: string | null;
    readonly expiresAt: number | null;
    readonly permissions: "trade" | "read";
  };
  readonly timestamp: number;
}

export function agentAuthorizationTypedData(chain: SigningChain, input: AgentAuthorizationInput) {
  return {
    domain: requestDomain(chain),
    types: { AgentAuthorization: AGENT_AUTHORIZATION_FIELDS },
    primaryType: "AgentAuthorization",
    message: {
      agent: input.agent,
      name: input.name ?? "",
      markets: input.scope.markets === "all" ? "*" : input.scope.markets.join(","),
      maxLeverage: input.scope.maxLeverage ?? "",
      dailySpendCapUsd: input.scope.dailySpendCapUsd ?? "",
      expiresAt: BigInt(input.scope.expiresAt ?? 0),
      permissions: input.scope.permissions,
      timestamp: BigInt(input.timestamp),
    },
  } as const;
}

export function agentRevocationTypedData(chain: SigningChain, agent: Address, timestamp: number) {
  return {
    domain: requestDomain(chain),
    types: { AgentRevocation: AGENT_REVOCATION_FIELDS },
    primaryType: "AgentRevocation",
    message: { agent, timestamp: BigInt(timestamp) },
  } as const;
}

export function apiKeyIssueTypedData(chain: SigningChain, label: string, timestamp: number) {
  return {
    domain: requestDomain(chain),
    types: { ApiKeyIssue: API_KEY_ISSUE_FIELDS },
    primaryType: "ApiKeyIssue",
    message: { label, timestamp: BigInt(timestamp) },
  } as const;
}
