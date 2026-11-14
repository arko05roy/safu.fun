/**
 * ERC-20 tokens on EVM chains. Balances via `balanceOf`; evidence via
 * `Transfer(from=holder)` logs, scanned backwards from head in bounded chunks
 * (public RPCs cap eth_getLogs ranges) until the outflow is accounted for or
 * the snapshot block is reached.
 */
import { createPublicClient, http, parseAbi, parseAbiItem, type PublicClient } from "viem";
import { config } from "../config.js";
import type { ChainAdapter, Outflow } from "./types.js";

const ERC20 = parseAbi(["function balanceOf(address) view returns (uint256)"]);
const TRANSFER = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");

export class EvmAdapter implements ChainAdapter {
  private client: PublicClient;
  constructor(readonly label: string, rpc: string) {
    this.client = createPublicClient({ transport: http(rpc) });
  }

  balanceOf(token: string, holder: string): Promise<bigint> {
    return this.client.readContract({
      address: token as `0x${string}`,
      abi: ERC20,
      functionName: "balanceOf",
      args: [holder as `0x${string}`],
    });
  }

  head(): Promise<bigint> {
    return this.client.getBlockNumber();
  }

  async outflows(token: string, holder: string, since: { block: bigint }, enough: bigint): Promise<Outflow[]> {
    const out: Outflow[] = [];
    let total = 0n;
    let to = await this.head();
    const chunk = BigInt(config.evmLogChunk);
    for (let i = 0; i < config.evmMaxChunks && to >= since.block; i++) {
      const from = to - chunk + 1n > since.block ? to - chunk + 1n : since.block;
      const logs = await this.client.getLogs({
        address: token as `0x${string}`,
        event: TRANSFER,
        args: { from: holder as `0x${string}` },
        fromBlock: from,
        toBlock: to,
      });
      for (const l of logs.reverse()) {
        out.push({ txHash: l.transactionHash, amount: l.args.value!, to: l.args.to! });
        total += l.args.value!;
        if (total >= enough) return out;
      }
      to = from - 1n;
    }
    return out;
  }
}
