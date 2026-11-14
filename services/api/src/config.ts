import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import "dotenv/config";

export type Network = "testnet" | "mainnet";

function env(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined || v === "") throw new Error(`missing env ${name}`);
  return v;
}

function keyFromKeychain(network: Network, accountId: string): string {
  const p = join(homedir(), ".near-credentials", network, `${accountId}.json`);
  if (!existsSync(p)) throw new Error(`no API_PRIVATE_KEY and no keychain file at ${p}`);
  return JSON.parse(readFileSync(p, "utf8")).private_key;
}

const network = env("NEAR_NETWORK", "testnet") as Network;
const apiAccount = env("API_ACCOUNT");

/** Explorer + RPC endpoints per token chain id (the `token_chain` used on-chain). */
export const CHAINS: Record<string, { kind: "near" | "evm"; rpc: string; explorer: string; chainId?: number }> = {
  near:
    network === "testnet"
      ? { kind: "near", rpc: "https://rpc.testnet.near.org", explorer: "https://api-testnet.nearblocks.io" }
      : { kind: "near", rpc: "https://rpc.mainnet.near.org", explorer: "https://api.nearblocks.io" },
  "base-sepolia": { kind: "evm", rpc: "https://base-sepolia-rpc.publicnode.com", explorer: "https://base-sepolia.blockscout.com" },
  sepolia: { kind: "evm", rpc: "https://ethereum-sepolia-rpc.publicnode.com", explorer: "https://eth-sepolia.blockscout.com" },
  // Mainnet Blockscout instances sit behind a bot challenge; with BLOCKSCOUT_API_KEY
  // the API uses the Blockscout PRO API (api.blockscout.com/<chainId>) instead.
  base: { kind: "evm", rpc: "https://base-rpc.publicnode.com", explorer: "https://base.blockscout.com", chainId: 8453 },
  eth: { kind: "evm", rpc: "https://ethereum-rpc.publicnode.com", explorer: "https://eth.blockscout.com", chainId: 1 },
};

export const config = {
  network,
  port: Number(env("PORT", "8787")),
  nearRpc: CHAINS.near.rpc,
  contract: env("SAFU_CONTRACT"),
  apiAccount,
  apiKey: (process.env.API_PRIVATE_KEY || keyFromKeychain(network, apiAccount)) as `ed25519:${string}`,
  /** Signs cover-only quotes; its public key is registered on the contract. */
  quoteSigningKey: env("API_QUOTE_SIGNING_KEY") as `ed25519:${string}`,
  quoteTtlMs: Number(env("QUOTE_TTL_MS", "300000")),
  coverDays: Number(env("COVER_DAYS", "7")),
  maxInsiders: 5,
  nearblocksKey: process.env.NEARBLOCKS_API_KEY || undefined,
  blockscoutKey: process.env.BLOCKSCOUT_API_KEY || undefined,
  oneClickUrl: env("ONECLICK_URL", "https://1click.chaindefuser.com"),
  oneClickJwt: process.env.ONECLICK_JWT || undefined,
  /** NEAR account that receives 1Click appFees (premiums on Intents buys). Mainnet only. */
  treasury: process.env.TREASURY_ACCOUNT || undefined,
  dataDir: env("DATA_DIR", join(process.cwd(), "data")),
};
