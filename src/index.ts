export {
  GainsClient,
  MarketsApi,
  AccountApi,
  OrdersApi,
  PositionsApi,
  AgentsApi,
  CHAINS,
  MAINNET_URL,
  TESTNET_URL,
} from "./client.js";
export type { GainsClientOptions, AuthorizeAgentInput, MarketSymbolLike } from "./client.js";
export { TrackedOrder } from "./orders.js";
export { viemSender } from "./sender.js";
export type { TransactionSender, WalletClientLike } from "./sender.js";
export type { Broadcast } from "./client.js";
export type { WaitForFillOptions } from "./orders.js";
export { GainsWebSocket } from "./ws.js";
export type {
  GainsWebSocketOptions,
  Subscription,
  PublicSubscription,
  PrivateSubscription,
  ChannelMessage,
  ControlMessage,
  ServerMessage,
  WebSocketLike,
  WebSocketConstructor,
} from "./ws.js";
export {
  AgentSigner,
  requestTypedData,
  bodyHashOf,
  agentAuthorizationTypedData,
  agentRevocationTypedData,
  apiKeyIssueTypedData,
  requestDomain,
  REQUEST_FIELDS,
  AGENT_AUTHORIZATION_FIELDS,
  AGENT_REVOCATION_FIELDS,
  API_KEY_ISSUE_FIELDS,
} from "./signing.js";
export type {
  TypedDataSigner,
  RequestSigner,
  SigningChain,
  SigningChainSource,
  UnsignedRequest,
  SignedRequest,
  AgentSignerOptions,
  AgentAuthorizationInput,
} from "./signing.js";
export {
  GainsApiError,
  OrderNotFilledError,
  OrderSubmitReportError,
  FillTimeoutError,
  ERROR_CODES,
} from "./errors.js";
export type { ErrorCode } from "./errors.js";
export { canonicalJson } from "./canonicalJson.js";
export type { RequestOptions } from "./http.js";
export type * from "./types.js";
export type { components, paths } from "./generated/schema.js";
