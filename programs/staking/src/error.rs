use anchor_lang::prelude::*;

// Errors
#[error_code]
pub enum StakingError {
    #[msg("Invalid staking duration")]
    InvalidDuration,
    #[msg("Reward pool exhausted")]
    RewardPoolExhausted,
    #[msg("Stake not active")]
    StakeNotActive,
    #[msg("No rewards available")]
    NoRewardsAvailable,
    #[msg("Unauthorized")]
    Unauthorized,
    #[msg("Overflow")]
    Overflow,
    #[msg("Underflow")]
    Underflow,
    #[msg("Division by zero")]
    DivisionByZero,
    #[msg("Program not ended")]
    ProgramNotEnded,
    #[msg("Day index out of bounds")]
    DayIndexOutOfBounds,
    #[msg("Invalid stake index")]
    InvalidStakeIndex,
    #[msg("Account not initialized")]
    AccountNotInitialized,
    #[msg("Stake entry already exists")]
    StakeEntryAlreadyExists,
    #[msg("Invalid normalization K value")]
    InvalidNormalizationK,
}