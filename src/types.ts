import type { components, paths } from "./generated/schema.js";

type Schemas = components["schemas"];

export type ChainInfo = Schemas["ChainInfo"];
export type Market = Schemas["Market"];
export type MarketCollateral = Schemas["MarketCollateral"];
export type Price = Schemas["Price"];
export type OrderBook = Schemas["OrderBook"];
export type BookLevel = Schemas["BookLevel"];
export type Candle = Schemas["Candle"];
export type RecentTrade = Schemas["RecentTrade"];
export type Order = Schemas["Order"];
export type Fill = Schemas["Fill"];
export type Position = Schemas["Position"];
export type Account = Schemas["Account"];
export type Agent = Schemas["Agent"];
export type AgentScope = Schemas["AgentScope"];
export type TransactionRequest = Schemas["TransactionRequest"];
export type PreparedTransaction = NonNullable<Schemas["PreparedTransaction"]>;
export type PreparedOrder = Schemas["PreparedOrder"];
export type PreparedPosition = Schemas["PreparedPosition"];
export type FillHistoryEntry = Schemas["FillHistoryEntry"];
export type ApiErrorBody = Schemas["Error"];
export type CreateOrderRequest = Schemas["CreateOrderRequest"];
export type UpdateOrderRequest = Schemas["UpdateOrderRequest"];
export type ClosePositionRequest = Schemas["ClosePositionRequest"];
export type UpdatePositionRequest = Schemas["UpdatePositionRequest"];

export type OrderStatus = Order["status"];
export type OrderSide = Order["side"];
export type OrderType = Order["type"];
export type CandleInterval = NonNullable<
  paths["/v1/{chain}/markets/{symbol}/candles"]["get"]["parameters"]["query"]
>["interval"];
export type ChainSlug = paths["/v1/{chain}/markets"]["get"]["parameters"]["path"]["chain"];

export interface Page<T> {
  readonly data: readonly T[];
  readonly nextCursor: string | null;
}

export type Address = `0x${string}`;
export type Hex = `0x${string}`;
