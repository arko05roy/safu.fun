use near_sdk::json_types::U128;
use near_sdk::{near, AccountId};

/// Basis points denominator (100% = 10_000).
pub const BPS: u128 = 10_000;

/// Hard cap on live policies per token. `finalize_rug` iterates a token's
/// policies in one call, so this bounds its gas. Expired policies can be
/// removed with `prune_expired` to make room.
pub const MAX_POLICIES_PER_TOKEN: usize = 200;

/// Canonical key for a covered token: `<chain>:<address>`.
/// Chain id is lowercased; EVM (`0x…`) addresses are lowercased, others
/// (base58 etc.) are case-sensitive and kept verbatim.
pub fn token_key(chain: &str, addr: &str) -> String {
    let chain = chain.trim().to_lowercase();
    let addr = addr.trim();
    let addr = if addr.starts_with("0x") || addr.starts_with("0X") {
        addr.to_lowercase()
    } else {
        addr.to_string()
    };
    assert!(!chain.is_empty() && !addr.is_empty(), "empty token chain/address");
    assert!(!chain.contains(':'), "chain id must not contain ':'");
    format!("{chain}:{addr}")
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub enum PolicyStatus {
    Active,
    /// Token was finalized as rugged; a payout was queued for this policy.
    Claimed { payout_id: u64 },
    /// Token was rugged but the policy was outside its active window.
    NotEligible,
    Expired,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct Policy {
    pub id: u64,
    pub token_key: String,
    pub token_chain: String,
    pub token_addr: String,
    /// Chain the buyer wants to be paid on (e.g. "sol", "base", "eth").
    pub payout_chain: String,
    /// 1Click asset id to pay out in (e.g. "nep141:sol.omft.near").
    pub payout_asset: String,
    /// Recipient address on `payout_chain`.
    pub recipient: String,
    /// Covered notional in USDC base units (6 decimals).
    pub cover_usdc: U128,
    pub premium_bps: u16,
    /// Merkle root (hex) of the insider set captured at buy time.
    pub insiders_root: String,
    /// 1Click deposit address / tx reference of the protected buy (audit trail).
    pub buy_ref: String,
    pub created_at_ms: u64,
    pub starts_at_ms: u64,
    pub expires_at_ms: u64,
    pub status: PolicyStatus,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub enum ReportStatus {
    /// Inside (or past) the dispute window, not yet finalized.
    Pending,
    Disputed,
    Rejected,
    Finalized,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct Report {
    pub id: u64,
    pub token_key: String,
    pub reporter: AccountId,
    /// Rule that triggered, e.g. "R1".
    pub rule: String,
    /// Tx hashes on the token's chain proving the dump.
    pub evidence: Vec<String>,
    pub reported_at_ms: u64,
    pub dispute_deadline_ms: u64,
    pub status: ReportStatus,
    pub payout_ids: Vec<u64>,
    /// Sum of all payouts queued by this report (USDC base units).
    pub total_payout_usdc: U128,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub enum PayoutRail {
    /// USDC on NEAR -> 1Click deposit address -> user's asset on user's chain.
    Intents,
    /// Contract-signed tx from its Chain Signatures derived address.
    ChainSig,
    /// Pool USDC sent straight to a NEAR account (payout_chain "near").
    Near,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub enum PayoutStatus {
    Queued,
    /// A transfer/sign request is in flight.
    Processing,
    /// Rail A: USDC delivered to the 1Click deposit address.
    Sent,
    /// Rail B: MPC-signed raw tx stored on the payout, ready to broadcast.
    Signed,
    /// Destination-chain delivery confirmed by the relayer.
    Paid,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct Payout {
    pub id: u64,
    pub policy_id: u64,
    pub report_id: u64,
    pub amount_usdc: U128,
    pub payout_chain: String,
    pub payout_asset: String,
    pub recipient: String,
    pub status: PayoutStatus,
    pub rail: Option<PayoutRail>,
    /// Rail A: 1Click deposit address the USDC was sent to.
    pub deposit_address: Option<AccountId>,
    /// Destination-chain tx hash, set by `mark_paid`.
    pub dest_tx_hash: Option<String>,
    /// Rail B: nonce of the pool address assigned to this payout (fixed on first
    /// sign, reused on gas-bump re-signs, so at most one tx can ever land).
    pub evm_nonce: Option<u64>,
    /// Rail B: `0x`-hex signed EIP-1559 tx for `eth_sendRawTransaction`.
    pub signed_tx: Option<String>,
    /// Rail B: keccak256 of `signed_tx` — the EVM tx hash.
    pub evm_tx_hash: Option<String>,
}

/// Rail B config for one EVM chain. The pool pays from
/// `derived_address(contract, "pool-<chain>")` in that chain's USDC.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct EvmChain {
    pub chain_id: u64,
    /// ERC-20 USDC on that chain (`0x…`).
    pub usdc: String,
    /// Chain Signatures address for path `pool-<chain>` (`0x…`). Every MPC
    /// signature is ecrecover-checked against it before a tx is stored.
    pub signer_address: String,
    pub next_nonce: u64,
    pub gas_limit: u64,
    /// Upper bound on `max_fee_per_gas` a relayer may request (wei).
    pub max_fee_per_gas_cap: U128,
    /// USDC float the owner has placed on `signer_address` (6 decimals).
    /// Rail B payouts are limited by it.
    pub float_usdc: U128,
}

#[near(serializers = [json])]
pub struct Config {
    pub owner: AccountId,
    pub usdc: AccountId,
    pub api: AccountId,
    pub watchers: Vec<AccountId>,
    pub relayers: Vec<AccountId>,
    pub dispute_window_ms: u64,
    pub waiting_period_ms: u64,
    pub deductible_bps: u16,
    pub max_token_exposure_bps: u16,
    pub mpc_signer: AccountId,
    pub oneclick_pubkey: String,
    pub max_slippage_bps: u16,
    pub api_pubkey: Option<String>,
}

#[near(serializers = [json])]
pub struct PoolStats {
    /// Unreserved USDC available to back new cover / pay claims.
    pub available_usdc: U128,
    /// USDC committed to queued-but-unsent payouts.
    pub reserved_usdc: U128,
    pub premiums_earned_usdc: U128,
    pub total_paid_out_usdc: U128,
    pub policies: u64,
    pub reports: u64,
    pub payouts: u64,
}

/// One watched wallet and its token balance when cover was first written.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct Holder {
    pub address: String,
    /// Token balance (base units) at `snapshot_block`.
    pub baseline: U128,
}

/// What the watcher monitors for a covered token. Written once by the API when
/// the first policy on a token is sold, and immutable while cover is live, so
/// rug rules are evaluated against baselines that cannot be moved later.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct TokenWatch {
    pub token_key: String,
    pub token_chain: String,
    pub token_addr: String,
    /// R1: the deployer wallet.
    pub deployer: Holder,
    /// R2: top non-pool holders at snapshot time (max 10).
    pub insiders: Vec<Holder>,
    /// Block / height on the token's chain the baselines were read at.
    pub snapshot_block: u64,
    pub registered_at_ms: u64,
}

/// `list_watched` row: watch data plus live cover state.
#[near(serializers = [json])]
pub struct WatchedToken {
    pub watch: TokenWatch,
    pub active_policies: u32,
    pub exposure_usdc: U128,
    pub open_report_id: Option<u64>,
}

/// Cover-only quote, signed by the safu API (ed25519 over the exact JSON
/// bytes). Paid for with `ft_transfer_call` on the pool USDC, msg =
/// `{"buy_cover":{"quote":"<this JSON as a string>","signature":"ed25519:…"}}`.
#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct CoverQuote {
    /// Must equal this contract's account id.
    pub contract: String,
    /// NEAR account that must pay the premium.
    pub payer: String,
    pub token_chain: String,
    pub token_addr: String,
    pub payout_chain: String,
    pub payout_asset: String,
    pub recipient: String,
    pub cover_usdc: U128,
    pub premium_bps: u16,
    pub premium_usdc: U128,
    /// Policy expiry.
    pub expires_at_ms: u64,
    /// Quote validity.
    pub quote_expires_at_ms: u64,
    /// Unique per quote; can be used once.
    pub nonce: String,
}
