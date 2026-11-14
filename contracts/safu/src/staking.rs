//! $SAFU staking — underwriters back the pool and eat the rugs (PRD §5.4).
//!
//! * Stake: `ft_transfer_call` $SAFU to this contract with msg `"stake"`.
//!   Stakers own *shares* of the staked pot, so a slash (burn) lowers every
//!   share's value at once without iterating stakers.
//! * Earn: `staker_share_bps` of every premium accrues to *active* shares in
//!   USDC (reward-per-share accumulator); `claim_rewards` pays it out.
//! * Eat rugs: when a rug is finalized the staked pot is burned by the pool's
//!   loss ratio (payout ÷ pool capital, capped at `max_slash_bps`). Burned
//!   $SAFU is destroyed via the token's `ft_burn`.
//! * Unstake: `request_unstake` moves shares to unbonding (no rewards, still
//!   slashable) for `unbond_ms` (≥ dispute window, so a pending report can't be
//!   dodged); `withdraw_unstaked` returns the tokens after that.

use crate::*;
use crate::math::mul_div;

/// Fixed-point scale for the reward-per-share accumulator. Shares are 18-decimal
/// (1B $SAFU = 1e27 shares) and rewards 6-decimal, so the scale must dwarf the
/// share count or per-share increments round away (1e24 lost ~4% live).
pub const ACC_SCALE: u128 = 1_000_000_000_000_000_000_000_000_000_000_000_000; // 1e36
/// Minimum stake (1 $SAFU) keeps per-share reward increments bounded.
pub const MIN_STAKE: u128 = 1_000_000_000_000_000_000;

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, Default)]
pub struct Staker {
    pub active_shares: U128,
    /// active_shares × acc at last settlement.
    pub reward_debt: U128,
    /// Settled, unclaimed USDC rewards.
    pub pending_usdc: U128,
    pub unbonding_shares: U128,
    pub release_at_ms: u64,
}

#[near(serializers = [json])]
pub struct StakeView {
    pub account_id: AccountId,
    pub active_shares: U128,
    pub unbonding_shares: U128,
    pub release_at_ms: u64,
    /// Current $SAFU value of active + unbonding shares.
    pub staked_safu: U128,
    pub claimable_usdc: U128,
}

#[near(serializers = [json])]
pub struct StakingStats {
    pub safu_token: Option<AccountId>,
    pub total_staked_safu: U128,
    pub active_shares: U128,
    pub unbonding_shares: U128,
    pub rewards_reserved_usdc: U128,
    pub rewards_paid_usdc: U128,
    pub total_burned_safu: U128,
    pub staker_share_bps: u16,
    pub max_slash_bps: u16,
    pub unbond_ms: u64,
}

impl Safu {
    fn shares_value(&self, shares: u128) -> u128 {
        let total = self.stk.active_shares + self.stk.unbonding_shares;
        if total == 0 { 0 } else { mul_div(shares, self.stk.total_staked, total) }
    }

    fn settle(&self, s: &mut Staker) {
        let accrued = mul_div(s.active_shares.0, self.stk.acc_reward_per_share, ACC_SCALE);
        s.pending_usdc = U128(s.pending_usdc.0 + accrued.saturating_sub(s.reward_debt.0));
    }

    fn reset_debt(&self, s: &mut Staker) {
        s.reward_debt = U128(mul_div(s.active_shares.0, self.stk.acc_reward_per_share, ACC_SCALE));
    }

    /// Split an incoming premium: stakers' cut accrues to active shares, the
    /// rest becomes pool capital. Returns the pool's part.
    pub(crate) fn distribute_premium(&mut self, amount: u128) -> u128 {
        if self.stk.active_shares == 0 || self.stk.staker_share_bps == 0 {
            return amount;
        }
        let cut = amount * self.stk.staker_share_bps as u128 / BPS;
        self.stk.acc_reward_per_share += mul_div(cut, ACC_SCALE, self.stk.active_shares);
        self.stk.rewards_reserved += cut;
        amount - cut
    }

    pub(crate) fn stake(&mut self, staker: AccountId, amount: u128) {
        require!(amount >= MIN_STAKE, "minimum stake is 1 $SAFU");
        let total_shares = self.stk.active_shares + self.stk.unbonding_shares;
        let shares = if total_shares == 0 || self.stk.total_staked == 0 {
            amount
        } else {
            mul_div(amount, total_shares, self.stk.total_staked)
        };
        require!(shares > 0, "stake too small");
        let mut s = self.stakers.get(&staker).cloned().unwrap_or_default();
        self.settle(&mut s);
        s.active_shares = U128(s.active_shares.0 + shares);
        self.reset_debt(&mut s);
        self.stakers.insert(staker.clone(), s);
        self.stk.active_shares += shares;
        self.stk.total_staked += amount;
        emit("staked", json!({ "account_id": staker, "safu": U128(amount), "shares": U128(shares) }));
    }

    /// Burn the staked pot by the pool's loss ratio for a finalized rug.
    pub(crate) fn slash_for_rug(&mut self, report_id: u64, payout: u128, pool_capital_before: u128) {
        if self.stk.total_staked == 0 || payout == 0 || pool_capital_before == 0 {
            return;
        }
        let loss_bps = (payout * BPS / pool_capital_before).min(self.stk.max_slash_bps as u128);
        let burn = mul_div(self.stk.total_staked, loss_bps, BPS);
        if burn == 0 {
            return;
        }
        self.stk.total_staked -= burn;
        self.stk.total_burned += burn;
        emit(
            "stake_slashed",
            json!({ "report_id": report_id, "loss_bps": loss_bps, "burned_safu": U128(burn), "remaining_staked_safu": U128(self.stk.total_staked) }),
        );
        if let Some(token) = self.stk.safu_token.clone() {
            // Detached: the burn executes regardless of the finalize return value.
            ext_safu::ext(token)
                .with_attached_deposit(NearToken::from_yoctonear(1))
                .with_static_gas(Gas::from_tgas(10))
                .ft_burn(U128(burn), Some(format!("rug report {report_id}: stakers eat the rug")))
                .detach();
        }
    }
}

#[ext_contract(ext_safu)]
#[allow(dead_code)]
trait SafuToken {
    fn ft_burn(&mut self, amount: U128, memo: Option<String>);
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>);
}

#[near]
impl Safu {
    /// Owner sets the $SAFU token once.
    pub fn set_safu_token(&mut self, token: AccountId) {
        self.assert_owner();
        require!(self.stk.safu_token.is_none(), "safu token already set");
        self.stk.safu_token = Some(token);
    }

    pub fn set_staking_params(&mut self, staker_share_bps: Option<u16>, max_slash_bps: Option<u16>, unbond_ms: Option<u64>) {
        self.assert_owner();
        if let Some(v) = staker_share_bps {
            require!((v as u128) <= BPS, "bad share");
            self.stk.staker_share_bps = v;
        }
        if let Some(v) = max_slash_bps {
            require!((v as u128) <= BPS, "bad slash cap");
            self.stk.max_slash_bps = v;
        }
        if let Some(v) = unbond_ms {
            self.stk.unbond_ms = v;
        }
        require!(self.stk.unbond_ms > self.dispute_window_ms, "unbonding must outlast the dispute window");
    }

    /// Move `shares` (default: all active) to unbonding. Stops rewards; still slashable.
    pub fn request_unstake(&mut self, shares: Option<U128>) {
        let who = env::predecessor_account_id();
        let mut s = self.stakers.get(&who).cloned().expect("not a staker");
        let shares = shares.map(|x| x.0).unwrap_or(s.active_shares.0);
        require!(shares > 0 && shares <= s.active_shares.0, "bad share amount");
        self.settle(&mut s);
        s.active_shares = U128(s.active_shares.0 - shares);
        s.unbonding_shares = U128(s.unbonding_shares.0 + shares);
        s.release_at_ms = env::block_timestamp_ms() + self.stk.unbond_ms;
        self.reset_debt(&mut s);
        self.stakers.insert(who.clone(), s.clone());
        self.stk.active_shares -= shares;
        self.stk.unbonding_shares += shares;
        emit("unstake_requested", json!({ "account_id": who, "shares": U128(shares), "release_at_ms": s.release_at_ms }));
    }

    /// After unbonding: return the (possibly slashed) $SAFU value of unbonding shares.
    pub fn withdraw_unstaked(&mut self) -> Promise {
        let who = env::predecessor_account_id();
        let mut s = self.stakers.get(&who).cloned().expect("not a staker");
        require!(s.unbonding_shares.0 > 0, "nothing unbonding");
        require!(env::block_timestamp_ms() >= s.release_at_ms, "still unbonding");
        let shares = s.unbonding_shares.0;
        let amount = self.shares_value(shares);
        s.unbonding_shares = U128(0);
        self.stakers.insert(who.clone(), s);
        self.stk.unbonding_shares -= shares;
        self.stk.total_staked -= amount;
        emit("unstaked", json!({ "account_id": who, "shares": U128(shares), "safu": U128(amount) }));
        ext_safu::ext(self.stk.safu_token.clone().expect("no safu token"))
            .with_attached_deposit(NearToken::from_yoctonear(1))
            .with_static_gas(Gas::from_tgas(10))
            .ft_transfer(who.clone(), U128(amount), Some("safu unstake".into()))
            .then(Self::ext(env::current_account_id()).with_static_gas(Gas::from_tgas(10)).on_unstake_transfer(who, U128(shares), U128(amount)))
    }

    #[private]
    pub fn on_unstake_transfer(&mut self, account_id: AccountId, shares: U128, amount: U128) -> bool {
        if env::promise_result_checked(0, 0).is_ok() {
            return true;
        }
        // Transfer failed: restore the unbonded position (immediately withdrawable again).
        let mut s = self.stakers.get(&account_id).cloned().unwrap_or_default();
        s.unbonding_shares = U128(s.unbonding_shares.0 + shares.0);
        self.stakers.insert(account_id, s);
        self.stk.unbonding_shares += shares.0;
        self.stk.total_staked += amount.0;
        false
    }

    /// Pay out accrued USDC premium share.
    pub fn claim_rewards(&mut self) -> Promise {
        let who = env::predecessor_account_id();
        let mut s = self.stakers.get(&who).cloned().expect("not a staker");
        self.settle(&mut s);
        self.reset_debt(&mut s);
        let amount = s.pending_usdc.0;
        require!(amount > 0, "nothing to claim");
        s.pending_usdc = U128(0);
        self.stakers.insert(who.clone(), s);
        self.stk.rewards_reserved -= amount;
        self.stk.rewards_paid += amount;
        ext_ft::ext(self.usdc.clone())
            .with_attached_deposit(USDC_STORAGE_DEPOSIT)
            .with_static_gas(GAS_STORAGE_DEPOSIT)
            .storage_deposit(Some(who.clone()), Some(true))
            .then(
                ext_ft::ext(self.usdc.clone())
                    .with_attached_deposit(NearToken::from_yoctonear(1))
                    .with_static_gas(GAS_FT_TRANSFER)
                    .ft_transfer(who.clone(), U128(amount), Some("safu staking rewards".into())),
            )
            .then(Self::ext(env::current_account_id()).with_static_gas(GAS_CALLBACK).on_claim_rewards(who, U128(amount)))
    }

    #[private]
    pub fn on_claim_rewards(&mut self, account_id: AccountId, amount: U128) -> bool {
        if env::promise_result_checked(0, 0).is_ok() {
            emit("rewards_claimed", json!({ "account_id": account_id, "usdc": amount }));
            return true;
        }
        let mut s = self.stakers.get(&account_id).cloned().unwrap_or_default();
        s.pending_usdc = U128(s.pending_usdc.0 + amount.0);
        self.stakers.insert(account_id, s);
        self.stk.rewards_reserved += amount.0;
        self.stk.rewards_paid -= amount.0;
        false
    }

    pub fn get_stake(&self, account_id: AccountId) -> Option<StakeView> {
        let s = self.stakers.get(&account_id)?.clone();
        let accrued = mul_div(s.active_shares.0, self.stk.acc_reward_per_share, ACC_SCALE);
        Some(StakeView {
            account_id,
            active_shares: s.active_shares,
            unbonding_shares: s.unbonding_shares,
            release_at_ms: s.release_at_ms,
            staked_safu: U128(self.shares_value(s.active_shares.0 + s.unbonding_shares.0)),
            claimable_usdc: U128(s.pending_usdc.0 + accrued.saturating_sub(s.reward_debt.0)),
        })
    }

    pub fn staking_stats(&self) -> StakingStats {
        StakingStats {
            safu_token: self.stk.safu_token.clone(),
            total_staked_safu: U128(self.stk.total_staked),
            active_shares: U128(self.stk.active_shares),
            unbonding_shares: U128(self.stk.unbonding_shares),
            rewards_reserved_usdc: U128(self.stk.rewards_reserved),
            rewards_paid_usdc: U128(self.stk.rewards_paid),
            total_burned_safu: U128(self.stk.total_burned),
            staker_share_bps: self.stk.staker_share_bps,
            max_slash_bps: self.stk.max_slash_bps,
            unbond_ms: self.stk.unbond_ms,
        }
    }
}

/// Staking state, grouped so it's one field on the contract.
#[near(serializers = [borsh])]
pub struct StakingState {
    pub safu_token: Option<AccountId>,
    pub total_staked: u128,
    pub active_shares: u128,
    pub unbonding_shares: u128,
    pub acc_reward_per_share: u128,
    pub rewards_reserved: u128,
    pub rewards_paid: u128,
    pub total_burned: u128,
    pub staker_share_bps: u16,
    pub max_slash_bps: u16,
    pub unbond_ms: u64,
}

impl StakingState {
    pub fn new(unbond_ms: u64) -> Self {
        Self {
            safu_token: None,
            total_staked: 0,
            active_shares: 0,
            unbonding_shares: 0,
            acc_reward_per_share: 0,
            rewards_reserved: 0,
            rewards_paid: 0,
            total_burned: 0,
            staker_share_bps: 5_000,
            max_slash_bps: 5_000,
            unbond_ms,
        }
    }
}
