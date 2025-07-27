use anchor_lang::prelude::*;
use crate::utils::MAX_DAILY_RATES;

// State accounts
#[account]
#[derive(InitSpace)]
pub struct StakingPool {
    pub authority: Pubkey,
    pub stake_mint: Pubkey,
    pub total_staked: u64,
    pub total_rewards_distributed: u64,
    pub last_update_time: i64,
    pub program_start_time: i64,
    pub program_end_date: i64,
    pub treasury_address: Pubkey,
    pub normalization_k: u128,
    #[max_len(MAX_DAILY_RATES)]
    pub daily_rates: Vec<u64>,
}

#[account]
#[derive(InitSpace)]
pub struct UserStakingAccount {
    pub owner: Pubkey,
    pub stake_count: u64,
    pub total_staked: u64,
    pub total_claimed: u64,
}

#[account]
#[derive(InitSpace)]
pub struct StakeEntry {
    pub owner: Pubkey,
    pub stake_index: u64,
    pub amount: u64,
    pub start_time: i64,
    pub duration_months: u8,
    pub last_claim_time: i64,
    pub last_claim_week: u64,
    pub is_active: bool,
    pub total_claimed: u64,
}