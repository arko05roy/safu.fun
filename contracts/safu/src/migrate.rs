//! State migrations. Each upgrade that changes the `Safu` layout adds a
//! `migrate_*` entry point that reads the previous layout and fills new fields.

use crate::*;

/// v0.5/v0.6 layout (cover-only sales, before $SAFU staking).
#[near(serializers = [borsh])]
pub struct SafuV6 {
    owner: AccountId,
    usdc: AccountId,
    api: AccountId,
    watchers: IterableSet<AccountId>,
    relayers: IterableSet<AccountId>,
    dispute_window_ms: u64,
    waiting_period_ms: u64,
    deductible_bps: u16,
    max_token_exposure_bps: u16,
    pool_available: u128,
    pool_reserved: u128,
    premiums_earned: u128,
    total_paid_out: u128,
    policies: LookupMap<u64, Policy>,
    next_policy_id: u64,
    token_policies: LookupMap<String, Vec<u64>>,
    token_exposure: LookupMap<String, u128>,
    rugged: LookupMap<String, u64>,
    reports: LookupMap<u64, Report>,
    next_report_id: u64,
    open_report: LookupMap<String, u64>,
    payouts: LookupMap<u64, Payout>,
    next_payout_id: u64,
    pending_payouts: IterableSet<u64>,
    mpc_signer: AccountId,
    evm_chains: LookupMap<String, EvmChain>,
    oneclick_pubkey: [u8; 32],
    max_slippage_bps: u16,
    watches: LookupMap<String, TokenWatch>,
    active_tokens: IterableSet<String>,
    last_heartbeat_ms: u64,
    api_pubkey: Option<[u8; 32]>,
    used_quote_nonces: LookupSet<String>,
}

#[near]
impl Safu {
    /// v0.7 -> v0.8: same layout; reward accumulator rescaled 1e24 -> 1e36.
    /// Staker reward debts are stored in USDC units, so only the global
    /// accumulator changes (shares × acc / scale is preserved exactly).
    #[private]
    #[init(ignore_state)]
    pub fn migrate_v8() -> Self {
        let mut this: Safu = env::state_read().expect("no v0.7 state");
        this.stk.acc_reward_per_share *= 1_000_000_000_000;
        emit("migrated", json!({ "to": "v0.8" }));
        this
    }

    /// v0.6 -> v0.7: adds $SAFU staking (token is set later with set_safu_token).
    #[private]
    #[init(ignore_state)]
    pub fn migrate_v7() -> Self {
        let old: SafuV6 = env::state_read().expect("no v0.6 state");
        emit("migrated", json!({ "to": "v0.7" }));
        Self {
            owner: old.owner,
            usdc: old.usdc,
            api: old.api,
            watchers: old.watchers,
            relayers: old.relayers,
            dispute_window_ms: old.dispute_window_ms,
            waiting_period_ms: old.waiting_period_ms,
            deductible_bps: old.deductible_bps,
            max_token_exposure_bps: old.max_token_exposure_bps,
            pool_available: old.pool_available,
            pool_reserved: old.pool_reserved,
            premiums_earned: old.premiums_earned,
            total_paid_out: old.total_paid_out,
            policies: old.policies,
            next_policy_id: old.next_policy_id,
            token_policies: old.token_policies,
            token_exposure: old.token_exposure,
            rugged: old.rugged,
            reports: old.reports,
            next_report_id: old.next_report_id,
            open_report: old.open_report,
            payouts: old.payouts,
            next_payout_id: old.next_payout_id,
            pending_payouts: old.pending_payouts,
            mpc_signer: old.mpc_signer,
            evm_chains: old.evm_chains,
            oneclick_pubkey: old.oneclick_pubkey,
            max_slippage_bps: old.max_slippage_bps,
            watches: old.watches,
            active_tokens: old.active_tokens,
            last_heartbeat_ms: old.last_heartbeat_ms,
            api_pubkey: old.api_pubkey,
            used_quote_nonces: old.used_quote_nonces,
            stk: StakingState::new(old.dispute_window_ms * 2 + 1),
            stakers: LookupMap::new(b"S"),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::{accounts, VMContextBuilder};
    use near_sdk::testing_env;

    #[test]
    fn migrates_v6_state_preserving_everything() {
        let mut b = VMContextBuilder::new();
        b.current_account_id("safu.test.near".parse().unwrap())
            .predecessor_account_id("safu.test.near".parse().unwrap());
        testing_env!(b.build());

        let mut payouts = LookupMap::new(b"P");
        payouts.insert(
            0u64,
            Payout {
                id: 0, policy_id: 0, report_id: 0, amount_usdc: U128(1_600_000),
                payout_chain: "base-sepolia".into(), payout_asset: "a".into(), recipient: "0x1".into(),
                status: PayoutStatus::Signed, rail: Some(PayoutRail::ChainSig), deposit_address: None,
                dest_tx_hash: None, evm_nonce: Some(0), signed_tx: Some("0x02".into()), evm_tx_hash: Some("0xd9".into()),
            },
        );
        payouts.flush();
        let mut relayers = IterableSet::new(b"r");
        relayers.insert(accounts(3));
        relayers.flush();
        let mut active = IterableSet::new(b"A");
        active.insert("near:rugme.x".to_string());
        active.flush();
        let old = SafuV6 {
            owner: accounts(0), usdc: accounts(1), api: accounts(2),
            watchers: IterableSet::new(b"w"), relayers,
            dispute_window_ms: 60_000, waiting_period_ms: 0, deductible_bps: 2_000, max_token_exposure_bps: 1_000,
            pool_available: 17_600_000, pool_reserved: 0, premiums_earned: 0, total_paid_out: 2_400_000,
            policies: LookupMap::new(b"p"), next_policy_id: 2, token_policies: LookupMap::new(b"t"),
            token_exposure: LookupMap::new(b"e"), rugged: LookupMap::new(b"g"), reports: LookupMap::new(b"R"),
            next_report_id: 2, open_report: LookupMap::new(b"o"), payouts, next_payout_id: 2,
            pending_payouts: IterableSet::new(b"q"), mpc_signer: "v1.signer-prod.testnet".parse().unwrap(),
            evm_chains: LookupMap::new(b"c"),
            oneclick_pubkey: intents::parse_pubkey(intents::DEFAULT_ONECLICK_PUBKEY).unwrap(),
            max_slippage_bps: 250,
            watches: LookupMap::new(b"W"),
            active_tokens: active,
            last_heartbeat_ms: 42,
            api_pubkey: intents::parse_pubkey(intents::DEFAULT_ONECLICK_PUBKEY),
            used_quote_nonces: LookupSet::new(b"N"),
        };
        env::state_write(&old);

        let c = Safu::migrate_v7();
        let s = c.pool_stats();
        assert_eq!(s.available_usdc.0, 17_600_000);
        assert_eq!(s.total_paid_out_usdc.0, 2_400_000);
        assert_eq!(s.payouts, 2);
        assert_eq!(c.get_payout(0).unwrap().evm_tx_hash.as_deref(), Some("0xd9"));
        let cfg = c.get_config();
        assert_eq!(cfg.relayers, vec![accounts(3)]);
        assert_eq!(cfg.oneclick_pubkey, intents::DEFAULT_ONECLICK_PUBKEY);
        assert_eq!(cfg.max_slippage_bps, 250);
        assert_eq!(c.last_heartbeat_ms(), 42);
        assert_eq!(c.staking_stats().unbond_ms, 120_001);
        assert_eq!(c.staking_stats().total_staked_safu.0, 0);
        assert_eq!(c.get_config().api_pubkey.as_deref(), Some(intents::DEFAULT_ONECLICK_PUBKEY));
    }
}
