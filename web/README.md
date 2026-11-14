# @safu/web

The safu.fun frontend: Next.js (App Router, TypeScript, Tailwind v4), three.js via React Three Fiber, Motion and Lenis. It reads everything from `services/api` and the NEAR RPC. Users sign with a NEAR wallet through wallet-selector (MyNearWallet).

```bash
pnpm install
pnpm --filter @safu/api start      # http://localhost:8787 (see services/api)
cp web/.env.example web/.env.local
pnpm --filter @safu/web dev        # http://localhost:3000
```

| Route | What it does |
|---|---|
| `/` | Landing: 3D voxel flame field, live pool stats, pinned "how it works", interactive rug-odds model, UNO REVERSE flip card, Wall of Rugs preview |
| `/buy` | Paste any coin → profile + rug odds + watched wallets → signed cover quote → pay the premium with one `ft_transfer_call` |
| `/cover/[id]` | Policy state machine (ACTIVE → REPORTED → FINALIZED → PAID), countdown, rug evidence, payout, and a full-screen payout takeover |
| `/underwrite` | Pool and $SAFU stats, burn grid, stake / claim / unstake / withdraw |
| `/launch` | UNO REVERSE dev console (create → lock → seed coin → seed USDC). Progress is read from the contract. Plus every launch and its refund snapshot |
| `/wall` | Every finalized rug, with dev wallet, dump %, evidence txs and the amount paid back |

Brand assets from `brand-assets/` are served from `public/brand/` (`pixel-flames.png`, `dither-grid.png`).

| Env | Default |
|---|---|
| `NEXT_PUBLIC_SAFU_API` | `http://localhost:8787` |
| `NEXT_PUBLIC_NEAR_NETWORK` | `testnet` |
| `NEXT_PUBLIC_SAFU_CONTRACT` | `cover.safufun-d73f3d.testnet` |
