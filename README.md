# Solana Staking Program

A staking program on the Solana blockchain using Token 2022 that allows users to lock tokens for a specific period and earn rewards.

## Project Description

This staking contract implements a token locking system with dynamic APY (Annual Percentage Yield) calculation and weekly reward distribution. The contract uses a pre-funded reward pool instead of minting new tokens.

## Core Entities

### 1. StakingPool
The main entity that manages the entire staking system.

**Fields:**
- `authority` - program administrator's public key
- `stake_mint` - staking token mint
- `reward_mint` - reward token mint
- `total_staked` - total amount of staked tokens
- `total_rewards_distributed` - total amount of distributed rewards
- `last_update_time` - last update timestamp
- `program_start_time` - program start timestamp
- `program_end_date` - program end date
- `treasury_wallet` - treasury wallet address
- `daily_rates` - array of daily rates (up to 370 days)
- `last_rate_update_day` - day of last rate update

### 2. UserStakingAccount
User's overall staking account that tracks all their stakes.

**Fields:**
- `owner` - account owner
- `stake_count` - total number of stakes created by user
- `total_staked` - total amount currently staked (active stakes only)
- `total_claimed` - total amount of rewards claimed across all stakes

### 3. StakeEntry
Individual user's staking position.

**Fields:**
- `owner` - staking position owner
- `stake_index` - unique index for this stake (0, 1, 2, ...)
- `amount` - amount of staked tokens
- `start_time` - staking start time
- `duration_months` - duration in months (3, 6, 9, 12)
- `last_claim_time` - last reward claim time
- `last_claim_week` - last reward claim week
- `is_active` - whether position is active
- `total_claimed` - total amount of claimed rewards

### 4. Vault Accounts
- **Stake Vault** - repository for staked tokens
- **Reward Vault** - repository for reward tokens (pre-funded)

## Entity Relationships

```
StakingPool (1) ←→ (N) UserStakingAccount (1) ←→ (N) StakeEntry
                                ↓
                        Stake Vault + Reward Vault
                                ↓
                         Token Mints (Token 2022)
```

### Architecture Diagram:

```
┌─────────────────┐    ┌─────────────────┐
│   Stake Mint    │    │   Reward Mint   │
│   (Token 2022)  │    │   (Token 2022)  │
└─────────────────┘    └─────────────────┘
         │                       │
         ▼                       ▼
┌─────────────────┐    ┌─────────────────┐
│   Stake Vault   │    │  Reward Vault   │
│      (PDA)      │    │      (PDA)      │
└─────────────────┘    └─────────────────┘
         │                       │
         └───────┬───────────────┘
                 ▼
      ┌─────────────────┐
      │  Staking Pool   │
      │      (PDA)      │
      └─────────────────┘
                 │
                 ▼
      ┌─────────────────┐
      │  Stake Entries  │
      │ (User specific) │
      └─────────────────┘
```

## How It Works

### 1. Initialization
1. `StakingPool` is created with specified parameters
2. Vaults (`Stake Vault` and `Reward Vault`) are created
3. `Reward Vault` is pre-funded with reward tokens

### 2. Staking
1. User selects token amount and period (3, 6, 9, 12 months)
2. `UserStakingAccount` is created/updated to track user's stakes
3. Stake index is auto-calculated based on user's current stake count
4. Tokens are transferred to `Stake Vault`
5. `StakeEntry` is created with auto-calculated unique index for the user
6. `total_staked` in the pool and user account is updated

### 3. APY Calculation
APY is calculated dynamically using the formula:
```
APY = (R / (T + 1)) * 100 * (W / K)
```
where:
- R = available rewards
- T = total staked tokens
- W = weight multiplier (depends on duration)
- K = normalization factor (500)

**Weight Multipliers:**
- 3 months: 1.0x
- 6 months: 1.5x
- 9 months: 2.0x
- 12 months: 3.0x

### 4. Reward Distribution
- Rewards are calculated weekly
- Cannot claim rewards for the current week
- Rewards are transferred from the pre-funded `Reward Vault`
- Individual claim: claim rewards from a specific stake by index
- Batch claim: claim all available rewards from all active stakes in one transaction

### 5. Unstaking
- Users can unstake at any time
- Staked tokens + accumulated rewards are returned
- Position is deactivated

## Contract Usage

### Development Commands

```bash
# Build the program
anchor build

# Run tests
anchor test

# Deploy (locally)
anchor deploy
```

### Program Instructions

#### 1. Initialize
Initialize the staking pool:

```typescript
await program.methods
  .initialize(programEndDate, treasuryWallet)
  .accounts({
    authority: authority.publicKey,
    stakingPool: stakingPoolPDA,
    stakeMint: stakeMint,
    rewardMint: rewardMint,
    stakeVault: stakeVaultPDA,
    rewardVault: rewardVaultPDA,
    systemProgram: SystemProgram.programId,
    tokenProgram: TOKEN_2022_PROGRAM_ID,
    rent: SYSVAR_RENT_PUBKEY,
  })
  .signers([authority])
  .rpc();
```

#### 2. Stake
Stake tokens:

```typescript
await program.methods
  .stake(amount, durationMonths) // durationMonths: 3, 6, 9, or 12; stake index auto-calculated
  .accounts({
    user: user.publicKey,
    stakingPool: stakingPoolPDA,
    userStakingAccount: userStakingAccountPDA,
    stakeEntry: stakeEntryPDA,
    userTokenAccount: userTokenAccount,
    stakeVault: stakeVaultPDA,
    stakeMint: stakeMint,
    systemProgram: SystemProgram.programId,
    tokenProgram: TOKEN_2022_PROGRAM_ID,
    associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
    rent: SYSVAR_RENT_PUBKEY,
  })
  .signers([user])
  .rpc();
```

#### 3. Claim
Claim rewards from a specific stake:

```typescript
await program.methods
  .claim(stakeIndex) // Index of the stake to claim from
  .accounts({
    user: user.publicKey,
    stakingPool: stakingPoolPDA,
    userStakingAccount: userStakingAccountPDA,
    stakeEntry: stakeEntryPDA,
    userRewardAccount: userRewardAccount,
    rewardVault: rewardVaultPDA,
    rewardMint: rewardMint,
    systemProgram: SystemProgram.programId,
    tokenProgram: TOKEN_2022_PROGRAM_ID,
    associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
    rent: SYSVAR_RENT_PUBKEY,
  })
  .signers([user])
  .rpc();
```

#### 3.1. Claim All
Claim all available rewards from all active stakes at once:

```typescript
// Get all stake entries for the user
const userStakingAccount = await program.account.userStakingAccount.fetch(userStakingAccountPDA);
const stakeCount = userStakingAccount.stakeCount.toNumber();

// Create remaining accounts array with all stake entries
const remainingAccounts = [];
for (let i = 0; i < stakeCount; i++) {
  const [stakeEntryPDA] = await getStakeEntryPDA(user.publicKey, stakingPoolPDA, i);
  remainingAccounts.push({
    pubkey: stakeEntryPDA,
    isSigner: false,
    isWritable: true
  });
}

await program.methods
  .claimAll()
  .accounts({
    user: user.publicKey,
    stakingPool: stakingPoolPDA,
    userStakingAccount: userStakingAccountPDA,
    userRewardAccount: userRewardAccount,
    rewardVault: rewardVaultPDA,
    rewardMint: rewardMint,
    systemProgram: SystemProgram.programId,
    tokenProgram: TOKEN_2022_PROGRAM_ID,
    associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
    rent: SYSVAR_RENT_PUBKEY,
  })
  .remainingAccounts(remainingAccounts)
  .signers([user])
  .rpc();
```

#### 4. Unstake
Unstake tokens:

```typescript
await program.methods
  .unstake(stakeIndex) // Index of the stake to unstake
  .accounts({
    user: user.publicKey,
    stakingPool: stakingPoolPDA,
    userStakingAccount: userStakingAccountPDA,
    stakeEntry: stakeEntryPDA,
    userTokenAccount: userTokenAccount,
    userRewardAccount: userRewardAccount,
    stakeVault: stakeVaultPDA,
    rewardVault: rewardVaultPDA,
    stakeMint: stakeMint,
    rewardMint: rewardMint,
    systemProgram: SystemProgram.programId,
    tokenProgram: TOKEN_2022_PROGRAM_ID,
    associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
    rent: SYSVAR_RENT_PUBKEY,
  })
  .signers([user])
  .rpc();
```

#### 5. Close Program
Close the program (admin only after expiration):

```typescript
await program.methods
  .closeProgram()
  .accounts({
    stakingPool: stakingPoolPDA,
    authority: authority.publicKey,
    rewardVault: rewardVaultPDA,
    treasuryTokenAccount: treasuryTokenAccount,
    rewardMint: rewardMint,
    tokenProgram: TOKEN_2022_PROGRAM_ID,
  })
  .signers([authority])
  .rpc();
```

### Getting PDA Addresses

```typescript
// Staking Pool PDA
const [stakingPoolPDA] = await PublicKey.findProgramAddress(
  [Buffer.from("staking_pool"), stakeMint.toBuffer()],
  program.programId
);

// Stake Vault PDA
const [stakeVaultPDA] = await PublicKey.findProgramAddress(
  [Buffer.from("stake_vault"), stakeMint.toBuffer()],
  program.programId
);

// Reward Vault PDA
const [rewardVaultPDA] = await PublicKey.findProgramAddress(
  [Buffer.from("reward_vault"), rewardMint.toBuffer()],
  program.programId
);

// User Staking Account PDA
const [userStakingAccountPDA] = await PublicKey.findProgramAddress(
  [Buffer.from("user_staking"), user.publicKey.toBuffer(), stakingPoolPDA.toBuffer()],
  program.programId
);

// Stake Entry PDA (with index)
const getStakeEntryPDA = async (stakeIndex: number) => {
  const indexBuffer = Buffer.alloc(8);
  indexBuffer.writeUInt32LE(stakeIndex, 0);
  
  const [stakeEntryPDA] = await PublicKey.findProgramAddress(
    [Buffer.from("stake_entry"), user.publicKey.toBuffer(), stakingPoolPDA.toBuffer(), indexBuffer],
    program.programId
  );
  
  return stakeEntryPDA;
};

// Example: Get PDA for user's first stake (index 0)
const stakeEntry0PDA = await getStakeEntryPDA(0);
// Example: Get PDA for user's second stake (index 1)
const stakeEntry1PDA = await getStakeEntryPDA(1);
```

### Multiple Stakes Management

```typescript
// Get user's next available stake index
const getUserNextStakeIndex = async (userPublicKey: PublicKey) => {
  try {
    const userStakingAccount = await program.account.userStakingAccount.fetch(userStakingAccountPDA);
    return userStakingAccount.stakeCount.toNumber();
  } catch (error) {
    // User hasn't staked before
    return 0;
  }
};

// Get all user's stakes
const getAllUserStakes = async (userPublicKey: PublicKey) => {
  try {
    const userStakingAccount = await program.account.userStakingAccount.fetch(userStakingAccountPDA);
    const stakes = [];
    
    for (let i = 0; i < userStakingAccount.stakeCount.toNumber(); i++) {
      try {
        const stakeEntryPDA = await getStakeEntryPDA(i);
        const stakeEntry = await program.account.stakeEntry.fetch(stakeEntryPDA);
        stakes.push({
          index: i,
          pda: stakeEntryPDA,
          data: stakeEntry
        });
      } catch (error) {
        // Stake might not exist or be inaccessible
        continue;
      }
    }
    
    return stakes;
  } catch (error) {
    return [];
  }
};
```

## Economic Model

### Reward Pool
- Total pool: 250,000,000 tokens (with 6 decimal places)
- Monthly distribution: 20,833,333 tokens per month
- Program duration: 12 months

### Available rewards calculation by month:
- Month 0: 20,833,333 tokens
- Month 1: 41,666,667 tokens
- Month 2: 62,500,000 tokens
- ...
- Month 11+: 250,000,000 tokens (full pool)

## Security

### Access Controls
- Only owners can manage their staking positions
- Only admin can initialize and close the program
- Only admin can close the program after expiration

### Validation
- Validation of valid staking durations (3, 6, 9, 12 months)
- Validation of active staking positions
- Validation of sufficient funds in reward pool
- Protection against overflow and precision loss in arithmetic operations

### Program Errors
- `InvalidDuration` - invalid staking duration
- `RewardPoolExhausted` - reward pool exhausted
- `StakeNotActive` - staking position inactive
- `NoRewardsAvailable` - no rewards available
- `Unauthorized` - unauthorized access
- `ProgramNotEnded` - program not ended
- `InvalidStakeIndex` - invalid stake index (must be sequential)

## Requirements

- Rust 1.70+
- Solana CLI 1.16+
- Anchor Framework 0.29+
- Node.js 16+

## Testing

The project includes a comprehensive test suite covering:
- Program initialization
- Staking with different durations and auto-calculated indexes
- Multiple stakes per user
- Individual reward claiming from specific stakes
- Batch reward claiming from all stakes (claim_all)
- Unstaking specific stakes
- Error validation and security checks
- Multi-user scenarios
- Stake index validation and PDA verification
- Inactive stake handling

Run tests:
```bash
anchor test
```

## License

MIT License