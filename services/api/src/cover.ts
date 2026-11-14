/**
 * Pricing + token-watch snapshots + signed cover-only quotes.
 *
 * Contract counterpart: contracts/safu/src/cover.rs. The contract verifies our
 * ed25519 signature over the exact quote bytes and rechecks payer, amount,
 * expiry, nonce and premium = cover × bps / 10_000 before creating the policy.
 */
import { randomBytes } from "node:crypto";
import { KeyPair } from "near-api-js";
import { base58 } from "@scure/base";
import { config } from "./config.js";
import { tokenProfile, type TokenProfile } from "./explorers.js";
import { assessRisk, type Risk } from "./risk.js";
import { safu, type OnchainToken } from "./near.js";

const signer = KeyPair.fromString(config.quoteSigningKey);

export class HttpError extends Error {
  constructor(readonly status: 400 | 404 | 409 | 422 | 501 | 502, message: string) {
    super(message);
  }
}

export interface TokenView {
  profile: TokenProfile;
  risk: Risk;
  onchain: OnchainToken;
}

export async function tokenView(chain: string, addr: string): Promise<TokenView> {
  const [profile, onchain] = await Promise.all([tokenProfile(chain, addr), safu.getToken(chain, addr)]);
  return { profile, risk: assessRisk(profile), onchain };
}

/**
 * Make sure the contract has a TokenWatch for this token before cover is sold.
 * Live watches are locked on-chain; otherwise we (re)write a fresh snapshot.
 */
export async function ensureWatch(v: TokenView): Promise<"existing" | "registered"> {
  const { profile: p, onchain } = v;
  if (onchain.rugged_report_id !== null) throw new HttpError(409, "token already rugged");
  if (onchain.open_report_id !== null) throw new HttpError(409, "token has an open rug report");
  if (onchain.watch && onchain.active_policy_ids.length > 0) return "existing";
  if (!p.deployer) throw new HttpError(422, "could not identify the token's deployer; cover not available");
  await safu.registerTokenWatch(
    p.chain,
    p.address,
    { address: p.deployer, baseline: p.deployerBalance.toString() },
    p.insiders.map((h) => ({ address: h.address, baseline: h.balance.toString() })),
    Number(p.snapshotBlock),
  );
  return "registered";
}

export interface CoverQuoteRequest {
  token_chain: string;
  token_addr: string;
  cover_usdc: string; // base units (6 dp)
  payout_chain: string;
  payout_asset: string;
  recipient: string;
  payer: string; // NEAR account paying the premium
}

export async function coverQuote(req: CoverQuoteRequest) {
  for (const k of ["token_chain", "token_addr", "cover_usdc", "payout_chain", "payout_asset", "recipient", "payer"] as const) {
    if (!req[k]) throw new HttpError(400, `missing ${k}`);
  }
  const cover = BigInt(req.cover_usdc);
  if (cover <= 0n) throw new HttpError(400, "cover_usdc must be > 0");

  const v = await tokenView(req.token_chain, req.token_addr);
  const [stats, cfg] = await Promise.all([safu.poolStats(), safu.getConfig()]);
  const cap = (BigInt(stats.available_usdc) * BigInt(cfg.max_token_exposure_bps)) / 10_000n;
  const room = cap - BigInt(v.onchain.exposure_usdc);
  if (cover > room) throw new HttpError(409, `cover exceeds this token's remaining capacity (${room} USDC base units)`);

  const watch = await ensureWatch(v);
  const now = Date.now();
  const premiumBps = v.risk.premiumBps;
  const quote = {
    contract: config.contract,
    payer: req.payer,
    token_chain: req.token_chain,
    token_addr: req.token_addr,
    payout_chain: req.payout_chain,
    payout_asset: req.payout_asset,
    recipient: req.recipient,
    cover_usdc: cover.toString(),
    premium_bps: premiumBps,
    premium_usdc: ((cover * BigInt(premiumBps)) / 10_000n).toString(),
    expires_at_ms: now + config.coverDays * 86_400_000,
    quote_expires_at_ms: now + config.quoteTtlMs,
    nonce: randomBytes(16).toString("hex"),
  };
  const quoteJson = JSON.stringify(quote);
  const signature = `ed25519:${base58.encode(signer.sign(new TextEncoder().encode(quoteJson)).signature)}`;
  const msg = JSON.stringify({ buy_cover: { quote: quoteJson, signature } });
  return {
    mode: "cover_only" as const,
    quote,
    signature,
    rug_odds_pct: v.risk.rugOddsPct,
    risk: v.risk,
    watch,
    /** Exact call the buyer's wallet signs (NEP-141 refunds in full if any check fails). */
    pay: {
      receiver_id: cfg.usdc,
      method: "ft_transfer_call",
      args: { receiver_id: config.contract, amount: quote.premium_usdc, msg },
      deposit_yocto: "1",
      gas_tgas: 100,
    },
  };
}
