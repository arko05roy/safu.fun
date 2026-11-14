//! Cover-only purchases (tokens 1Click can't swap into, e.g. fresh memecoins).
//!
//! The API prices cover (rug odds -> premium) and signs a `CoverQuote`. The
//! buyer pays the premium straight to this contract with `ft_transfer_call`.
//! The contract verifies the API signature over the exact quote bytes, then
//! checks payer, amount, expiry and nonce before creating the policy. A failed
//! check panics, so NEP-141 refunds the buyer's USDC in full.

use crate::*;
use near_sdk::serde::Deserialize;
use near_sdk::serde_json;

#[derive(Deserialize)]
#[serde(crate = "near_sdk::serde")]
struct BuyCoverMsg {
    buy_cover: BuyCover,
}

#[derive(Deserialize)]
#[serde(crate = "near_sdk::serde")]
struct BuyCover {
    quote: String,
    signature: String,
}

impl Safu {
    pub(crate) fn buy_cover(&mut self, payer: &AccountId, amount: u128, msg: &str) -> u64 {
        let m: BuyCoverMsg = serde_json::from_str(msg).unwrap_or_else(|_| env::panic_str("bad buy_cover msg"));
        let pk = self.api_pubkey.unwrap_or_else(|| env::panic_str("cover-only sales disabled (no api key)"));
        let sig: [u8; 64] = near_sdk::bs58::decode(m.buy_cover.signature.strip_prefix("ed25519:").unwrap_or(&m.buy_cover.signature))
            .into_vec()
            .ok()
            .and_then(|v| v.try_into().ok())
            .unwrap_or_else(|| env::panic_str("bad signature encoding"));
        require!(
            env::ed25519_verify(&sig, m.buy_cover.quote.as_bytes(), &pk),
            "invalid api quote signature"
        );
        let q: CoverQuote = serde_json::from_str(&m.buy_cover.quote).unwrap_or_else(|_| env::panic_str("bad quote json"));

        require!(q.contract == env::current_account_id().as_str(), "quote is for another contract");
        require!(q.payer == payer.as_str(), "quote is for another payer");
        require!(env::block_timestamp_ms() < q.quote_expires_at_ms, "quote expired");
        require!(amount == q.premium_usdc.0, "paid amount != quoted premium");
        require!(
            q.premium_usdc.0 == q.cover_usdc.0 * q.premium_bps as u128 / BPS,
            "premium inconsistent with cover and rate"
        );
        require!(self.used_quote_nonces.insert(q.nonce.clone()), "quote already used");

        // Commit the watch the premium was priced against into the policy.
        let key = token_key(&q.token_chain, &q.token_addr);
        let watch = self.watches.get(&key).unwrap_or_else(|| env::panic_str("no token watch registered"));
        let insiders_root = evm::hex_encode(&env::sha256_array(&serde_json::to_vec(watch).expect("watch json")));

        let id = self.create_policy(
            q.token_chain,
            q.token_addr,
            q.payout_chain,
            q.payout_asset,
            q.recipient,
            q.cover_usdc,
            q.premium_bps,
            insiders_root,
            format!("cover-only:{}", q.nonce),
            q.expires_at_ms,
        );
        self.premiums_earned += amount;
        self.pool_available += self.distribute_premium(amount);
        id
    }
}
