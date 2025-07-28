use crate::error::StakingError;
use crate::state::*;
use anchor_lang::prelude::*;

// Constants
pub const TOTAL_REWARD_POOL: u64 = 250_000_000_000_000_000; // 250M with 9 decimals
pub const MAX_DAILY_RATES: usize = 370; // Store rates for ~1 year
pub const DECIMALS: u8 = 9;
pub const SECONDS_PER_DAY: i64 = 86400;
pub const SECONDS_PER_WEEK: i64 = 604800;

const PRECISION: u128 = 10_000;

pub fn get_months_elapsed(start_time: i64, current_time: i64) -> Result<u64> {
    let seconds_elapsed = current_time
        .checked_sub(start_time)
        .ok_or(StakingError::Underflow)?;
    Ok((seconds_elapsed / (30 * 24 * 60 * 60)) as u64)
}

pub fn get_week_number(current_time: i64, program_start: i64) -> Result<u64> {
    let seconds_elapsed = current_time
        .checked_sub(program_start)
        .ok_or(StakingError::Underflow)?
        .checked_add(SECONDS_PER_DAY) // for start from 21 (monday)
        .ok_or(StakingError::Underflow)?;
    Ok((seconds_elapsed / SECONDS_PER_WEEK) as u64)
}

pub fn get_day_index(current_time: i64, program_start: i64) -> Result<u64> {
    let seconds_elapsed = current_time
        .checked_sub(program_start)
        .ok_or(StakingError::Underflow)?;
    let day = (seconds_elapsed / SECONDS_PER_DAY) as u64;

    require!(
        day < MAX_DAILY_RATES as u64,
        StakingError::DayIndexOutOfBounds
    );
    Ok(day)
}

// Helper functions
pub fn calculate_base_apy(total_staked: u64, available_rewards: u64) -> Result<u64> {
    // Base APY = (R / (T + 1)) * 100 - according to specification
    // Where R = available_rewards, T = total_staked
    let denominator = total_staked.checked_add(1).ok_or(StakingError::Overflow)?;
    let apy = (available_rewards as u128)
        .checked_div(denominator as u128)
        .ok_or(StakingError::DivisionByZero)?;
    let apy = apy
        .checked_mul(PRECISION) // Convert to percentage
        .ok_or(StakingError::Overflow)?;

    Ok(apy as u64)
}

pub fn get_available_rewards(staking_pool: &StakingPool, current_time: i64) -> Result<u64> {
    let months_elapsed = get_months_elapsed(staking_pool.program_start_time, current_time)?;

    let available_pool = match months_elapsed {
        0 => 20_833_333_000_000_000,
        1 => 41_666_667_000_000_000,
        2 => 62_500_000_000_000_000,
        3 => 83_333_333_000_000_000,
        4 => 104_166_667_000_000_000,
        5 => 125_000_000_000_000_000,
        6 => 145_833_333_000_000_000,
        7 => 166_666_667_000_000_000,
        8 => 187_500_000_000_000_000,
        9 => 208_333_333_000_000_000,
        10 => 229_166_667_000_000_000,
        _ => TOTAL_REWARD_POOL,
    };

    available_pool
        .checked_sub(staking_pool.total_rewards_distributed)
        .ok_or(StakingError::Underflow.into())
}

pub fn update_daily_rate(staking_pool: &mut StakingPool, current_time: i64) -> Result<()> {
    let day_index = get_day_index(current_time, staking_pool.program_start_time)?;

    // Always update the rate when called
    let available_rewards = get_available_rewards(staking_pool, current_time)?;

    // Calculate base APY without duration weights
    let base_apy = calculate_base_apy(staking_pool.total_staked, available_rewards)?;

    if staking_pool.daily_rates.len() <= day_index as usize {
        staking_pool.daily_rates.resize(day_index as usize + 1, 0);
    }

    staking_pool.daily_rates[day_index as usize] = base_apy;
    staking_pool.last_update_time = current_time;

    Ok(())
}

pub fn calculate_daily_reward(
    stake_amount: u64,
    daily_rate: u64,
    duration_months: u8,
    normalization_k: u128,
) -> Result<u64> {
    // Apply weight multiplier based on stake duration
    // NORMALIZATION_K in original was 500 but we use 5000 for better precision
    // and can use 10 as a multiplier for 1.0x, 1.5x, etc.
    let weight_multiplier = match duration_months {
        3 => 10,  // 1.0x
        6 => 15,  // 1.5x
        9 => 20,  // 2.0x
        12 => 30, // 3.0x
        _ => return Err(StakingError::InvalidDuration.into()),
    };

    let weight_factor = (weight_multiplier as u128)
        .checked_mul(PRECISION as u128)
        .ok_or(StakingError::Overflow)?
        .checked_div(normalization_k)
        .ok_or(StakingError::DivisionByZero)?;

    let mut daily_rate_with_weight = (daily_rate as u128)
        .checked_mul(weight_factor as u128)
        .ok_or(StakingError::Overflow)?
        .checked_mul(PRECISION as u128)
        .ok_or(StakingError::Overflow)?;

    let max_daily_rate = 100 * PRECISION * PRECISION * PRECISION; // 100% APY with precision
    if daily_rate_with_weight > max_daily_rate {
        daily_rate_with_weight = max_daily_rate
    }

    let daily_reward = (stake_amount as u128)
        .checked_mul(daily_rate_with_weight as u128)
        .ok_or(StakingError::Overflow)?
        .checked_div(360)
        .ok_or(StakingError::DivisionByZero)?
        .checked_div(PRECISION)
        .ok_or(StakingError::DivisionByZero)?
        .checked_div(PRECISION)
        .ok_or(StakingError::DivisionByZero)?
        .checked_div(PRECISION)
        .ok_or(StakingError::DivisionByZero)?;

    Ok(daily_reward as u64)
}

pub fn calculate_claimable_rewards(
    stake_entry: &StakeEntry,
    staking_pool: &StakingPool,
    current_time: i64,
    is_unstaking: bool,
) -> Result<u64> {
    let current_week = get_week_number(current_time, staking_pool.program_start_time)?;
    let last_claimed_week = stake_entry.last_claim_week;
    msg!("current_week last_claimed_week {} {}", current_week, last_claimed_week);

    // Can only claim up to previous week (not current week)
    let claimable_up_to_week = if is_unstaking {
        current_week.saturating_sub(1)
    } else {
        current_week
    };

    if claimable_up_to_week <= last_claimed_week {
        return Ok(0);
    }

    // Calculate day range
    let start_day = (last_claimed_week * 7) as usize;
    let end_day = (claimable_up_to_week * 7) as usize;
    msg!("start_day end_day {} {}", start_day, end_day);

    let mut total_rewards = 0u64;
    let mut last_daly_rate = 0u64;
    // Sum rewards for each day
    for day in start_day..end_day.min(MAX_DAILY_RATES) {
        msg!("Calculating rewards for day: {}", day);
        let daily_rate = staking_pool.daily_rates[day];
        if daily_rate > 0 {
            last_daly_rate = daily_rate;
        }

        let daily_reward = calculate_daily_reward(
            stake_entry.amount,
            last_daly_rate,
            stake_entry.duration_months,
            staking_pool.normalization_k,
        )?;
        msg!("daily_reward {}", daily_reward);

        total_rewards = total_rewards
            .checked_add(daily_reward)
            .ok_or(StakingError::Overflow)?;
    }

    Ok(total_rewards)
}

pub fn calculate_total_rewards_for_claim_all<'info>(
    remaining_accounts: &[AccountInfo<'info>],
    user: &Pubkey,
    staking_pool: &StakingPool,
    staking_pool_key: &Pubkey,
    program_id: &Pubkey,
    current_time: i64,
) -> Result<(u64, Vec<usize>)> {
    let mut total_rewards = 0u64;
    let mut valid_stake_indices = Vec::new();
    msg!("Remaining accounts count: {}", remaining_accounts.len());

    // Iterate through all passed StakeEntry accounts
    for (index, stake_entry_account_info) in remaining_accounts.iter().enumerate() {
        // msg!("Processing stake entry at index: {}", index);
        // 1. Verify that PDA is correct
        let index_bytes = (index as u64).to_le_bytes();

        let (expected_pda, _bump) = Pubkey::find_program_address(
            &[
                b"stake_entry",
                user.as_ref(),
                staking_pool_key.as_ref(),
                &index_bytes,
            ],
            program_id,
        );

        require!(
            stake_entry_account_info.key() == expected_pda,
            StakingError::InvalidStakeIndex
        );

        // 2. Deserialize StakeEntry
        let stake_entry_data = stake_entry_account_info.try_borrow_data()?;
        let stake_entry = StakeEntry::try_deserialize(&mut stake_entry_data.as_ref())?;

        // 3. Skip inactive stakes
        if !stake_entry.is_active {
            continue;
        }

        // 4. Verify owner
        require!(stake_entry.owner == *user, StakingError::Unauthorized);

        // 5. Calculate rewards for this stake
        let rewards = calculate_claimable_rewards(
            &stake_entry, 
            staking_pool, 
            current_time, 
            false,
        )?;
        msg!("Calculated rewards for stake {}: {}", index, rewards);

        if rewards > 0 {
            // 6. Accumulate total amount
            total_rewards = total_rewards
                .checked_add(rewards)
                .ok_or(StakingError::Overflow)?;

            // 7. Track indices of stakes with rewards
            valid_stake_indices.push(index);
        }
    }

    Ok((total_rewards, valid_stake_indices))
}
