import type { Address, Hex, PreparedTransaction } from "./types.js";

/**
 * Signs and broadcasts the transactions the API prepares. The agent key (or the trader's own
 * wallet) pays the gas; the SDK never holds a raw private key, it holds this interface.
 */
export interface TransactionSender {
  readonly address: Address;
  sendTransaction(transaction: PreparedTransaction): Promise<Hex>;
}

/** The part of a viem `WalletClient` (created with an account and a chain) the SDK relies on. */
export interface WalletClientLike {
  readonly account: { readonly address: Address } | undefined;
  sendTransaction(args: {
    readonly to: Address;
    readonly data: Hex;
    readonly value: bigint;
    readonly gas?: bigint;
  }): Promise<Hex>;
}

function address(value: string): Address {
  if (!/^0x[0-9a-fA-F]{40}$/.test(value))
    throw new Error(`prepared transaction: bad address ${value}`);
  return `0x${value.slice(2)}`;
}

function hex(value: string): Hex {
  if (!/^0x[0-9a-fA-F]*$/.test(value)) throw new Error("prepared transaction: bad calldata");
  return `0x${value.slice(2)}`;
}

/** Wraps a viem wallet client bound to the agent account as a `TransactionSender`. */
export function viemSender(wallet: WalletClientLike): TransactionSender {
  const account = wallet.account;
  if (account === undefined) throw new Error("viemSender: the wallet client has no account");
  return {
    address: account.address,
    sendTransaction(transaction) {
      return wallet.sendTransaction({
        to: address(transaction.to),
        data: hex(transaction.data),
        value: 0n,
        ...(transaction.gas === null ? {} : { gas: BigInt(transaction.gas) }),
      });
    },
  };
}
