use anchor_lang::prelude::*;

// Events
#[event]
pub struct StakeEvent {
    pub user: Pubkey,
    pub amount: u64,
    pub duration_months: u8,
    pub timestamp: i64,
}

#[event]
pub struct ClaimEvent {
    pub user: Pubkey,
    pub amount: u64,
    pub timestamp: i64,
}

#[event]
pub struct UnstakeEvent {
    pub user: Pubkey,
    pub amount: u64,
    pub rewards: u64,
    pub timestamp: i64,
}

#[event]
pub struct ClaimAllEvent {
    pub user: Pubkey,
    pub total_amount: u64,
    pub stakes_count: u64,
    pub timestamp: i64,
}

#[event]
pub struct NormalizationKUpdatedEvent {
    pub old_k: u128,
    pub new_k: u128,
    pub timestamp: i64,
}