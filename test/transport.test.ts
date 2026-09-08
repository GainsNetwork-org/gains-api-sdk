import { describe, expect, it } from "vitest";
import { GainsApiError } from "../src/errors.js";
import { Transport } from "../src/http.js";

function fakeFetch(
  status: number,
  body: unknown,
  capture?: (input: RequestInfo | URL, init?: RequestInit) => void,
): typeof fetch {
  return (input, init) => {
    capture?.(input, init);
    return Promise.resolve(
      new Response(body === undefined ? null : JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json", "x-request-id": "req-1" },
      }),
    );
  };
}

describe("Transport", () => {
  it("maps the API error envelope to GainsApiError", async () => {
    const transport = new Transport({
      baseUrl: "https://api.example",
      chain: "arbitrum",
      timeoutMs: 1_000,
      maxRetries: 0,
      fetch: fakeFetch(422, {
        code: "PRECISION_ERROR",
        message: "size exceeds 4 decimals",
        details: { field: "size" },
      }),
    });
    const error = await transport
      .request({
        operationId: "listMarkets",
        method: "GET",
        path: "/v1/arbitrum/markets",
        auth: "public",
      })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GainsApiError);
    expect(error).toMatchObject({
      code: "PRECISION_ERROR",
      status: 422,
      requestId: "req-1",
      details: { field: "size" },
    });
  });

  it("signs private requests with canonical body and full path", async () => {
    let seen:
      | { url: string; headers: Record<string, string>; body: string | undefined }
      | undefined;
    const transport = new Transport({
      baseUrl: "https://api.example",
      chain: "arbitrum",
      timeoutMs: 1_000,
      maxRetries: 0,
      fetch: fakeFetch(201, { ok: true }, (input, init) => {
        const headers = init?.headers;
        seen = {
          url: input instanceof URL ? input.href : typeof input === "string" ? input : input.url,
          headers:
            headers !== undefined && !(headers instanceof Headers) && !Array.isArray(headers)
              ? headers
              : {},
          body: typeof init?.body === "string" ? init.body : undefined,
        };
      }),
      signer: {
        address: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
        sign: (request) =>
          Promise.resolve({
            agent: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
            timestamp: 1n,
            nonce: 2n,
            signature: `0x${request.path.length.toString(16).padStart(130, "0")}`,
          }),
      },
    });
    await transport.request({
      operationId: "createOrder",
      method: "POST",
      path: "/v1/arbitrum/orders",
      query: { dry: true },
      body: { size: "1", market: "BTC/USD", price: undefined },
      auth: "trade",
    });
    expect(seen?.body).toBe(JSON.stringify({ size: "1", market: "BTC/USD" }));
    expect(seen?.headers["x-gains-agent"]).toBe("0x70997970C51812dc3A010C7d01b50e0d17dc79C8");
    expect(seen?.headers["x-gains-nonce"]).toBe("2");
    expect(seen?.url).toBe("https://api.example/v1/arbitrum/orders?dry=true");
  });

  it("refuses private calls without credentials", async () => {
    const transport = new Transport({
      baseUrl: "https://api.example",
      chain: "arbitrum",
      timeoutMs: 1_000,
      maxRetries: 0,
      fetch: fakeFetch(200, {}),
    });
    await expect(
      transport.request({
        operationId: "getAccount",
        method: "GET",
        path: "/v1/arbitrum/account/0x1",
        auth: "read",
      }),
    ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  });
});
