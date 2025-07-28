#![allow(unexpected_cfgs)]

use anchor_lang::prelude::*;
use anchor_spl::token_2022::{transfer_checked, TransferChecked};
use solana_security_txt::security_txt;

// Import modules
mod ctx_accounts;
mod error;
mod events;
mod state;
mod utils;

// Re-export for use
use ctx_accounts::*;
use error::*;
use events::*;
use state::*;

declare_id!("8g8nx4Eb384RwHeYaiCwM1P63nB3noGrXptTimsxrpcC");

security_txt! {
    name: "REDPANDA Staking Program",
    project_url: "https://minefarm.io/stake",
    contacts: "https://t.me/MineFarm_Announcements",
    policy: "#/blob/main/SECURITY.md",
    preferred_languages: "en",
    source_code: "unavailable"
}

#[program]
pub mod staking_program {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>, program_end_date: i64) -> Result<()> {
        let staking_pool = &mut ctx.accounts.staking_pool;

        staking_pool.authority = ctx.accounts.authority.key();
        staking_pool.stake_mint = ctx.accounts.stake_mint.key();
        staking_pool.total_staked = 0;
        staking_pool.total_rewards_distributed = 0;
        staking_pool.last_update_time = Clock::get()?.unix_timestamp;
        staking_pool.program_start_time = Clock::get()?.unix_timestamp;
        staking_pool.program_end_date = program_end_date;
        staking_pool.treasury_address = ctx.accounts.treasury_address.key();
        staking_pool.normalization_k = 250;
        staking_pool.daily_rates = vec![0; utils::MAX_DAILY_RATES];

        let avail_reward =
            utils::get_available_rewards(staking_pool, staking_pool.program_start_time)?;

        // Calculate initial APY and store it
        let initial_apy = utils::calculate_base_apy(1, avail_reward)?;
        let day_index = 0;
        staking_pool.daily_rates[day_index] = initial_apy;

        Ok(())
    }

    pub fn stake(ctx: Context<Stake>, amount: u64, duration_months: u8) -> Result<()> {
        require!(
            duration_months == 3
                || duration_months == 6
                || duration_months == 9
                || duration_months == 12,
            StakingError::InvalidDuration
        );

        let clock = Clock::get()?;
        let current_time = clock.unix_timestamp;

        // Check if reward pool has enough tokens for potential rewards
        let available_rewards =
            utils::get_available_rewards(&ctx.accounts.staking_pool, current_time)?;

        require!(available_rewards > 0, StakingError::RewardPoolExhausted);

        // Transfer tokens from user to stake vault
        let cpi_accounts = TransferChecked {
            from: ctx.accounts.user_token_account.to_account_info(),
            to: ctx.accounts.stake_vault.to_account_info(),
            authority: ctx.accounts.user.to_account_info(),
            mint: ctx.accounts.stake_mint.to_account_info(),
        };

        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);

        let before = ctx.accounts.stake_vault.amount;
        transfer_checked(cpi_ctx, amount, utils::DECIMALS)?;
        ctx.accounts.stake_vault.reload()?;
        let after = ctx.accounts.stake_vault.amount;
        let delta = after.checked_sub(before).unwrap_or(0);

        // Initialize or update user staking account
        let user_staking_account = &mut ctx.accounts.user_staking_account;
        if user_staking_account.owner == Pubkey::default() {
            user_staking_account.owner = ctx.accounts.user.key();
            user_staking_account.stake_count = 0;
            user_staking_account.total_staked = 0;
            user_staking_account.total_claimed = 0;
        }

        // Auto-calculate stake index
        let stake_index = user_staking_account.stake_count;

        // Derive expected PDA and verify
        let user_key = ctx.accounts.user.key();
        let staking_pool_key = ctx.accounts.staking_pool.key();
        let stake_index_bytes = stake_index.to_le_bytes();

        let (expected_key, _bump) = Pubkey::find_program_address(
            &[
                b"stake_entry",
                user_key.as_ref(),
                staking_pool_key.as_ref(),
                &stake_index_bytes,
            ],
            ctx.program_id,
        );

        require!(
            ctx.accounts.stake_entry.key() == expected_key,
            StakingError::InvalidStakeIndex
        );

        // Create and initialize the stake entry account
        let stake_entry_size = 8 + StakeEntry::INIT_SPACE;
        let lamports = Rent::get()?.minimum_balance(stake_entry_size);

        let seeds = &[
            b"stake_entry",
            user_key.as_ref(),
            staking_pool_key.as_ref(),
            &stake_index_bytes,
            &[_bump],
        ];
        let signer = &[&seeds[..]];

        anchor_lang::solana_program::program::invoke_signed(
            &anchor_lang::solana_program::system_instruction::create_account(
                &ctx.accounts.user.key(),
                &ctx.accounts.stake_entry.key(),
                lamports,
                stake_entry_size as u64,
                ctx.program_id,
            ),
            &[
                ctx.accounts.user.to_account_info(),
                ctx.accounts.stake_entry.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
            ],
            signer,
        )?;

        // Write the stake entry data
        let mut data = ctx.accounts.stake_entry.try_borrow_mut_data()?;

        let stake_entry = StakeEntry {
            owner: user_key,
            stake_index,
            amount: delta,
            start_time: current_time,
            duration_months,
            last_claim_time: current_time,
            last_claim_week: utils::get_week_number(
                current_time,
                ctx.accounts.staking_pool.program_start_time,
            )?,
            is_active: true,
            total_claimed: 0,
        };

        let mut writer = data.as_mut();
        stake_entry.try_serialize(&mut writer)?;

        // Update user staking account
        user_staking_account.stake_count = user_staking_account
            .stake_count
            .checked_add(1)
            .ok_or(StakingError::Overflow)?;
        user_staking_account.total_staked = user_staking_account
            .total_staked
            .checked_add(delta)
            .ok_or(StakingError::Overflow)?;

        // Update staking pool
        let staking_pool = &mut ctx.accounts.staking_pool;
        staking_pool.total_staked = staking_pool
            .total_staked
            .checked_add(delta)
            .ok_or(StakingError::Overflow)?;

        // Update daily rate for current day
        utils::update_daily_rate(staking_pool, current_time)?;

        emit!(StakeEvent {
            user: ctx.accounts.user.key(),
            amount: delta,
            duration_months,
            timestamp: current_time,
        });

        Ok(())
    }
    pub fn unstake(ctx: Context<Unstake>, _stake_index: u64) -> Result<()> {
        let clock = Clock::get()?;
        let current_time = clock.unix_timestamp;

        let stake_entry = &mut ctx.accounts.stake_entry;
        require!(stake_entry.is_active, StakingError::StakeNotActive);

        let staking_pool = &ctx.accounts.staking_pool;

        // Calculate any remaining rewards
        let rewards = utils::calculate_claimable_rewards(
            stake_entry,
            staking_pool,
            current_time,
            true, // unstaking
        )?;

        // Calculate penalty for early unstaking
        let lock_duration_days = (stake_entry.duration_months as i64) * 30;
        let elapsed_time = current_time - stake_entry.start_time;
        let elapsed_days = elapsed_time / 86400; // seconds to days

        let mut penalty_amount = 0u64;
        let mut user_receive_amount = stake_entry.amount;

        // Apply penalty if unstaking before lock period ends
        if elapsed_days < lock_duration_days {
            // Maximum penalty 20%, decreasing linearly to 0%
            let penalty_rate = 20 * (lock_duration_days - elapsed_days) / lock_duration_days;
            penalty_amount = stake_entry
                .amount
                .checked_mul(penalty_rate as u64)
                .ok_or(StakingError::Overflow)?
                .checked_div(100)
                .ok_or(StakingError::Overflow)?;

            user_receive_amount = stake_entry
                .amount
                .checked_sub(penalty_amount)
                .ok_or(StakingError::Underflow)?;
        }

        // Transfer staked tokens back to user (minus penalty)
        let seeds = &[
            b"stake_vault",
            staking_pool.stake_mint.as_ref(),
            &[ctx.bumps.stake_vault],
        ];
        let signer = &[&seeds[..]];

        let cpi_accounts = TransferChecked {
            from: ctx.accounts.stake_vault.to_account_info(),
            to: ctx.accounts.user_token_account.to_account_info(),
            authority: ctx.accounts.stake_vault.to_account_info(),
            mint: ctx.accounts.stake_mint.to_account_info(),
        };

        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer);

        transfer_checked(cpi_ctx, user_receive_amount, utils::DECIMALS)?;

        // Transfer penalty to treasury if any
        if penalty_amount > 0 {
            let penalty_cpi_accounts = TransferChecked {
                from: ctx.accounts.stake_vault.to_account_info(),
                to: ctx.accounts.treasury_token_account.to_account_info(),
                authority: ctx.accounts.stake_vault.to_account_info(),
                mint: ctx.accounts.stake_mint.to_account_info(),
            };

            let penalty_cpi_ctx = CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                penalty_cpi_accounts,
                signer,
            );

            transfer_checked(penalty_cpi_ctx, penalty_amount, utils::DECIMALS)?;
        }

        // Transfer any remaining rewards from reward vault
        if rewards > 0 {
            let reward_seeds = &[
                b"reward_vault",
                staking_pool.stake_mint.as_ref(),
                &[ctx.bumps.reward_vault],
            ];
            let reward_signer = &[&reward_seeds[..]];

            let transfer_accounts = TransferChecked {
                from: ctx.accounts.reward_vault.to_account_info(),
                to: ctx.accounts.user_reward_account.to_account_info(),
                authority: ctx.accounts.reward_vault.to_account_info(),
                mint: ctx.accounts.stake_mint.to_account_info(),
            };

            let transfer_ctx = CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                transfer_accounts,
                reward_signer,
            );

            transfer_checked(transfer_ctx, rewards, utils::DECIMALS)?;
        }

        // Update staking pool
        let staking_pool = &mut ctx.accounts.staking_pool;
        staking_pool.total_staked = staking_pool
            .total_staked
            .checked_sub(stake_entry.amount)
            .ok_or(StakingError::Underflow)?;
        staking_pool.total_rewards_distributed = staking_pool
            .total_rewards_distributed
            .checked_add(rewards)
            .ok_or(StakingError::Overflow)?;

        // Update user staking account
        let user_staking_account = &mut ctx.accounts.user_staking_account;
        user_staking_account.total_staked = user_staking_account
            .total_staked
            .checked_sub(stake_entry.amount)
            .ok_or(StakingError::Underflow)?;
        user_staking_account.total_claimed = user_staking_account
            .total_claimed
            .checked_add(rewards)
            .ok_or(StakingError::Overflow)?;

        // Mark stake as inactive
        stake_entry.is_active = false;
        stake_entry.total_claimed = stake_entry
            .total_claimed
            .checked_add(rewards)
            .ok_or(StakingError::Overflow)?;

        // Update daily rate
        utils::update_daily_rate(staking_pool, current_time)?;

        emit!(UnstakeEvent {
            user: ctx.accounts.user.key(),
            amount: stake_entry.amount,
            rewards,
            timestamp: current_time,
        });

        Ok(())
    }

    pub fn claim_all(ctx: Context<ClaimAll>) -> Result<()> {
        let clock = Clock::get()?;
        let current_time = clock.unix_timestamp;

        let user_staking_account = &mut ctx.accounts.user_staking_account;
        let staking_pool = &ctx.accounts.staking_pool;

        // msg!("Claiming all rewards for user: {}", ctx.accounts.user.key());

        // Calculate total rewards using the helper function
        let (total_rewards, valid_stake_indices) = utils::calculate_total_rewards_for_claim_all(
            &ctx.remaining_accounts,
            &ctx.accounts.user.key(),
            staking_pool,
            &staking_pool.key(),
            ctx.program_id,
            current_time,
        )?;

        // msg!("Total rewards to claim: {}", total_rewards);
        require!(total_rewards > 0, StakingError::NoRewardsAvailable);

        // Update stake entries that have rewards
        let current_week = utils::get_week_number(current_time, staking_pool.program_start_time)?;
        let mut stakes_processed = 0u64;

        for index in valid_stake_indices {
            let stake_entry_account_info = &ctx.remaining_accounts[index];
            let mut stake_entry_data = stake_entry_account_info.try_borrow_mut_data()?;
            let mut stake_entry = StakeEntry::try_deserialize(&mut stake_entry_data.as_ref())?;

            // Calculate rewards again for this specific stake
            let rewards = utils::calculate_claimable_rewards(
                &stake_entry,
                staking_pool,
                current_time,
                false,
            )?;

            // Update stake data
            stake_entry.last_claim_time = current_time;
            stake_entry.last_claim_week = current_week;
            stake_entry.total_claimed = stake_entry
                .total_claimed
                .checked_add(rewards)
                .ok_or(StakingError::Overflow)?;

            // Serialize back to account
            let mut writer = stake_entry_data.as_mut();
            stake_entry.try_serialize(&mut writer)?;

            stakes_processed = stakes_processed
                .checked_add(1)
                .ok_or(StakingError::Overflow)?;
        }

        // 9. Transfer total reward amount in one operation
        let seeds = &[
            b"reward_vault",
            staking_pool.stake_mint.as_ref(),
            &[ctx.bumps.reward_vault],
        ];
        let signer = &[&seeds[..]];

        let cpi_accounts = TransferChecked {
            from: ctx.accounts.reward_vault.to_account_info(),
            to: ctx.accounts.user_reward_account.to_account_info(),
            authority: ctx.accounts.reward_vault.to_account_info(),
            mint: ctx.accounts.stake_mint.to_account_info(),
        };

        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer);

        transfer_checked(cpi_ctx, total_rewards, utils::DECIMALS)?;

        // 10. Update user account and pool
        user_staking_account.total_claimed = user_staking_account
            .total_claimed
            .checked_add(total_rewards)
            .ok_or(StakingError::Overflow)?;

        let staking_pool = &mut ctx.accounts.staking_pool;
        staking_pool.total_rewards_distributed = staking_pool
            .total_rewards_distributed
            .checked_add(total_rewards)
            .ok_or(StakingError::Overflow)?;

        // 11. Update daily rate
        utils::update_daily_rate(staking_pool, current_time)?;

        emit!(ClaimAllEvent {
            user: ctx.accounts.user.key(),
            total_amount: total_rewards,
            stakes_count: stakes_processed,
            timestamp: current_time,
        });

        Ok(())
    }

    // View-only функция - только читает данные, не изменяет состояние
    pub fn get_total_claimable_rewards(ctx: Context<GetTotalClaimableRewards>) -> Result<u64> {
        let clock = Clock::get()?;
        let current_time = clock.unix_timestamp;

        let (total_rewards, _) = utils::calculate_total_rewards_for_claim_all(
            &ctx.remaining_accounts,
            &ctx.accounts.user.key(),
            &ctx.accounts.staking_pool,
            &ctx.accounts.staking_pool.key(),
            ctx.program_id,
            current_time,
        )?;

        // msg!("Total claimable rewards: {}", total_rewards);

        Ok(total_rewards)
    }

    pub fn close_program(ctx: Context<CloseProgram>) -> Result<()> {
        let clock = Clock::get()?;
        let current_time = clock.unix_timestamp;

        require!(
            current_time >= ctx.accounts.staking_pool.program_end_date,
            StakingError::ProgramNotEnded
        );

        // Transfer remaining tokens to treasury
        let remaining_balance = ctx.accounts.reward_vault.amount;

        if remaining_balance > 0 {
            let seeds = &[
                b"reward_vault",
                ctx.accounts.staking_pool.stake_mint.as_ref(),
                &[ctx.bumps.reward_vault],
            ];
            let signer = &[&seeds[..]];

            let cpi_accounts = TransferChecked {
                from: ctx.accounts.reward_vault.to_account_info(),
                to: ctx.accounts.treasury_token_account.to_account_info(),
                authority: ctx.accounts.reward_vault.to_account_info(),
                mint: ctx.accounts.stake_mint.to_account_info(),
            };

            let cpi_program = ctx.accounts.token_program.to_account_info();
            let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer);

            transfer_checked(cpi_ctx, remaining_balance, utils::DECIMALS)?;
        }

        Ok(())
    }

    pub fn update_normalization_k(ctx: Context<UpdateNormalizationK>, new_k: u128) -> Result<()> {
        require!(
            ctx.accounts.authority.key() == ctx.accounts.staking_pool.authority,
            StakingError::Unauthorized
        );

        require!(new_k > 0, StakingError::InvalidNormalizationK);

        let staking_pool = &mut ctx.accounts.staking_pool;
        let old_k = staking_pool.normalization_k;
        staking_pool.normalization_k = new_k;

        // Update daily rate with new normalization_k
        let clock = Clock::get()?;
        utils::update_daily_rate(staking_pool, clock.unix_timestamp)?;

        emit!(NormalizationKUpdatedEvent {
            old_k,
            new_k,
            timestamp: clock.unix_timestamp,
        });

        Ok(())
    }

    pub fn update_daily_rate_at_index(
        ctx: Context<UpdateDailyRate>,
        day_index: u64,
        new_rate: u64,
    ) -> Result<()> {
        require!(
            day_index < utils::MAX_DAILY_RATES as u64,
            StakingError::DayIndexOutOfBounds
        );

        let staking_pool = &mut ctx.accounts.staking_pool;
        
        // Ensure the daily_rates vector is large enough
        if staking_pool.daily_rates.len() <= day_index as usize {
            staking_pool.daily_rates.resize(day_index as usize + 1, 0);
        }

        staking_pool.daily_rates[day_index as usize] = new_rate;

        Ok(())
    }
}
