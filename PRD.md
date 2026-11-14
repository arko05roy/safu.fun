# safu.fun — Product Requirements Document

> **Buy any memecoin on any chain. If it rugs, you get paid back — on any chain you want.**
> And if the dev launched with safu.fun: **when the dev rugs, the liquidity rugs the dev.**

| | |
|---|---|
| Event | NEAR Hackathon (nearhackathon.com) · submissions close **14 Nov 2026 23:59 UTC** · judging 16–18 Nov |
| Primary track | **Memecoins With Mechanics** ("judged on the mechanic, not the chart") |
| Also entered | Investment Thesis · Unstoppable DeFi · AI Security & Defense (one submission, multiple tracks) |
| Status | Draft v1 · 2026-11-14 |
| Build order | **Backend (contracts + watcher + API) first → frontend second** |
| Frontend | **Next.js (App Router, TypeScript)** in `web/` — decided |

---

## 1. Problem

Every memecoin buyer has been rugged. The dev or insider wallets dump, liquidity disappears, holders are left at ~0.

- 1.8M tokens crashed in Q1 2025 alone; ~3.7M of ~7M tokens listed on GeckoTerminal since 2021 are dead ([Traders Union](https://tradersunion.com/news/cryptocurrency-news/show/240268-crypto-graveyard-grows)).
- TRUMP token: ~989K retail wallets lost ~$3.8B, −97% from peak ([Whale Alert](https://whale-alert.io/stories/e48d011963d7aa/Official-TRUMP-and-MELANIA-meme-tokens-crash-9299-leaving-2M-wallets-underwater-and-43B-in-retail-losses)).
- Revealed demand: BNB Chain + Four Meme paid a **$45M discretionary "Reload" relief airdrop** to memecoin traders after a crash ([CMC](https://coinmarketcap.com/academy/article/meme-news-bnb-chain-airdrops-dollar45m-relief-to-meme-traders-bonkinc-launches)). Chains are already paying for rug relief — manually, after the fact.

Today there is **no way to buy a memecoin with protection**, and no way for an honest dev to *prove* they can't rug.

## 2. Solution (two layers, one product)

### Layer 1 — Protected Buy (any coin, any chain, no dev cooperation needed)
1. User pastes a token contract on any supported chain (MVP demo tokens: one EVM testnet + one non-EVM) and pays with whatever they hold, on whatever chain.
2. **NEAR Intents (1Click API)** routes the swap. A cover premium (risk-priced, 1–7%) is taken inside the swap via `appFees`.
3. A **rug watcher** monitors the deployer + insider wallets for the cover window (e.g. 7 days).
4. If the rug rule triggers, the **safu.fun NEAR contract pays out on any chain the user picks** — by default the chain they paid from, in that chain's native asset or a stable. Two payout rails:
   - **Rail A — Intents payout (any chain Intents supports):** the pool holds USDC (NEP-141) on NEAR; the contract `ft_transfer`s to a 1Click deposit address whose quote has `destinationAsset` = the asset on the user's chain and `recipient` = their address. Covers every chain in `GET /v0/tokens` (EVM chains, Solana, BTC, TON, Sui, Tron, …).
   - **Rail B — Chain Signatures direct (native signing):** the contract signs a transfer from its own derived address on that chain (Ecdsa for EVM/BTC, Eddsa for Solana/others). Used for UNO REVERSE (LP pull + refunds on the token's chain) and as fallback.
   No bridge UI, no wrapped token, user never touches NEAR.
5. Claims are paid from the **$SAFU underwriting pool**.

### Layer 2 — UNO REVERSE launches (opt-in devs)
1. Dev launches a coin whose **LP position and dev allocation are held by a Chain-Signatures-derived address controlled by the safu.fun NEAR contract**. Nobody — including the dev — holds that key.
2. Dev allocation unlocks on a schedule (e.g. 10%/week). Instant dump is impossible.
3. If insider/bundled wallets dump (rug rule), the contract **pulls the LP, refunds every holder pro-rata on their own chain, and burns/slashes the dev allocation**. → "🔄 UNO REVERSE'd".
4. UNO coins get ~1% cover instead of ~7%, a badge, and a premium rebate to the dev.

### Layer 3 — Rug Odds (the Investment Thesis layer)
Every coin shows a live **rug odds** number derived from the underwriting pool's pricing + risk model. Not opted in = public rug premium. Thesis: *a rug-cover market becomes the best rug detector on any chain, and $SAFU stakers earn the underwriting spread.*

## 3. Why only NEAR can do this

| Need | NEAR primitive | Verified detail |
|---|---|---|
| Pay with any asset on any chain | **NEAR Intents 1Click API** | Base `https://1click.chaindefuser.com`; `GET /v0/tokens` → `POST /v0/quote` (`dry:true` then `dry:false` → deposit address) → deposit → `POST /v0/deposit/submit` → `GET /v0/status`. Asset IDs e.g. `nep141:sol.omft.near` (SOL), `nep141:base.omft.near` (ETH on Base), `nep141:base-0x8335…2913.omft.near` (USDC on Base). Quote has `appFees`, `refundTo`, `recipient`, `deadline`, `slippageTolerance`. Statuses: `KNOWN_DEPOSIT_TX, PENDING_DEPOSIT, INCOMPLETE_DEPOSIT, PROCESSING, SUCCESS, REFUNDED, FAILED`. **No testnet** — use tiny mainnet amounts. ([docs](https://docs.near-intents.org/getting-started/first-api-swap), [OpenAPI](https://1click.chaindefuser.com/docs/v0/openapi.yaml)) |
| Contract that owns addresses on any chain and signs payouts/LP actions | **Chain Signatures (MPC)** | Signer `v1.signer` (mainnet) / `v1.signer-prod.testnet`. Address = f(NEAR account, derivation path). Solana = Ed25519 (`Eddsa`, domain 1), EVM = secp256k1 (`Ecdsa`, domain 0). Solana address == derived pubkey. JS: `chainsig.js` → `chainAdapters.solana.Solana` (`deriveAddressAndPublicKey`, `prepareTransactionForSigning`, `finalizeTransactionSigning`, `broadcastTx`) and EVM adapter. ([docs](https://docs.near.org/chain-abstraction/chain-signatures/implementation)) |
| Tokens / staking / receipts | **NEP-141** ($SAFU), **NEP-171** (claim/trophy NFTs, optional) | standard |
| Rug detection oracle | Watcher service → contract | ⚠️ **Shade Agent Framework is deprecated (unmaintained since 19 Apr 2026, per docs.near.org)** — do NOT build on it. MVP: allowlisted watcher key + dispute window. Stretch: run watcher in NEAR AI Cloud with attestation. |

The pitch line: **"NEAR is invisible. Buy on any chain, get paid on any chain, and a NEAR contract made it happen."**

## 4. Users & stories

| User | Story |
|---|---|
| Degen buyer | "I paste any CA, pay with whatever I hold on whatever chain, and if the dev dumps within 7 days I get paid automatically — on the chain and asset I choose." |
| Honest dev | "I launch with UNO REVERSE so I can *prove* I can't rug; my buyers get cheap cover and I get a premium rebate." |
| $SAFU staker | "I stake $SAFU to underwrite cover, earn premiums, and pick which risk tiers I back." |
| Judge (60s) | Watches a cross-chain buy → scripted rug → native refund on another chain → dev tokens burn. |

## 5. Mechanics spec

### 5.1 Rug rule (MVP — narrow, onchain-checkable)
A covered token is **RUGGED** if, within the cover window, any of:
- R1: deployer wallet sells/transfers out ≥ 50% of its holdings;
- R2: top-5 non-pool holders (insider set captured at buy time) collectively sell ≥ 50%;
- R3: LP liquidity drops ≥ 80% within 1 hour (non-UNO coins).

Watcher posts `report_rug(token, evidence_tx_hashes)` → **dispute window** (demo: 60s, prod: 24h) → `finalize_rug` → payouts.

### 5.2 Cover pricing
`premium_bps = clamp(base_bps + risk_score * k, 100, 700)`; UNO coins fixed at 100 bps.
`risk_score` (0–1) from: top-10 holder concentration, bundled-buy detection (same-slot buys), dev wallet history (prior rugs), LP lock status, token age. Displayed as **Rug Odds %**.

### 5.3 Payout
- Payout = `min(cover_amount_usd * 0.8, pool_available_pro_rata)` — 20% deductible kills "buy to claim" gaming.
- Waiting period: cover active 10 min after buy (demo: 0).
- Per-token exposure cap (e.g. 10% of pool) — adverse-selection limit.
- Paid on **any chain the buyer selects** (default: chain they paid from) via Rail A (Intents payout from NEAR-held USDC) or Rail B (Chain Signatures from the pool's derived address on that chain).

### 5.4 $SAFU (NEP-141) mechanic — the memecoin part
- Stake $SAFU → becomes underwriter, earns premium share.
- Claim paid → equivalent $SAFU **burned** from the backing stake (stakers eat rugs).
- UNO REVERSE → slashed dev allocation is swapped & distributed; a **🔄 trophy (NEP-171)** minted to the backing stakers; auto "UNO REVERSE'd" post content generated.
- Ritual: public **Wall of Rugs** — every caught dev wallet, pinned forever.

### 5.5 UNO REVERSE launch
- `create_uno_launch(token, chain, unlock_schedule)` → contract derives `path = "uno-<launch_id>"` → that address holds LP + dev allocation.
- `claim_unlock(launch_id)` → signs transfer of the unlocked tranche to dev.
- On finalized rug → sign: remove LP → distribute to snapshot holders pro-rata → burn dev remainder.
- MVP: implement on one testnet chain with a simple constant-product pool *or* a scripted pool; record holder snapshot off-chain, Merkle root onchain.

## 6. Architecture

```
          ┌─────────────── Frontend (Next.js) ───────────────┐
          │ paste CA · quote · pay · cover status · rug odds │
          └───────┬───────────────────────────┬──────────────┘
                  │                           │
          ┌───────▼────────┐        ┌─────────▼──────────┐
          │ safu API (TS)  │        │ NEAR wallet (opt.) │
          │ quotes, risk,  │        └────────────────────┘
          │ 1Click proxy   │──────► NEAR Intents 1Click (appFees = premium)
          └───────┬────────┘
                  │ register_policy
          ┌───────▼───────────────────────────────────────┐
          │ safu.near contract (Rust, near-sdk)           │
          │ policies · pool · $SAFU staking · launches    │
          │ report/dispute/finalize · payout queue        │──► v1.signer (Chain Signatures)
          └───────▲───────────────────────────────────────┘           │ signatures
                  │ report_rug(evidence)                               ▼
          ┌───────┴────────┐                         relayer broadcasts to
          │ Rug watcher    │◄── any-chain RPCs        Intents payout to any chain
          │ (TS worker)    │                          LP pull, refunds)
          └────────────────┘
```

### 6.1 Components (backend first)
| # | Component | Tech | Responsibility |
|---|---|---|---|
| B1 | `contracts/safu` | Rust, near-sdk | policies, pool accounting, staking, launches, rug lifecycle, `request_payout` → cross-contract `sign` on `v1.signer` |
| B2 | `contracts/safu-token` | Rust, NEP-141 | $SAFU token (+ burn) |
| B3 | `services/api` | TS (Hono/Express) | `/quote` (risk + 1Click dry quote), `/buy` (1Click wet quote, register policy), `/policy/:id`, `/odds/:token`, `/launches` |
| B4 | `services/watcher` | TS worker | poll the token's chain RPC (pluggable per-chain adapter) for rule R1–R3, submit `report_rug`, then `finalize_rug` |
| B5 | `services/relayer` | TS + chainsig.js + 1Click | Rail A: get 1Click wet quote (origin `nep141:<USDC>`, destination = user asset/chain) → contract `ft_transfer` to deposit address → poll `/v0/status`. Rail B: build tx → MPC signature → `finalizeTransactionSigning` → `broadcastTx`. Write back tx hash |
| B6 | `scripts/demo` | TS | deploy demo memecoin + pool on a testnet chain, scripted "dev dump", end-to-end run |

### 6.2 Contract interface (draft)
```
// policies
register_policy(payout_chain, payout_asset, recipient, token_chain, token_addr, cover_usd, premium_bps, insiders_root, expires_at) -> policy_id   [api-only]
get_policy(policy_id) -> Policy
// pool & staking
stake(amount) / unstake(amount)   [ft_on_transfer for $SAFU]
pool_stats() -> { tvl, exposure_by_token, premiums_earned }
// rug lifecycle
report_rug(token_chain, token_addr, evidence: Vec<String>)   [watcher allowlist]
dispute(report_id)                                            [owner/stakers MVP]
finalize_rug(report_id) -> queues payouts, burns stake share
// payouts via chain signatures
request_payout_intents(payout_id, deposit_address) -> ft_transfer USDC to 1Click deposit address   [Rail A]
request_payout_signed(payout_id) -> Promise -> v1.signer.sign({ payload, path: "pool-<chain>", domain_id })   [Rail B]
mark_paid(payout_id, tx_hash)                                 [relayer]
// UNO REVERSE
create_uno_launch(token_chain, token_addr, unlock_schedule) -> (launch_id, derived_address)
claim_unlock(launch_id)
execute_uno_reverse(launch_id, holders_root)
// views
rug_odds(token_chain, token_addr) -> bps
```
Derivation paths: `pool-<chain>` per chain, `uno-<launch_id>`. Keys: `Ecdsa` for EVM/BTC-family, `Eddsa` for Ed25519 chains (Solana, Aptos, …).

### 6.3 Trust model (say it out loud in the pitch)
- MVP watcher is an allowlisted key + dispute window. Honest about it.
- Payout keys are MPC (no single party holds them); contract logic is the only path to a signature.
- Roadmap: attested watcher in NEAR AI Cloud, multiple independent watchers with quorum.

## 7. Frontend (after backend)

### 7.1 Screens
1. **Home / Buy** — huge input "paste any memecoin CA", chain auto-detect, pay-with selector + **get-paid-on selector** (any chain/asset from `/v0/tokens`), live **Rug Odds** + premium, one button: **BUY SAFU**.
2. **Cover status** — countdown, watcher heartbeat, "insiders watched: 5", state machine: ACTIVE → REPORTED → PAID / EXPIRED.
3. **Payout moment** — full-screen flame takeover: "🔄 RUGGED. $42 SENT TO <your chain> 0x7a…" with explorer link.
4. **Launch (UNO REVERSE)** — dev wizard; shows the NEAR-controlled address (on the token's chain) holding the LP: "you can't touch this. neither can we."
5. **Underwrite** — stake $SAFU, pool TVL, premiums earned, exposure by token.
6. **Wall of Rugs** — caught dev wallets, burns, trophies.

### 7.2 Visual direction (see `brand-assets/`)
- `pixel-flames.png` — pixel-mosaic flames in icy blue-grey/black: use for rug/payout moments, hero background, "burn" animations.
- `dither-grid.png` — black field with white dithered pixel squares dissolving: use for page background texture, loading states (pixels "settling" = funds arriving), section dividers.
- Palette: near-black `#0A0A0A`, bone white `#F2F2F2`, ice blue-grey `#B9C3D6` / `#7F8BA3`, one accent for SAFU states (acid green `#C6FF3D`) and one for RUGGED (signal red `#FF3B30`).
- Type: pixel/bitmap display font for headlines (e.g. "Silkscreen" / "Press Start 2P"), mono for numbers and addresses (e.g. "JetBrains Mono" / "IBM Plex Mono").
- Motion: dither dissolve between states; pixel flames ignite on RUGGED; numbers tick like a terminal.
- Tone: degen, blunt, lowercase. "funds are safu." "the rug got rugged."

## 8. Demo script (≤ 90s, for X post + judges)
1. (0–10s) "Everyone's been rugged. What if the rug paid you back?"
2. (10–30s) Paste a demo coin CA → Rug Odds 64% → pay with asset X on chain A, choose payout on chain B → Intents swap SUCCESS.
3. (30–45s) Run `scripts/demo/rug.ts` — dev wallet dumps.
4. (45–65s) Watcher flags R1 → contract finalizes → **payout lands on chain B** (Intents) — then show a second payout on a third chain via v1.signer. Flame takeover.
5. (65–80s) UNO REVERSE coin: dev dumps → LP pulled → holders refunded → dev tokens burned. "UNO REVERSE'd."
6. (80–90s) "safu.fun — buy anything, anywhere. if it rugs, you get paid. Built on NEAR Chain Signatures + Intents."

## 9. Scope & cut list

**Must (demo-critical)**
- safu contract: register_policy, report/finalize, both payout rails.
- Relayer: Rail A Intents payout (tiny mainnet amount, user-chosen chain) + Rail B signed payout on one EVM testnet and one Ed25519 testnet.
- Watcher: rule R1 only.
- API: quote (risk heuristic) + policy registration.
- Frontend: Buy + Cover status + Payout moment.

**Should**
- Real 1Click swap on mainnet with tiny amount + `appFees` premium (no Intents testnet).
- $SAFU NEP-141 + stake/burn.
- UNO REVERSE on one testnet chain.

**Could**
- Base payouts (EVM adapter), Wall of Rugs, NEP-171 trophies, rug-odds leaderboard, meme.cooking integration.

**Cut first:** extra Rail B chains (Rail A already gives any-chain) → trophies → UNO REVERSE pool realism (scripted pool is fine).

## 10. Risks & answers

| Risk | Answer |
|---|---|
| "Isn't this just an oracle you control?" | Yes for MVP; dispute window + allowlist; roadmap to attested multi-watcher quorum. Payout keys are MPC-only. |
| Adverse selection | Risk-priced premium, waiting period, per-token exposure cap, 20% deductible. |
| Pool insolvency in mass rug | Pro-rata payouts capped at pool; $SAFU stake absorbs first loss. |
| Dev won't opt in | Product works with zero devs (Layer 1). Opt-in = cheaper cover + provable trust + rebate. Not opting in = public rug premium. |
| Intents has no testnet | Real swap with tiny mainnet amount; payouts on testnet/devnet. |
| Shade Agents deprecated | Not used. |
| Regulatory | Call it **"cover"**, not insurance. |

## 11. Success criteria (hackathon)
- Public repo runs from README (Claude Code / Codex pre-screen checks this).
- End-to-end demo: cross-chain buy → scripted rug → payout on a user-chosen chain (Intents) + one signed by v1.signer, with explorer links.
- X post tagging @NEARProtocol #NEARHackathon with the video.
- Submission lists all 4 tracks.

## 12. Repo layout (planned)
```
safu.fun/
  PRD.md
  brand-assets/        pixel-flames.png, dither-grid.png
  contracts/safu/      Rust
  contracts/safu-token/
  services/api/
  services/watcher/
  services/relayer/
  scripts/demo/
  web/                 Next.js App Router frontend (phase 2)
```

## 13. Sources
- NEAR Chain Signatures implementation — https://docs.near.org/chain-abstraction/chain-signatures/implementation
- chainsig.js — https://neardefi.github.io/chainsig.js
- NEAR Intents first API swap — https://docs.near-intents.org/getting-started/first-api-swap
- 1Click OpenAPI — https://1click.chaindefuser.com/docs/v0/openapi.yaml
- Shade Agents (deprecated notice) — https://docs.near.org/ai/shade-agents/reference/agent-contract
- Hackathon — https://nearhackathon.com/
- Prior art (graveyards, not rug cover): trash20.lol, RugZombie
