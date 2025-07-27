use anchor_lang::prelude::*;
use anchor_lang::system_program;
use anchor_spl::token_interface::{Mint, TokenInterface, TokenAccount};
use anchor_spl::associated_token::AssociatedToken;

use crate::state::*;
use crate::error::StakingError;

// Contexts
#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    
    #[account(
        init,
        payer = authority,
        space = 8 + StakingPool::INIT_SPACE,
        seeds = [b"staking_pool", stake_mint.key().as_ref()],
        bump
    )]
    pub staking_pool: Account<'info, StakingPool>,
    
    pub stake_mint: InterfaceAccount<'info, Mint>,
    
    #[account(
        init,
        payer = authority,
        token::mint = stake_mint,
        token::authority = stake_vault,
        token::token_program = token_program,
        seeds = [b"stake_vault", stake_mint.key().as_ref()],
        bump,
    )]
    pub stake_vault: InterfaceAccount<'info, TokenAccount>,
    
    #[account(
        init,
        payer = authority,
        token::mint = stake_mint,
        token::authority = reward_vault,
        token::token_program = token_program,
        seeds = [b"reward_vault", stake_mint.key().as_ref()],
        bump,
    )]
    pub reward_vault: InterfaceAccount<'info, TokenAccount>,
    
    #[account(mut)]
    pub treasury_address: InterfaceAccount<'info, TokenAccount>,
    
    pub system_program: Program<'info, System>,
    pub token_program: Interface<'info, TokenInterface>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
#[instruction(amount: u64, duration_months: u8)]
pub struct Stake<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    
    #[account(
        mut,
        seeds = [b"staking_pool", stake_mint.key().as_ref()],
        bump,
    )]
    pub staking_pool: Account<'info, StakingPool>,
    
    #[account(
        init_if_needed,
        payer = user,
        space = 8 + UserStakingAccount::INIT_SPACE,
        seeds = [
            b"user_staking",
            user.key().as_ref(),
            staking_pool.key().as_ref()
        ],
        bump
    )]
    pub user_staking_account: Account<'info, UserStakingAccount>,
    
    /// CHECK: This account will be initialized manually in the instruction
    #[account(
        mut,
        constraint = stake_entry.to_account_info().owner == &system_program::ID @ StakingError::StakeEntryAlreadyExists,
        constraint = stake_entry.to_account_info().lamports() == 0 @ StakingError::StakeEntryAlreadyExists
    )]
    pub stake_entry: AccountInfo<'info>,
    
    #[account(
        init_if_needed,
        payer = user,
        associated_token::mint = stake_mint,
        associated_token::authority = user,
        associated_token::token_program = token_program,
    )]
    pub user_token_account: InterfaceAccount<'info, TokenAccount>,
    
    #[account(
        mut,
        seeds = [b"stake_vault", stake_mint.key().as_ref()],
        bump,
    )]
    pub stake_vault: InterfaceAccount<'info, TokenAccount>,
    
    pub stake_mint: InterfaceAccount<'info, Mint>,
    
    pub system_program: Program<'info, System>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
#[instruction(stake_index: u64)]
pub struct Unstake<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    
    #[account(
        mut,
        seeds = [b"staking_pool", stake_mint.key().as_ref()],
        bump,
    )]
    pub staking_pool: Account<'info, StakingPool>,
    
    #[account(
        mut,
        seeds = [
            b"user_staking",
            user.key().as_ref(),
            staking_pool.key().as_ref()
        ],
        bump
    )]
    pub user_staking_account: Account<'info, UserStakingAccount>,
    
    #[account(
        mut,
        seeds = [
            b"stake_entry",
            user.key().as_ref(),
            staking_pool.key().as_ref(),
            &stake_index.to_le_bytes()
        ],
        bump,
        constraint = stake_entry.owner == user.key() @ StakingError::Unauthorized
    )]
    pub stake_entry: Account<'info, StakeEntry>,
    
    #[account(
        mut,
        associated_token::mint = stake_mint,
        associated_token::authority = user,
        associated_token::token_program = token_program,
    )]
    pub user_token_account: InterfaceAccount<'info, TokenAccount>,
    
    #[account(
        init_if_needed,
        payer = user,
        associated_token::mint = stake_mint,
        associated_token::authority = user,
        associated_token::token_program = token_program,
    )]
    pub user_reward_account: InterfaceAccount<'info, TokenAccount>,
    
    #[account(
        mut,
        seeds = [b"stake_vault", stake_mint.key().as_ref()],
        bump,
    )]
    pub stake_vault: InterfaceAccount<'info, TokenAccount>,
    
    #[account(
        mut,
        seeds = [b"reward_vault", stake_mint.key().as_ref()],
        bump,
    )]
    pub reward_vault: InterfaceAccount<'info, TokenAccount>,
    
    #[account(
        mut,
        constraint = treasury_token_account.key() == staking_pool.treasury_address,
    )]
    pub treasury_token_account: InterfaceAccount<'info, TokenAccount>,
    
    pub stake_mint: InterfaceAccount<'info, Mint>,
    
    pub system_program: Program<'info, System>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct CloseProgram<'info> {
    #[account(
        mut,
        has_one = authority,
        seeds = [b"staking_pool", staking_pool.stake_mint.as_ref()],
        bump,
    )]
    pub staking_pool: Account<'info, StakingPool>,
    
    pub authority: Signer<'info>,
    
    #[account(
        mut,
        seeds = [b"reward_vault", stake_mint.key().as_ref()],
        bump,
    )]
    pub reward_vault: InterfaceAccount<'info, TokenAccount>,
    
    #[account(
        mut,
        constraint = treasury_token_account.key() == staking_pool.treasury_address,
    )]
    pub treasury_token_account: InterfaceAccount<'info, TokenAccount>,
    
    pub stake_mint: InterfaceAccount<'info, Mint>,
    
    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
pub struct ClaimAll<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    
    #[account(
        mut,
        seeds = [b"staking_pool", staking_pool.stake_mint.as_ref()],
        bump,
    )]
    pub staking_pool: Account<'info, StakingPool>,
    
    #[account(
        mut,
        seeds = [
            b"user_staking",
            user.key().as_ref(),
            staking_pool.key().as_ref()
        ],
        bump
    )]
    pub user_staking_account: Account<'info, UserStakingAccount>,
    
    #[account(
        init_if_needed,
        payer = user,
        associated_token::mint = stake_mint,
        associated_token::authority = user,
        associated_token::token_program = token_program,
    )]
    pub user_reward_account: InterfaceAccount<'info, TokenAccount>,
    
    #[account(
        mut,
        seeds = [b"reward_vault", stake_mint.key().as_ref()],
        bump,
    )]
    pub reward_vault: InterfaceAccount<'info, TokenAccount>,
    
    pub stake_mint: InterfaceAccount<'info, Mint>,
    
    pub system_program: Program<'info, System>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub rent: Sysvar<'info, Rent>,
    
    // Remaining accounts: StakeEntry accounts in index order (0, 1, 2, ...)
}

#[derive(Accounts)]
pub struct GetTotalClaimableRewards<'info> {
    /// CHECK: Только для чтения, не подписывает транзакцию
    pub user: AccountInfo<'info>,
    
    #[account(
        seeds = [b"staking_pool", staking_pool.stake_mint.as_ref()],
        bump,
    )]
    pub staking_pool: Account<'info, StakingPool>,
    
    // Remaining accounts: StakeEntry accounts
}

#[derive(Accounts)]
pub struct UpdateNormalizationK<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    
    #[account(
        mut,
        seeds = [b"staking_pool", staking_pool.stake_mint.as_ref()],
        bump,
    )]
    pub staking_pool: Account<'info, StakingPool>,
}

#[derive(Accounts)]
pub struct UpdateDailyRate<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    
    #[account(
        mut,
        seeds = [b"staking_pool", staking_pool.stake_mint.as_ref()],
        bump,
        constraint = staking_pool.authority == authority.key() @ StakingError::Unauthorized
    )]
    pub staking_pool: Account<'info, StakingPool>,
}