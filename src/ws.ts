import { GainsApiError } from "./errors.js";
import type { RequestSigner } from "./signing.js";
import type {
  Account,
  Candle,
  CandleInterval,
  ChainSlug,
  Order,
  OrderBook,
  Position,
  Price,
  RecentTrade,
} from "./types.js";

export interface WebSocketLike {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  addEventListener(type: "open", listener: () => void): void;
  addEventListener(
    type: "close",
    listener: (event: { code: number; reason: string }) => void,
  ): void;
  addEventListener(type: "error", listener: (event: unknown) => void): void;
  addEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
}

export type WebSocketConstructor = new (url: string) => WebSocketLike;

export interface GainsWebSocketOptions {
  readonly url: string;
  readonly chain: ChainSlug;
  readonly signer?: RequestSigner;
  readonly apiKey?: string;
  /** WebSocket implementation. Defaults to the global `WebSocket` (Node 22+, browsers); pass `ws` on Node 20. */
  readonly WebSocket?: WebSocketConstructor;
  readonly reconnect?: boolean;
  readonly onError?: (error: Error) => void;
}

export type PublicSubscription =
  | { readonly channel: "prices" }
  | { readonly channel: "book"; readonly market: string }
  | { readonly channel: "trades"; readonly market: string }
  | { readonly channel: "candles"; readonly market: string; readonly interval: CandleInterval };

export interface PrivateSubscription {
  readonly channel: "orders" | "positions" | "fills" | "account";
}

export type Subscription = PublicSubscription | PrivateSubscription;

export type ChannelMessage =
  | {
      readonly channel: "prices";
      readonly snapshot: boolean;
      readonly seq: number;
      readonly data: readonly Price[];
    }
  | {
      readonly channel: "book";
      readonly market: string;
      readonly snapshot: boolean;
      readonly seq: number;
      readonly data: OrderBook & { readonly timestamp: number };
    }
  | {
      readonly channel: "trades";
      readonly market: string;
      readonly snapshot: boolean;
      readonly data: readonly RecentTrade[];
    }
  | {
      readonly channel: "candles";
      readonly market: string;
      readonly interval: CandleInterval;
      readonly snapshot: boolean;
      readonly data: readonly Candle[];
    }
  | {
      readonly channel: "orders";
      readonly snapshot: boolean;
      readonly data: Order | readonly Order[];
    }
  | {
      readonly channel: "fills";
      readonly snapshot: boolean;
      readonly data: Order | readonly Order[];
    }
  | {
      readonly channel: "positions";
      readonly snapshot: boolean;
      readonly data: readonly Position[];
    }
  | { readonly channel: "account"; readonly snapshot: boolean; readonly data: Account };

export type ControlMessage =
  | { readonly op: "hello"; readonly chain: string; readonly heartbeatMs: number }
  | { readonly op: "ping"; readonly timestamp: number }
  | { readonly op: "pong"; readonly timestamp: number }
  | { readonly op: "authenticated"; readonly trader: string; readonly via: "agent" | "apiKey" }
  | {
      readonly op: "subscribed";
      readonly channel: string;
      readonly market?: string;
      readonly interval?: string;
      readonly duplicate?: boolean;
    }
  | {
      readonly op: "unsubscribed";
      readonly channel: string;
      readonly market?: string;
      readonly interval?: string;
    }
  | { readonly op: "error"; readonly code: string; readonly message: string };

export type ServerMessage = ChannelMessage | ControlMessage;

type Listener = (message: ChannelMessage) => void;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function subscriptionKey(subscription: Subscription): string {
  const market = "market" in subscription ? subscription.market : "";
  const interval = "interval" in subscription ? String(subscription.interval) : "";
  return `${subscription.channel}:${market}:${interval}`;
}

const OPEN = 1;

/**
 * WebSocket client for `/v1/{chain}/ws`. Subscriptions survive reconnects: the client re-sends
 * `auth` and every `subscribe` after the socket reopens, and channels replay a snapshot first.
 */
export class GainsWebSocket {
  private readonly options: GainsWebSocketOptions;
  private readonly WebSocketImpl: WebSocketConstructor;
  private socket: WebSocketLike | undefined;
  private readonly subscriptions = new Map<string, Subscription>();
  private readonly listeners = new Map<string, Set<Listener>>();
  private readonly anyListeners = new Set<Listener>();
  private readonly pendingAcks = new Map<
    string,
    { resolve: () => void; reject: (error: Error) => void }
  >();
  private authenticated = false;
  private closedByUser = false;
  private reconnectDelayMs = 1_000;
  private openPromise: Promise<void> | undefined;

  constructor(options: GainsWebSocketOptions) {
    this.options = options;
    const impl: WebSocketConstructor | undefined =
      options.WebSocket ??
      (typeof globalThis.WebSocket === "undefined" ? undefined : globalThis.WebSocket);
    if (impl === undefined)
      throw new GainsApiError({
        code: "UNEXPECTED_RESPONSE",
        status: 0,
        message:
          "no WebSocket implementation: pass options.WebSocket (for example the `ws` package on Node 20)",
      });
    this.WebSocketImpl = impl;
  }

  /** Opens the socket (idempotent) and resolves once the server said hello. */
  connect(): Promise<void> {
    if (this.openPromise !== undefined) return this.openPromise;
    this.closedByUser = false;
    this.openPromise = new Promise<void>((resolve, reject) => {
      const socket = new this.WebSocketImpl(this.options.url);
      this.socket = socket;
      let settled = false;
      socket.addEventListener("open", () => {
        this.reconnectDelayMs = 1_000;
        this.resubscribe().catch((error: unknown) => {
          this.options.onError?.(error instanceof Error ? error : new Error(String(error)));
        });
        if (!settled) {
          settled = true;
          resolve();
        }
      });
      socket.addEventListener("message", (event) => {
        this.handle(typeof event.data === "string" ? event.data : String(event.data));
      });
      socket.addEventListener("error", (event) => {
        const error = event instanceof Error ? event : new Error("websocket error");
        this.options.onError?.(error);
        if (!settled) {
          settled = true;
          reject(error);
        }
      });
      socket.addEventListener("close", () => {
        this.openPromise = undefined;
        this.authenticated = false;
        for (const pending of this.pendingAcks.values()) pending.reject(new Error("socket closed"));
        this.pendingAcks.clear();
        if (this.closedByUser || this.options.reconnect === false) return;
        const delay = this.reconnectDelayMs;
        this.reconnectDelayMs = Math.min(this.reconnectDelayMs * 2, 30_000);
        setTimeout(() => {
          this.connect().catch((error: unknown) => {
            this.options.onError?.(error instanceof Error ? error : new Error(String(error)));
          });
        }, delay);
      });
    });
    return this.openPromise;
  }

  close(): void {
    this.closedByUser = true;
    this.socket?.close(1000, "client closed");
    this.socket = undefined;
  }

  /** Subscribes to a channel and resolves once the server acknowledged it. */
  async subscribe(subscription: Subscription): Promise<void> {
    await this.connect();
    this.subscriptions.set(subscriptionKey(subscription), subscription);
    if (isPrivate(subscription)) await this.authenticate();
    await this.send({ op: "subscribe", ...subscription }, subscriptionKey(subscription));
  }

  unsubscribe(subscription: Subscription): void {
    this.subscriptions.delete(subscriptionKey(subscription));
    if (this.socket?.readyState === OPEN)
      this.socket.send(JSON.stringify({ op: "unsubscribe", ...subscription }));
  }

  /** Registers a listener for one channel. Returns the unsubscribe function. */
  on<C extends ChannelMessage["channel"]>(
    channel: C,
    listener: (message: Extract<ChannelMessage, { channel: C }>) => void,
  ): () => void {
    const set = this.listeners.get(channel) ?? new Set<Listener>();
    const wrapped: Listener = (message) => {
      if (isChannel(message, channel)) listener(message);
    };
    set.add(wrapped);
    this.listeners.set(channel, set);
    return () => set.delete(wrapped);
  }

  /** Async iterator over every message of one channel, for `for await` loops. */
  async *messages<C extends ChannelMessage["channel"]>(
    channel: C,
    signal?: AbortSignal,
  ): AsyncGenerator<Extract<ChannelMessage, { channel: C }>> {
    const queue: Extract<ChannelMessage, { channel: C }>[] = [];
    let wake: (() => void) | undefined;
    const off = this.on(channel, (message) => {
      queue.push(message);
      wake?.();
    });
    try {
      while (!(signal?.aborted ?? false)) {
        const next = queue.shift();
        if (next !== undefined) {
          yield next;
          continue;
        }
        await new Promise<void>((resolve) => {
          wake = resolve;
          signal?.addEventListener(
            "abort",
            () => {
              resolve();
            },
            { once: true },
          );
        });
        wake = undefined;
      }
    } finally {
      off();
    }
  }

  private async authenticate(): Promise<void> {
    if (this.authenticated) return;
    if (this.options.apiKey !== undefined) {
      await this.send({ op: "auth", apiKey: this.options.apiKey }, "auth");
    } else if (this.options.signer !== undefined) {
      const signed = await this.options.signer.sign({
        operationId: "wsAuth",
        method: "WS",
        path: `/v1/${this.options.chain}/ws`,
        body: "",
      });
      await this.send(
        {
          op: "auth",
          agent: signed.agent,
          timestamp: signed.timestamp.toString(),
          nonce: signed.nonce.toString(),
          signature: signed.signature,
        },
        "auth",
      );
    } else {
      throw new GainsApiError({
        code: "UNAUTHENTICATED",
        status: 0,
        message: "private channels need an apiKey or an agent signer",
      });
    }
    this.authenticated = true;
  }

  private async resubscribe(): Promise<void> {
    const subscriptions = [...this.subscriptions.values()];
    if (subscriptions.some(isPrivate)) await this.authenticate();
    for (const subscription of subscriptions)
      await this.send({ op: "subscribe", ...subscription }, subscriptionKey(subscription));
  }

  private send(payload: Record<string, unknown>, ackKey: string): Promise<void> {
    const socket = this.socket;
    if (socket?.readyState !== OPEN) return Promise.reject(new Error("socket is not open"));
    return new Promise<void>((resolve, reject) => {
      this.pendingAcks.set(ackKey, { resolve, reject });
      socket.send(JSON.stringify(payload));
    });
  }

  private handle(text: string): void {
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      return;
    }
    if (!isRecord(json)) return;
    if (typeof json.op === "string") {
      this.handleControl(json);
      return;
    }
    const message = channelMessageOf(json);
    if (message === undefined) return;
    for (const listener of this.listeners.get(message.channel) ?? []) listener(message);
    for (const listener of this.anyListeners) listener(message);
  }

  private handleControl(json: Record<string, unknown>): void {
    switch (json.op) {
      case "ping":
        this.socket?.send(JSON.stringify({ op: "pong", timestamp: Date.now() }));
        return;
      case "authenticated":
        this.pendingAcks.get("auth")?.resolve();
        this.pendingAcks.delete("auth");
        return;
      case "subscribed": {
        const key = `${String(json.channel)}:${typeof json.market === "string" ? json.market : ""}:${typeof json.interval === "string" ? json.interval : ""}`;
        this.pendingAcks.get(key)?.resolve();
        this.pendingAcks.delete(key);
        return;
      }
      case "error": {
        const error = new GainsApiError({
          code: "UNEXPECTED_RESPONSE",
          status: 0,
          message: `${String(json.code)}: ${String(json.message)}`,
        });
        const pending = this.pendingAcks.get("auth");
        if (pending !== undefined) {
          pending.reject(error);
          this.pendingAcks.delete("auth");
          return;
        }
        for (const [key, waiter] of this.pendingAcks) {
          waiter.reject(error);
          this.pendingAcks.delete(key);
          break;
        }
        this.options.onError?.(error);
        return;
      }
      default:
        return;
    }
  }
}

const CHANNELS = new Set<string>([
  "prices",
  "book",
  "trades",
  "candles",
  "orders",
  "fills",
  "positions",
  "account",
]);

function channelMessageOf(json: Record<string, unknown>): ChannelMessage | undefined {
  if (typeof json.channel !== "string" || !CHANNELS.has(json.channel) || !("data" in json))
    return undefined;
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- sole ChannelMessage mint site: the server owns the wire shape
  return json as unknown as ChannelMessage;
}

function isChannel<C extends ChannelMessage["channel"]>(
  message: ChannelMessage,
  channel: C,
): message is Extract<ChannelMessage, { channel: C }> {
  return message.channel === channel;
}

function isPrivate(subscription: Subscription): subscription is PrivateSubscription {
  return (
    subscription.channel === "orders" ||
    subscription.channel === "positions" ||
    subscription.channel === "fills" ||
    subscription.channel === "account"
  );
}
