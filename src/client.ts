import type { Hex } from "viem";
import { GainsApiError } from "./errors.js";
import { Transport, type RequestOptions } from "./http.js";
import { TrackedOrder } from "./orders.js";
import {
  AgentSigner,
  agentAuthorizationTypedData,
  agentRevocationTypedData,
  apiKeyIssueTypedData,
  type RequestSigner,
  type SigningChain,
  type TypedDataSigner,
} from "./signing.js";
import type {
  Account,
  ChainInfo,
  Address,
  Agent,
  AgentScope,
  Candle,
  CandleInterval,
  ChainSlug,
  ClosePositionRequest,
  CreateOrderRequest,
  FillHistoryEntry,
  Market,
  Order,
  OrderBook,
  Page,
  Position,
  PreparedOrder,
  PreparedPosition,
  Price,
  RecentTrade,
  TransactionRequest,
  UpdateOrderRequest,
  UpdatePositionRequest,
} from "./types.js";
import type { TransactionSender } from "./sender.js";
import { GainsWebSocket, type GainsWebSocketOptions } from "./ws.js";

export const CHAINS: Readonly<Record<ChainSlug, SigningChain>> = {
  arbitrum: { chainId: 42161, diamond: "0xFF162c694eAA571f685030649814282eA457f169" },
  base: { chainId: 8453, diamond: "0x6cD5aC19a07518A8092eEFfDA4f1174C72704eeb" },
  polygon: { chainId: 137, diamond: "0x209A9A01980377916851af2cA075C2b170452018" },
  megaeth: { chainId: 4326, diamond: "0x2D5B1ba6E2093a5b927Fe5bF8C049B107de31eaF" },
  "arbitrum-sepolia": { chainId: 421614, diamond: "0xd659a15812064C79E189fd950A189b15c75d3186" },
};

export const MAINNET_URL = "https://api.gains.trade";
export const TESTNET_URL = "https://api-testnet.gains.trade";

export interface GainsClientOptions {
  /** Chain served by this client. Every request is scoped to it. */
  readonly chain: ChainSlug;
  /** Base URL of the API. Defaults to mainnet, or testnet for `arbitrum-sepolia`. */
  readonly baseUrl?: string;
  /**
   * EIP-712 signing domain (chain id + Diamond). Defaults to the public deployment in `CHAINS`
   * when `baseUrl` is not set; otherwise it is read once from `GET /v1/{chain}`, so a client
   * pointed at a staging or preview deployment signs for that deployment's Diamond.
   */
  readonly signingChain?: SigningChain;
  /** Agent key used to sign private requests. Omit for public market data only. */
  readonly agent?: TypedDataSigner;
  /** Custom signer, when the agent key lives elsewhere (KMS, hardware). Takes precedence over `agent`. */
  readonly signer?: RequestSigner;
  /** Read-only API key for private reads without signing. */
  readonly apiKey?: string;
  /**
   * Signs and broadcasts the prepared transactions (`viemSender(walletClient)` for the agent
   * account). Without it, `orders.create` and the other writes throw `NO_SENDER`; the
   * `prepare*` methods still return the transaction for a custom signer.
   */
  readonly sender?: TransactionSender;
  readonly fetch?: typeof fetch;
  readonly timeoutMs?: number;
  readonly maxRetries?: number;
  readonly userAgent?: string;
}

export interface MarketSymbolLike {
  readonly symbol: string;
}

function symbolPath(market: string | MarketSymbolLike): string {
  const symbol = typeof market === "string" ? market : market.symbol;
  return encodeURIComponent(symbol);
}

/**
 * Entry point of the SDK. One client per chain. Public market data needs no credentials; private
 * reads accept an API key or an agent signer; writes need an agent signer.
 */
export class GainsClient {
  readonly chain: ChainSlug;
  readonly baseUrl: string;
  readonly markets: MarketsApi;
  readonly account: AccountApi;
  readonly orders: OrdersApi;
  readonly positions: PositionsApi;
  readonly agents: AgentsApi;
  private readonly transport: Transport;
  private signingChainPromise: Promise<SigningChain> | undefined;

  constructor(options: GainsClientOptions) {
    this.chain = options.chain;
    this.baseUrl =
      options.baseUrl ?? (options.chain === "arbitrum-sepolia" ? TESTNET_URL : MAINNET_URL);
    const known =
      options.signingChain ?? (options.baseUrl === undefined ? CHAINS[options.chain] : undefined);
    if (known !== undefined) this.signingChainPromise = Promise.resolve(known);
    const resolveChain = (): Promise<SigningChain> => this.signingChain();
    const signer =
      options.signer ??
      (options.agent === undefined
        ? undefined
        : new AgentSigner({ chain: resolveChain, account: options.agent }));
    this.transport = new Transport({
      baseUrl: this.baseUrl,
      chain: options.chain,
      timeoutMs: options.timeoutMs ?? 30_000,
      maxRetries: options.maxRetries ?? 2,
      ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
      ...(signer === undefined ? {} : { signer }),
      ...(options.apiKey === undefined ? {} : { apiKey: options.apiKey }),
      ...(options.userAgent === undefined ? {} : { userAgent: options.userAgent }),
    });
    this.markets = new MarketsApi(this.transport);
    this.account = new AccountApi(this.transport);
    this.orders = new OrdersApi(this.transport, options.sender);
    this.positions = new PositionsApi(this.transport, this.orders, options.sender);
    this.agents = new AgentsApi(this.transport, resolveChain);
  }

  /** The EIP-712 signing domain of this deployment, read once from `GET /v1/{chain}` when not known. */
  signingChain(): Promise<SigningChain> {
    this.signingChainPromise ??= this.fetchSigningChain();
    return this.signingChainPromise;
  }

  private async fetchSigningChain(): Promise<SigningChain> {
    const info = await this.transport.request<ChainInfo>({
      operationId: "getChainInfo",
      method: "GET",
      path: this.transport.chainPath(""),
      auth: "public",
    });
    if (!/^0x[0-9a-fA-F]{40}$/.test(info.diamond)) {
      throw new GainsApiError({
        code: "INTERNAL",
        status: 0,
        message: `chain info returned a malformed diamond address: ${info.diamond}`,
      });
    }
    return { chainId: info.chainId, diamond: `0x${info.diamond.slice(2)}` };
  }

  /** The agent address requests are signed with, if any. */
  get agentAddress(): Address | undefined {
    return this.transport.signer?.address;
  }

  /** Opens a WebSocket for this chain. Private channels reuse the client's signer or API key. */
  websocket(
    options: Omit<GainsWebSocketOptions, "url" | "chain" | "signer" | "apiKey"> = {},
  ): GainsWebSocket {
    const url = `${this.baseUrl.replace(/^http/, "ws")}/v1/${this.chain}/ws`;
    return new GainsWebSocket({
      url,
      chain: this.chain,
      ...(this.transport.signer === undefined ? {} : { signer: this.transport.signer }),
      ...options,
    });
  }
}

export class MarketsApi {
  constructor(private readonly transport: Transport) {}

  async list(options?: RequestOptions): Promise<readonly Market[]> {
    const page = await this.transport.request<{ data: Market[] }>({
      operationId: "listMarkets",
      method: "GET",
      path: this.transport.chainPath("/markets"),
      auth: "public",
      ...(options === undefined ? {} : { options }),
    });
    return page.data;
  }

  get(market: string | MarketSymbolLike, options?: RequestOptions): Promise<Market> {
    return this.transport.request<Market>({
      operationId: "getMarket",
      method: "GET",
      path: this.transport.chainPath(`/markets/${symbolPath(market)}`),
      auth: "public",
      ...(options === undefined ? {} : { options }),
    });
  }

  book(
    market: string | MarketSymbolLike,
    levels = 20,
    options?: RequestOptions,
  ): Promise<OrderBook> {
    return this.transport.request<OrderBook>({
      operationId: "getOrderBook",
      method: "GET",
      path: this.transport.chainPath(`/markets/${symbolPath(market)}/book`),
      query: { levels },
      auth: "public",
      ...(options === undefined ? {} : { options }),
    });
  }

  async candles(
    market: string | MarketSymbolLike,
    params: { interval: CandleInterval; from: number; to: number },
    options?: RequestOptions,
  ): Promise<readonly Candle[]> {
    const page = await this.transport.request<{ data: Candle[] }>({
      operationId: "getCandles",
      method: "GET",
      path: this.transport.chainPath(`/markets/${symbolPath(market)}/candles`),
      query: { ...params },
      auth: "public",
      ...(options === undefined ? {} : { options }),
    });
    return page.data;
  }

  async trades(
    market: string | MarketSymbolLike,
    limit = 100,
    options?: RequestOptions,
  ): Promise<readonly RecentTrade[]> {
    const page = await this.transport.request<{ data: RecentTrade[] }>({
      operationId: "getRecentTrades",
      method: "GET",
      path: this.transport.chainPath(`/markets/${symbolPath(market)}/trades`),
      query: { limit },
      auth: "public",
      ...(options === undefined ? {} : { options }),
    });
    return page.data;
  }

  funding(
    market: string | MarketSymbolLike,
    options?: RequestOptions,
  ): Promise<Market["funding"] & { market: string }> {
    return this.transport.request<Market["funding"] & { market: string }>({
      operationId: "getFunding",
      method: "GET",
      path: this.transport.chainPath(`/markets/${symbolPath(market)}/funding`),
      auth: "public",
      ...(options === undefined ? {} : { options }),
    });
  }

  async prices(options?: RequestOptions): Promise<readonly Price[]> {
    const page = await this.transport.request<{ data: Price[] }>({
      operationId: "getPrices",
      method: "GET",
      path: this.transport.chainPath("/prices"),
      auth: "public",
      ...(options === undefined ? {} : { options }),
    });
    return page.data;
  }
}

export class AccountApi {
  constructor(private readonly transport: Transport) {}

  get(address: Address, options?: RequestOptions): Promise<Account> {
    return this.transport.request<Account>({
      operationId: "getAccount",
      method: "GET",
      path: this.transport.chainPath(`/account/${address}`),
      auth: "read",
      ...(options === undefined ? {} : { options }),
    });
  }

  async positions(address: Address, options?: RequestOptions): Promise<readonly Position[]> {
    const page = await this.transport.request<{ data: Position[] }>({
      operationId: "listPositions",
      method: "GET",
      path: this.transport.chainPath(`/account/${address}/positions`),
      auth: "read",
      ...(options === undefined ? {} : { options }),
    });
    return page.data;
  }

  async openOrders(address: Address, options?: RequestOptions): Promise<readonly Order[]> {
    const page = await this.transport.request<{ data: Order[] }>({
      operationId: "listOpenOrders",
      method: "GET",
      path: this.transport.chainPath(`/account/${address}/orders`),
      auth: "read",
      ...(options === undefined ? {} : { options }),
    });
    return page.data;
  }

  orderHistory(
    address: Address,
    params: { cursor?: string; limit?: number } = {},
    options?: RequestOptions,
  ): Promise<Page<Order>> {
    return this.transport.request<Page<Order>>({
      operationId: "listOrderHistory",
      method: "GET",
      path: this.transport.chainPath(`/account/${address}/orders/history`),
      query: { ...params },
      auth: "read",
      ...(options === undefined ? {} : { options }),
    });
  }

  fills(
    address: Address,
    params: { cursor?: string; limit?: number } = {},
    options?: RequestOptions,
  ): Promise<Page<FillHistoryEntry>> {
    return this.transport.request<Page<FillHistoryEntry>>({
      operationId: "listFills",
      method: "GET",
      path: this.transport.chainPath(`/account/${address}/fills`),
      query: { ...params },
      auth: "read",
      ...(options === undefined ? {} : { options }),
    });
  }

  /** Iterates every fill, newest first, following cursors until the history is exhausted. */
  async *allFills(
    address: Address,
    pageSize = 100,
    options?: RequestOptions,
  ): AsyncGenerator<FillHistoryEntry> {
    let cursor: string | undefined;
    do {
      const page: Page<FillHistoryEntry> = await this.fills(
        address,
        { limit: pageSize, ...(cursor === undefined ? {} : { cursor }) },
        options,
      );
      for (const fill of page.data) yield fill;
      cursor = page.nextCursor ?? undefined;
    } while (cursor !== undefined);
  }
}

/** The result of a write that may have reached the chain: the broadcast hash, if any, and the resource. */
export interface Broadcast<T> {
  readonly txHash: Hex | null;
  readonly result: T;
}

function noSender(): GainsApiError {
  return new GainsApiError({
    code: "NO_SENDER",
    status: 0,
    message:
      "this call signs and broadcasts a transaction; pass `sender` to GainsClient (viemSender(walletClient)) or use the prepare* method with your own signer",
  });
}

export class OrdersApi {
  constructor(
    private readonly transport: Transport,
    private readonly sender: TransactionSender | undefined,
  ) {}

  private readonly fetchOrder = (id: string, signal: AbortSignal | undefined): Promise<Order> =>
    this.get(id, signal === undefined ? undefined : { signal });

  get(id: string, options?: RequestOptions): Promise<Order> {
    return this.transport.request<Order>({
      operationId: "getOrder",
      method: "GET",
      path: this.transport.chainPath(`/orders/${id}`),
      auth: "read",
      ...(options === undefined ? {} : { options }),
    });
  }

  /**
   * Validates the order and returns it in `prepared` state with the transaction the agent must
   * sign and broadcast. Use `create` for the whole flow, or this plus `submit` with a custom signer.
   */
  prepare(request: CreateOrderRequest, options?: RequestOptions): Promise<PreparedOrder> {
    return this.transport.request<PreparedOrder>({
      operationId: "createOrder",
      method: "POST",
      path: this.transport.chainPath("/orders"),
      body: request,
      auth: "trade",
      ...(options === undefined ? {} : { options }),
    });
  }

  /** Reports the hash of a broadcast prepared transaction; the order moves to `pending` or `open` once mined. */
  submit(id: string, txHash: Hex, options?: RequestOptions): Promise<Order> {
    return this.transport.request<Order>({
      operationId: "submitOrder",
      method: "POST",
      path: this.transport.chainPath(`/orders/${id}/submit`),
      body: { txHash },
      auth: "trade",
      ...(options === undefined ? {} : { options }),
    });
  }

  /**
   * Prepares, signs, broadcasts and submits an order with the client's `sender`. Market orders
   * come back `pending`; call `.waitForFill()` to block until the oracle settles them.
   */
  async create(request: CreateOrderRequest, options?: RequestOptions): Promise<TrackedOrder> {
    const sender = this.sender;
    if (sender === undefined) throw noSender();
    const prepared = await this.prepare(request, options);
    if (prepared.transaction === null) return this.track(prepared.order);
    const txHash = await sender.sendTransaction(prepared.transaction);
    return this.track(await this.submit(prepared.order.id, txHash, options));
  }

  prepareUpdate(
    id: string,
    patch: UpdateOrderRequest,
    options?: RequestOptions,
  ): Promise<PreparedOrder> {
    return this.transport.request<PreparedOrder>({
      operationId: "updateOrder",
      method: "PATCH",
      path: this.transport.chainPath(`/orders/${id}`),
      body: patch,
      auth: "trade",
      ...(options === undefined ? {} : { options }),
    });
  }

  /** Updates a resting order (price, sl, tp, slippage) and broadcasts the transaction. */
  async update(
    id: string,
    patch: UpdateOrderRequest,
    options?: RequestOptions,
  ): Promise<Broadcast<TrackedOrder>> {
    return this.broadcast(await this.prepareUpdate(id, patch, options));
  }

  prepareCancel(id: string, options?: RequestOptions): Promise<PreparedOrder> {
    return this.transport.request<PreparedOrder>({
      operationId: "cancelOrder",
      method: "DELETE",
      path: this.transport.chainPath(`/orders/${id}`),
      auth: "trade",
      ...(options === undefined ? {} : { options }),
    });
  }

  /**
   * Cancels a resting order or reclaims a timed-out request, broadcasting the transaction. A
   * prepared order that was never broadcast is expired without one (`txHash` null).
   */
  async cancel(id: string, options?: RequestOptions): Promise<Broadcast<TrackedOrder>> {
    return this.broadcast(await this.prepareCancel(id, options));
  }

  track(order: Order): TrackedOrder {
    return new TrackedOrder(order, this.fetchOrder);
  }

  private async broadcast(prepared: PreparedOrder): Promise<Broadcast<TrackedOrder>> {
    if (prepared.transaction === null) return { txHash: null, result: this.track(prepared.order) };
    const sender = this.sender;
    if (sender === undefined) throw noSender();
    const txHash = await sender.sendTransaction(prepared.transaction);
    return { txHash, result: this.track(prepared.order) };
  }
}

export class PositionsApi {
  constructor(
    private readonly transport: Transport,
    private readonly orders: OrdersApi,
    private readonly sender: TransactionSender | undefined,
  ) {}

  prepareClose(
    id: string,
    request: ClosePositionRequest = {},
    options?: RequestOptions,
  ): Promise<PreparedOrder> {
    return this.transport.request<PreparedOrder>({
      operationId: "closePosition",
      method: "POST",
      path: this.transport.chainPath(`/positions/${id}/close`),
      body: request,
      auth: "trade",
      ...(options === undefined ? {} : { options }),
    });
  }

  /** Closes a position at market: prepares, broadcasts and submits. `pending` until the oracle fills it. */
  async close(
    id: string,
    request: ClosePositionRequest = {},
    options?: RequestOptions,
  ): Promise<TrackedOrder> {
    const sender = this.sender;
    if (sender === undefined) throw noSender();
    const prepared = await this.prepareClose(id, request, options);
    if (prepared.transaction === null) return this.orders.track(prepared.order);
    const txHash = await sender.sendTransaction(prepared.transaction);
    return this.orders.track(await this.orders.submit(prepared.order.id, txHash, options));
  }

  prepareUpdate(
    id: string,
    patch: UpdatePositionRequest,
    options?: RequestOptions,
  ): Promise<PreparedPosition> {
    return this.transport.request<PreparedPosition>({
      operationId: "updatePosition",
      method: "PATCH",
      path: this.transport.chainPath(`/positions/${id}`),
      body: patch,
      auth: "trade",
      ...(options === undefined ? {} : { options }),
    });
  }

  /** Updates sl, tp, leverage or collateral and broadcasts the transaction; re-read the position once mined. */
  async update(
    id: string,
    patch: UpdatePositionRequest,
    options?: RequestOptions,
  ): Promise<Broadcast<Position>> {
    const sender = this.sender;
    if (sender === undefined) throw noSender();
    const prepared = await this.prepareUpdate(id, patch, options);
    const txHash = await sender.sendTransaction(prepared.transaction);
    return { txHash, result: prepared.position };
  }
}

export interface AuthorizeAgentInput {
  readonly agent: Address;
  readonly name?: string;
  readonly scope: AgentScope;
}

export class AgentsApi {
  constructor(
    private readonly transport: Transport,
    private readonly chain: () => Promise<SigningChain>,
  ) {}

  /**
   * Registers an agent and its scope, signed by the trader's master wallet. Returns the
   * `setTradingDelegate` transaction the master wallet must send before the agent is `active`.
   */
  async authorize(
    master: TypedDataSigner,
    input: AuthorizeAgentInput,
    options?: RequestOptions,
  ): Promise<{ agent: Agent; delegationTx: TransactionRequest }> {
    const timestamp = Date.now();
    const signature = await master.signTypedData(
      agentAuthorizationTypedData(await this.chain(), {
        agent: input.agent,
        name: input.name ?? null,
        scope: input.scope,
        timestamp,
      }),
    );
    return this.transport.request<{ agent: Agent; delegationTx: TransactionRequest }>({
      operationId: "createAgent",
      method: "POST",
      path: this.transport.chainPath("/agents"),
      body: {
        trader: master.address,
        agent: input.agent,
        ...(input.name === undefined ? {} : { name: input.name }),
        scope: input.scope,
        timestamp,
        signature,
      },
      auth: "public",
      ...(options === undefined ? {} : { options }),
    });
  }

  get(
    agent: Address,
    options?: RequestOptions,
  ): Promise<{ agent: Agent; delegationTx: TransactionRequest }> {
    return this.transport.request<{ agent: Agent; delegationTx: TransactionRequest }>({
      operationId: "getAgent",
      method: "GET",
      path: this.transport.chainPath(`/agents/${agent}`),
      auth: "public",
      ...(options === undefined ? {} : { options }),
    });
  }

  /** Revokes an agent in the API and returns the `removeTradingDelegate` transaction for the master wallet. */
  async revoke(
    master: TypedDataSigner,
    agent: Address,
    options?: RequestOptions,
  ): Promise<{ revocationTx: TransactionRequest }> {
    const timestamp = Date.now();
    const signature = await master.signTypedData(
      agentRevocationTypedData(await this.chain(), agent, timestamp),
    );
    return this.transport.request<{ revocationTx: TransactionRequest }>({
      operationId: "revokeAgent",
      method: "DELETE",
      path: this.transport.chainPath(`/agents/${agent}`),
      body: { trader: master.address, timestamp, signature },
      auth: "public",
      ...(options === undefined ? {} : { options }),
    });
  }

  /** Issues a read-only API key for the master wallet's account. The key is returned once. */
  async issueApiKey(
    master: TypedDataSigner,
    label: string,
    options?: RequestOptions,
  ): Promise<{ apiKey: string; label: string; trader: Address }> {
    const timestamp = Date.now();
    const signature: Hex = await master.signTypedData(
      apiKeyIssueTypedData(await this.chain(), label, timestamp),
    );
    return this.transport.request<{ apiKey: string; label: string; trader: Address }>({
      operationId: "issueApiKey",
      method: "POST",
      path: this.transport.chainPath("/api-keys"),
      body: { trader: master.address, label, timestamp, signature },
      auth: "public",
      ...(options === undefined ? {} : { options }),
    });
  }
}

export { GainsApiError };
