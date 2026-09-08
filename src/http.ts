import { stripUndefined } from "./canonicalJson.js";
import { ERROR_CODES, GainsApiError, type ErrorCode } from "./errors.js";
import type { RequestSigner } from "./signing.js";

export interface RequestOptions {
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
  readonly maxRetries?: number;
}

export interface TransportOptions {
  readonly baseUrl: string;
  readonly chain: string;
  readonly fetch?: typeof fetch;
  readonly signer?: RequestSigner;
  readonly apiKey?: string;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly userAgent?: string;
}

export type Auth = "public" | "read" | "trade";

export interface HttpRequest {
  readonly operationId: string;
  readonly method: "GET" | "POST" | "PATCH" | "DELETE";
  readonly path: string;
  readonly query?: Readonly<Record<string, string | number | boolean | undefined>>;
  readonly body?: unknown;
  readonly auth: Auth;
  readonly options?: RequestOptions;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const KNOWN_ERROR_CODES: ReadonlySet<string> = new Set(ERROR_CODES);

function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === "string" && KNOWN_ERROR_CODES.has(value);
}

function sleep(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new GainsApiError({ code: "NETWORK_ERROR", status: 0, message: "aborted" }));
    });
  });
}

export class Transport {
  private readonly options: TransportOptions;
  private readonly fetchImpl: typeof fetch;

  constructor(options: TransportOptions) {
    this.options = { ...options, baseUrl: options.baseUrl.replace(/\/$/, "") };
    this.fetchImpl = options.fetch ?? fetch;
  }

  get chain(): string {
    return this.options.chain;
  }

  get signer(): RequestSigner | undefined {
    return this.options.signer;
  }

  get apiKey(): string | undefined {
    return this.options.apiKey;
  }

  chainPath(suffix: string): string {
    return `/v1/${this.options.chain}${suffix}`;
  }

  async request<T>(request: HttpRequest): Promise<T> {
    const maxRetries = request.options?.maxRetries ?? this.options.maxRetries;
    let attempt = 0;
    for (;;) {
      try {
        return await this.once<T>(request);
      } catch (error: unknown) {
        const retry =
          error instanceof GainsApiError &&
          error.retryable &&
          request.method === "GET" &&
          attempt < maxRetries;
        if (!retry) throw error;
        attempt += 1;
        await sleep(Math.min(250 * 2 ** attempt, 4_000), request.options?.signal);
      }
    }
  }

  private async once<T>(request: HttpRequest): Promise<T> {
    const url = new URL(`${this.options.baseUrl}${request.path}`);
    if (request.query !== undefined) {
      for (const [key, value] of Object.entries(request.query))
        if (value !== undefined) url.searchParams.set(key, String(value));
    }
    const headers: Record<string, string> = { accept: "application/json" };
    if (this.options.userAgent !== undefined) headers["user-agent"] = this.options.userAgent;
    let bodyText: string | undefined;
    if (request.body !== undefined) {
      bodyText = JSON.stringify(stripUndefined(request.body));
      headers["content-type"] = "application/json";
    }
    await this.authenticate(request, url, bodyText, headers);
    const controller = new AbortController();
    const timeoutMs = request.options?.timeoutMs ?? this.options.timeoutMs;
    const timer = setTimeout(() => {
      controller.abort();
    }, timeoutMs);
    request.options?.signal?.addEventListener("abort", () => {
      controller.abort();
    });
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: request.method,
        headers,
        body: bodyText ?? null,
        signal: controller.signal,
      });
    } catch (error: unknown) {
      const aborted = controller.signal.aborted && !(request.options?.signal?.aborted ?? false);
      throw new GainsApiError({
        code: aborted ? "TIMEOUT" : "NETWORK_ERROR",
        status: 0,
        message: aborted
          ? `request timed out after ${String(timeoutMs)} ms`
          : error instanceof Error
            ? error.message
            : String(error),
      });
    } finally {
      clearTimeout(timer);
    }
    const requestId = response.headers.get("x-request-id") ?? undefined;
    const text = await response.text();
    let json: unknown = undefined;
    if (text.length > 0) {
      try {
        json = JSON.parse(text);
      } catch {
        throw new GainsApiError({
          code: "UNEXPECTED_RESPONSE",
          status: response.status,
          message: `non-JSON response: ${text.slice(0, 200)}`,
          ...(requestId === undefined ? {} : { requestId }),
        });
      }
    }
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- sole trust boundary: a 2xx body is shaped by the OpenAPI contract
    if (response.ok) return json as T;
    if (isRecord(json) && isErrorCode(json.code) && typeof json.message === "string") {
      throw new GainsApiError({
        code: json.code,
        status: response.status,
        message: json.message,
        ...(isRecord(json.details) ? { details: json.details } : {}),
        ...(requestId === undefined ? {} : { requestId }),
      });
    }
    throw new GainsApiError({
      code: "UNEXPECTED_RESPONSE",
      status: response.status,
      message: `HTTP ${String(response.status)}`,
      ...(requestId === undefined ? {} : { requestId }),
    });
  }

  private async authenticate(
    request: HttpRequest,
    url: URL,
    bodyText: string | undefined,
    headers: Record<string, string>,
  ): Promise<void> {
    if (request.auth === "public") return;
    if (request.auth === "read" && this.options.apiKey !== undefined) {
      headers["x-gains-api-key"] = this.options.apiKey;
      return;
    }
    const signer = this.options.signer;
    if (signer === undefined) {
      throw new GainsApiError({
        code: "UNAUTHENTICATED",
        status: 0,
        message:
          request.auth === "read"
            ? "this call needs an apiKey or an agent signer"
            : "this call needs an agent signer",
      });
    }
    const signed = await signer.sign({
      operationId: request.operationId,
      method: request.method,
      path: `${url.pathname}${url.search}`,
      body: bodyText ?? "",
    });
    headers["x-gains-agent"] = signed.agent;
    headers["x-gains-timestamp"] = signed.timestamp.toString();
    headers["x-gains-nonce"] = signed.nonce.toString();
    headers["x-gains-signature"] = signed.signature;
  }
}
