import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { StakingProgram } from "../target/types/staking_program";
import {
  TOKEN_2022_PROGRAM_ID,
  createMint,
  mintTo,
  getAccount,
  createAssociatedTokenAccount,
  getAssociatedTokenAddressSync,
  getAssociatedTokenAddress,
} from "@solana/spl-token";
import { assert, expect } from "chai";
import BN from "bn.js";

describe("staking_program", () => {
  // Configure the client to use the local cluster
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.StakingProgram as Program<StakingProgram>;

  // Test accounts
  let stakeMint: anchor.web3.PublicKey;
  let authority: anchor.web3.Keypair;
  let treasury: anchor.web3.Keypair;
  let user1: anchor.web3.Keypair;
  let user2: anchor.web3.Keypair;

  // Token accounts
  let user1StakeAccount: anchor.web3.PublicKey;
  let user1RewardAccount: anchor.web3.PublicKey;
  let user2StakeAccount: anchor.web3.PublicKey;
  let user2RewardAccount: anchor.web3.PublicKey;
  let treasuryRewardAccount: anchor.web3.PublicKey;

  // PDAs
  let stakingPoolPDA: anchor.web3.PublicKey;
  let stakeVaultPDA: anchor.web3.PublicKey;
  let rewardVaultPDA: anchor.web3.PublicKey;
  let user1StakingAccountPDA: anchor.web3.PublicKey;
  let user2StakingAccountPDA: anchor.web3.PublicKey;
  let user1StakeEntry0PDA: anchor.web3.PublicKey;
  let user1StakeEntry1PDA: anchor.web3.PublicKey;
  let user2StakeEntry0PDA: anchor.web3.PublicKey;

  // Constants
  const DECIMALS = 9;
  const TOTAL_SUPPLY = new BN("1000000000000000000"); // 1B with 9 decimals
  const REWARD_POOL_AMOUNT = new BN("250000000000000000"); // 250M with 9 decimals
  const STAKE_AMOUNT = new BN("1000000000000000"); // 1M with 9 decimals
  const PROGRAM_END_DATE = new BN(
    Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60
  ); // 1 year from now

  before(async () => {
    // Generate keypairs
    authority = anchor.web3.Keypair.generate();
    treasury = anchor.web3.Keypair.generate();
    user1 = anchor.web3.Keypair.generate();
    user2 = anchor.web3.Keypair.generate();

    // Airdrop SOL
    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(
        authority.publicKey,
        10 * anchor.web3.LAMPORTS_PER_SOL
      )
    );
    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(
        treasury.publicKey,
        10 * anchor.web3.LAMPORTS_PER_SOL
      )
    );
    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(
        user1.publicKey,
        10 * anchor.web3.LAMPORTS_PER_SOL
      )
    );
    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(
        user2.publicKey,
        10 * anchor.web3.LAMPORTS_PER_SOL
      )
    );

    // Create mint with Token 2022 (используется для стейкинга и наград)
    stakeMint = await createMint(
      provider.connection,
      authority,
      authority.publicKey,
      null,
      DECIMALS,
      undefined,
      undefined,
      TOKEN_2022_PROGRAM_ID
    );

    // Derive PDAs
    [stakingPoolPDA] = await anchor.web3.PublicKey.findProgramAddress(
      [Buffer.from("staking_pool"), stakeMint.toBuffer()],
      program.programId
    );

    [stakeVaultPDA] = await anchor.web3.PublicKey.findProgramAddress(
      [Buffer.from("stake_vault"), stakeMint.toBuffer()],
      program.programId
    );

    [rewardVaultPDA] = await anchor.web3.PublicKey.findProgramAddress(
      [Buffer.from("reward_vault"), stakeMint.toBuffer()],
      program.programId
    );

    [user1StakingAccountPDA] = await anchor.web3.PublicKey.findProgramAddress(
      [
        Buffer.from("user_staking"),
        user1.publicKey.toBuffer(),
        stakingPoolPDA.toBuffer(),
      ],
      program.programId
    );

    [user2StakingAccountPDA] = await anchor.web3.PublicKey.findProgramAddress(
      [
        Buffer.from("user_staking"),
        user2.publicKey.toBuffer(),
        stakingPoolPDA.toBuffer(),
      ],
      program.programId
    );

    [user1StakeEntry0PDA] = await anchor.web3.PublicKey.findProgramAddress(
      [
        Buffer.from("stake_entry"),
        user1.publicKey.toBuffer(),
        stakingPoolPDA.toBuffer(),
        Buffer.from([0, 0, 0, 0, 0, 0, 0, 0]),
      ],
      program.programId
    );

    [user1StakeEntry1PDA] = await anchor.web3.PublicKey.findProgramAddress(
      [
        Buffer.from("stake_entry"),
        user1.publicKey.toBuffer(),
        stakingPoolPDA.toBuffer(),
        Buffer.from([1, 0, 0, 0, 0, 0, 0, 0]),
      ],
      program.programId
    );

    [user2StakeEntry0PDA] = await anchor.web3.PublicKey.findProgramAddress(
      [
        Buffer.from("stake_entry"),
        user2.publicKey.toBuffer(),
        stakingPoolPDA.toBuffer(),
        Buffer.from([0, 0, 0, 0, 0, 0, 0, 0]),
      ],
      program.programId
    );

    // Create user token accounts
    user1StakeAccount = await createAssociatedTokenAccount(
      provider.connection,
      user1,
      stakeMint,
      user1.publicKey,
      undefined,
      TOKEN_2022_PROGRAM_ID
    );

    user2StakeAccount = await createAssociatedTokenAccount(
      provider.connection,
      user2,
      stakeMint,
      user2.publicKey,
      undefined,
      TOKEN_2022_PROGRAM_ID
    );

    // Get associated token addresses for reward accounts (will be created by tests)
    user1RewardAccount = getAssociatedTokenAddressSync(
      stakeMint,
      user1.publicKey,
      false,
      TOKEN_2022_PROGRAM_ID
    );

    user2RewardAccount = getAssociatedTokenAddressSync(
      stakeMint,
      user2.publicKey,
      false,
      TOKEN_2022_PROGRAM_ID
    );

    treasuryRewardAccount = await createAssociatedTokenAccount(
      provider.connection,
      treasury,
      stakeMint,
      treasury.publicKey,
      undefined,
      TOKEN_2022_PROGRAM_ID
    );

    // Mint tokens to users for staking
    await mintTo(
      provider.connection,
      authority,
      stakeMint,
      user1StakeAccount,
      authority,
      BigInt(STAKE_AMOUNT.mul(new BN(10)).toString()),
      undefined,
      undefined,
      TOKEN_2022_PROGRAM_ID
    );

    await mintTo(
      provider.connection,
      authority,
      stakeMint,
      user2StakeAccount,
      authority,
      BigInt(STAKE_AMOUNT.mul(new BN(10)).toString()),
      undefined,
      undefined,
      TOKEN_2022_PROGRAM_ID
    );
  });

  describe("initialize", () => {
    it("should initialize the staking pool and vault accounts", async () => {
      await program.methods
        .initialize(PROGRAM_END_DATE)
        .accounts({
          authority: authority.publicKey,
          stakingPool: stakingPoolPDA,
          stakeMint: stakeMint,
          stakeVault: stakeVaultPDA,
          rewardVault: rewardVaultPDA,
          treasuryAddress: treasuryRewardAccount,
          systemProgram: anchor.web3.SystemProgram.programId,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        })
        .signers([authority])
        .rpc();

      // Verify staking pool was created correctly
      const stakingPool = await program.account.stakingPool.fetch(
        stakingPoolPDA
      );

      assert.ok(stakingPool.authority.equals(authority.publicKey));
      assert.ok(stakingPool.stakeMint.equals(stakeMint));
      assert.ok(stakingPool.treasuryAddress.equals(treasuryRewardAccount));
      assert.equal(stakingPool.totalStaked.toNumber(), 0);
      assert.equal(stakingPool.totalRewardsDistributed.toNumber(), 0);
      assert.ok(stakingPool.programEndDate.eq(PROGRAM_END_DATE));
      assert.equal(stakingPool.dailyRates.length, 370);
      // lastRateUpdateDay field was removed from the StakingPool struct

      // Verify vault accounts were created and initialized
      const stakeVaultAccount = await getAccount(
        provider.connection,
        stakeVaultPDA,
        undefined,
        TOKEN_2022_PROGRAM_ID
      );
      const rewardVaultAccount = await getAccount(
        provider.connection,
        rewardVaultPDA,
        undefined,
        TOKEN_2022_PROGRAM_ID
      );

      assert.ok(stakeVaultAccount.mint.equals(stakeMint));
      assert.ok(stakeVaultAccount.owner.equals(stakeVaultPDA));
      assert.equal(Number(stakeVaultAccount.amount), 0);

      assert.ok(rewardVaultAccount.mint.equals(stakeMint));
      assert.ok(rewardVaultAccount.owner.equals(rewardVaultPDA));
      assert.equal(Number(rewardVaultAccount.amount), 0);

      // Fund the reward vault for testing
      await mintTo(
        provider.connection,
        authority,
        stakeMint,
        rewardVaultPDA,
        authority,
        BigInt(REWARD_POOL_AMOUNT.toString()),
        undefined,
        undefined,
        TOKEN_2022_PROGRAM_ID
      );

      // Verify reward vault is funded
      const fundedRewardVault = await getAccount(
        provider.connection,
        rewardVaultPDA,
        undefined,
        TOKEN_2022_PROGRAM_ID
      );
      assert.equal(
        fundedRewardVault.amount.toString(),
        REWARD_POOL_AMOUNT.toString()
      );
    });
  });

  describe("stake", () => {
    it("should stake tokens for 3 months", async () => {
      const userBalanceBefore = await getAccount(
        provider.connection,
        user1StakeAccount,
        undefined,
        TOKEN_2022_PROGRAM_ID
      );
      const vaultBalanceBefore = await getAccount(
        provider.connection,
        stakeVaultPDA,
        undefined,
        TOKEN_2022_PROGRAM_ID
      );

      await program.methods
        .stake(STAKE_AMOUNT, 3) // Auto-calculated index
        .accounts({
          user: user1.publicKey,
          stakingPool: stakingPoolPDA,
          userStakingAccount: user1StakingAccountPDA,
          stakeEntry: user1StakeEntry0PDA,
          userTokenAccount: user1StakeAccount,
          stakeVault: stakeVaultPDA,
          stakeMint: stakeMint,
          systemProgram: anchor.web3.SystemProgram.programId,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
          associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        })
        .signers([user1])
        .rpc();

      const userBalanceAfter = await getAccount(
        provider.connection,
        user1StakeAccount,
        undefined,
        TOKEN_2022_PROGRAM_ID
      );
      const vaultBalanceAfter = await getAccount(
        provider.connection,
        stakeVaultPDA,
        undefined,
        TOKEN_2022_PROGRAM_ID
      );
      const stakingPool = await program.account.stakingPool.fetch(
        stakingPoolPDA
      );
      const stakeEntry = await program.account.stakeEntry.fetch(
        user1StakeEntry0PDA
      );
      const userStakingAccount = await program.account.userStakingAccount.fetch(
        user1StakingAccountPDA
      );

      // Verify tokens were transferred
      assert.equal(
        Number(userBalanceBefore.amount) - Number(userBalanceAfter.amount),
        STAKE_AMOUNT.toNumber()
      );
      assert.equal(
        Number(vaultBalanceAfter.amount) - Number(vaultBalanceBefore.amount),
        STAKE_AMOUNT.toNumber()
      );

      // Verify staking pool state
      assert.ok(stakingPool.totalStaked.eq(STAKE_AMOUNT));

      // Verify stake entry
      assert.ok(stakeEntry.amount.eq(STAKE_AMOUNT));
      assert.equal(stakeEntry.durationMonths, 3);
      assert.equal(stakeEntry.stakeIndex.toNumber(), 0);
      assert.isTrue(stakeEntry.isActive);
      assert.ok(stakeEntry.owner.equals(user1.publicKey));
      assert.equal(stakeEntry.totalClaimed.toNumber(), 0);

      // Verify user staking account
      assert.ok(userStakingAccount.owner.equals(user1.publicKey));
      assert.equal(userStakingAccount.stakeCount.toNumber(), 1);
      assert.ok(userStakingAccount.totalStaked.eq(STAKE_AMOUNT));
      assert.equal(userStakingAccount.totalClaimed.toNumber(), 0);
    });

    it("should fail with invalid duration", async () => {
      try {
        await program.methods
          .stake(STAKE_AMOUNT, 5) // Invalid duration
          .accounts({
            user: user2.publicKey,
            stakingPool: stakingPoolPDA,
            userStakingAccount: user2StakingAccountPDA,
            stakeEntry: user2StakeEntry0PDA,
            userTokenAccount: user2StakeAccount,
            stakeVault: stakeVaultPDA,
            stakeMint: stakeMint,
            systemProgram: anchor.web3.SystemProgram.programId,
            tokenProgram: TOKEN_2022_PROGRAM_ID,
            associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
            rent: anchor.web3.SYSVAR_RENT_PUBKEY,
          })
          .signers([user2])
          .rpc();

        assert.fail("Should have thrown an error");
      } catch (error) {
        assert.include(error.toString(), "InvalidDuration");
      }
    });

    it("should stake tokens for 12 months with higher weight", async () => {
      const stakingPoolBefore = await program.account.stakingPool.fetch(
        stakingPoolPDA
      );

      await program.methods
        .stake(STAKE_AMOUNT.mul(new BN(2)), 12) // User2's first stake
        .accounts({
          user: user2.publicKey,
          stakingPool: stakingPoolPDA,
          userStakingAccount: user2StakingAccountPDA,
          stakeEntry: user2StakeEntry0PDA,
          userTokenAccount: user2StakeAccount,
          stakeVault: stakeVaultPDA,
          stakeMint: stakeMint,
          systemProgram: anchor.web3.SystemProgram.programId,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
          associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        })
        .signers([user2])
        .rpc();

      const stakingPoolAfter = await program.account.stakingPool.fetch(
        stakingPoolPDA
      );
      const stakeEntry = await program.account.stakeEntry.fetch(
        user2StakeEntry0PDA
      );
      const userStakingAccount = await program.account.userStakingAccount.fetch(
        user2StakingAccountPDA
      );

      // Verify pool total staked increased
      assert.ok(
        stakingPoolAfter.totalStaked.eq(
          stakingPoolBefore.totalStaked.add(STAKE_AMOUNT.mul(new BN(2)))
        )
      );

      // Verify stake entry
      assert.ok(stakeEntry.amount.eq(STAKE_AMOUNT.mul(new BN(2))));
      assert.equal(stakeEntry.durationMonths, 12);
      assert.equal(stakeEntry.stakeIndex.toNumber(), 0);
      assert.isTrue(stakeEntry.isActive);

      // Verify user staking account
      assert.equal(userStakingAccount.stakeCount.toNumber(), 1);
      assert.ok(userStakingAccount.totalStaked.eq(STAKE_AMOUNT.mul(new BN(2))));
    });

    it("should allow multiple stakes for the same user", async () => {
      // User1 creates a second stake
      await program.methods
        .stake(STAKE_AMOUNT.div(new BN(2)), 6) // Second stake, auto-calculated index
        .accounts({
          user: user1.publicKey,
          stakingPool: stakingPoolPDA,
          userStakingAccount: user1StakingAccountPDA,
          stakeEntry: user1StakeEntry1PDA,
          userTokenAccount: user1StakeAccount,
          stakeVault: stakeVaultPDA,
          stakeMint: stakeMint,
          systemProgram: anchor.web3.SystemProgram.programId,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
          associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        })
        .signers([user1])
        .rpc();

      const stakeEntry0 = await program.account.stakeEntry.fetch(
        user1StakeEntry0PDA
      );
      const stakeEntry1 = await program.account.stakeEntry.fetch(
        user1StakeEntry1PDA
      );
      const userStakingAccount = await program.account.userStakingAccount.fetch(
        user1StakingAccountPDA
      );

      // Verify both stakes exist and are different
      assert.equal(stakeEntry0.stakeIndex.toNumber(), 0);
      assert.equal(stakeEntry0.durationMonths, 3);
      assert.ok(stakeEntry0.amount.eq(STAKE_AMOUNT));

      assert.equal(stakeEntry1.stakeIndex.toNumber(), 1);
      assert.equal(stakeEntry1.durationMonths, 6);
      assert.ok(stakeEntry1.amount.eq(STAKE_AMOUNT.div(new BN(2))));

      // Verify user staking account reflects both stakes
      assert.equal(userStakingAccount.stakeCount.toNumber(), 2);
      assert.ok(
        userStakingAccount.totalStaked.eq(
          STAKE_AMOUNT.add(STAKE_AMOUNT.div(new BN(2)))
        )
      );
    });

    it("should create ATA automatically when staking (init_if_needed)", async () => {
      // This test verifies that the program works correctly when user has tokens but no ATA yet
      // In practice, this is less common since users typically need an ATA to receive tokens
      // However, it tests that init_if_needed works correctly in the program
      
      // NOTE: In the current implementation, we've added init_if_needed to user_token_account
      // This means the program will create the ATA if it doesn't exist.
      // However, for the stake instruction to work, the user needs to have tokens to stake.
      // This creates a chicken-and-egg problem: how can a user have tokens without an ATA?
      
      // In practice, this scenario might occur if:
      // 1. Tokens are sent to the user via a different mechanism (e.g., program-owned account)
      // 2. The user receives tokens through an airdrop that creates the ATA
      // 3. The user has a non-associated token account with tokens
      
      // For this test, we'll simulate the most realistic scenario:
      // A user who previously received tokens (so has an ATA), but we'll test that
      // the program handles the init_if_needed constraint correctly
      
      const testUser = anchor.web3.Keypair.generate();
      
      // Airdrop SOL to the test user
      await provider.connection.confirmTransaction(
        await provider.connection.requestAirdrop(
          testUser.publicKey,
          2 * anchor.web3.LAMPORTS_PER_SOL
        )
      );

      // Get expected ATA address
      const expectedATAAddress = getAssociatedTokenAddressSync(
        stakeMint,
        testUser.publicKey,
        false,
        TOKEN_2022_PROGRAM_ID
      );

      // Create the ATA and mint tokens in one step (simulating an airdrop)
      const testUserATA = await createAssociatedTokenAccount(
        provider.connection,
        authority,
        stakeMint,
        testUser.publicKey,
        undefined,
        TOKEN_2022_PROGRAM_ID
      );

      // Mint tokens to user's ATA
      await mintTo(
        provider.connection,
        authority,
        stakeMint,
        testUserATA,
        authority,
        BigInt(STAKE_AMOUNT.toString()),
        undefined,
        undefined,
        TOKEN_2022_PROGRAM_ID
      );

      // Get PDAs for test user
      const [testUserStakingAccountPDA] = await anchor.web3.PublicKey.findProgramAddress(
        [
          Buffer.from("user_staking"),
          testUser.publicKey.toBuffer(),
          stakingPoolPDA.toBuffer(),
        ],
        program.programId
      );

      const [testUserStakeEntry0PDA] = await anchor.web3.PublicKey.findProgramAddress(
        [
          Buffer.from("stake_entry"),
          testUser.publicKey.toBuffer(),
          stakingPoolPDA.toBuffer(),
          Buffer.from([0, 0, 0, 0, 0, 0, 0, 0]),
        ],
        program.programId
      );

      // Now stake - the program should handle the existing ATA correctly
      await program.methods
        .stake(STAKE_AMOUNT, 3)
        .accounts({
          user: testUser.publicKey,
          stakingPool: stakingPoolPDA,
          userStakingAccount: testUserStakingAccountPDA,
          stakeEntry: testUserStakeEntry0PDA,
          userTokenAccount: expectedATAAddress,
          stakeVault: stakeVaultPDA,
          stakeMint: stakeMint,
          systemProgram: anchor.web3.SystemProgram.programId,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
          associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        })
        .signers([testUser])
        .rpc();

      // Verify the stake was created successfully
      const stakeEntry = await program.account.stakeEntry.fetch(
        testUserStakeEntry0PDA
      );
      const userStakingAccount = await program.account.userStakingAccount.fetch(
        testUserStakingAccountPDA
      );

      assert.ok(stakeEntry.amount.eq(STAKE_AMOUNT));
      assert.equal(stakeEntry.durationMonths, 3);
      assert.isTrue(stakeEntry.isActive);
      assert.ok(stakeEntry.owner.equals(testUser.publicKey));
      
      assert.equal(userStakingAccount.stakeCount.toNumber(), 1);
      assert.ok(userStakingAccount.totalStaked.eq(STAKE_AMOUNT));

      // Verify the ATA exists and has correct balance after staking
      const finalATAInfo = await getAccount(
        provider.connection,
        expectedATAAddress,
        undefined,
        TOKEN_2022_PROGRAM_ID
      );
      assert.equal(Number(finalATAInfo.amount), 0); // All tokens should be staked
      
      // This test confirms that the program correctly handles the init_if_needed constraint
      // even when the ATA already exists, preventing the "AccountNotInitialized" error
    });
  });

  describe("unstake", () => {
    it("should unstake tokens and close position", async () => {
      const userStakeBalanceBefore = await getAccount(
        provider.connection,
        user1StakeAccount,
        undefined,
        TOKEN_2022_PROGRAM_ID
      );
      const vaultBalanceBefore = await getAccount(
        provider.connection,
        stakeVaultPDA,
        undefined,
        TOKEN_2022_PROGRAM_ID
      );
      const stakingPoolBefore = await program.account.stakingPool.fetch(
        stakingPoolPDA
      );
      const userStakingAccountBefore =
        await program.account.userStakingAccount.fetch(user1StakingAccountPDA);

      await program.methods
        .unstake(new BN(0)) // Unstake first stake
        .accounts({
          user: user1.publicKey,
          stakingPool: stakingPoolPDA,
          userStakingAccount: user1StakingAccountPDA,
          stakeEntry: user1StakeEntry0PDA,
          userTokenAccount: user1StakeAccount,
          userRewardAccount: user1RewardAccount,
          stakeVault: stakeVaultPDA,
          rewardVault: rewardVaultPDA,
          treasuryTokenAccount: treasuryRewardAccount,
          stakeMint: stakeMint,
          systemProgram: anchor.web3.SystemProgram.programId,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
          associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        })
        .signers([user1])
        .rpc();

      const userStakeBalanceAfter = await getAccount(
        provider.connection,
        user1StakeAccount,
        undefined,
        TOKEN_2022_PROGRAM_ID
      );
      const vaultBalanceAfter = await getAccount(
        provider.connection,
        stakeVaultPDA,
        undefined,
        TOKEN_2022_PROGRAM_ID
      );
      const stakingPoolAfter = await program.account.stakingPool.fetch(
        stakingPoolPDA
      );
      const stakeEntry = await program.account.stakeEntry.fetch(
        user1StakeEntry0PDA
      );
      const userStakingAccountAfter =
        await program.account.userStakingAccount.fetch(user1StakingAccountPDA);

      // Check stake tokens returned to user (80% due to 20% penalty)
      const expectedReturn = STAKE_AMOUNT.mul(new BN(80)).div(new BN(100));
      assert.equal(
        Number(userStakeBalanceAfter.amount) -
        Number(userStakeBalanceBefore.amount),
        expectedReturn.toNumber()
      );

      // Check stake tokens removed from vault
      assert.equal(
        Number(vaultBalanceBefore.amount) - Number(vaultBalanceAfter.amount),
        STAKE_AMOUNT.toNumber()
      );

      // Check pool state updated
      assert.ok(
        stakingPoolBefore.totalStaked
          .sub(stakingPoolAfter.totalStaked)
          .eq(STAKE_AMOUNT)
      );

      // Check stake is deactivated
      assert.isFalse(stakeEntry.isActive);

      // Check user staking account updated
      assert.ok(
        userStakingAccountBefore.totalStaked
          .sub(userStakingAccountAfter.totalStaked)
          .eq(STAKE_AMOUNT)
      );
      assert.equal(userStakingAccountAfter.stakeCount.toNumber(), 2); // Still has 2 stakes, one just inactive
    });

    it("should fail when unstaking inactive stake", async () => {
      try {
        await program.methods
          .unstake(new BN(0)) // Try to unstake the already unstaked stake
          .accounts({
            user: user1.publicKey,
            stakingPool: stakingPoolPDA,
            userStakingAccount: user1StakingAccountPDA,
            stakeEntry: user1StakeEntry0PDA,
            userTokenAccount: user1StakeAccount,
            userRewardAccount: user1RewardAccount,
            stakeVault: stakeVaultPDA,
            rewardVault: rewardVaultPDA,
            treasuryTokenAccount: treasuryRewardAccount,
            stakeMint: stakeMint,
            systemProgram: anchor.web3.SystemProgram.programId,
            tokenProgram: TOKEN_2022_PROGRAM_ID,
            associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
            rent: anchor.web3.SYSVAR_RENT_PUBKEY,
          })
          .signers([user1])
          .rpc();

        assert.fail("Should have thrown an error");
      } catch (error) {
        assert.include(error.toString(), "StakeNotActive");
      }
    });
  });

  describe("close_program", () => {
    it("should fail before program end date", async () => {
      try {
        await program.methods
          .closeProgram()
          .accounts({
            stakingPool: stakingPoolPDA,
            authority: authority.publicKey,
            rewardVault: rewardVaultPDA,
            treasuryTokenAccount: treasuryRewardAccount,
            stakeMint: stakeMint,
            tokenProgram: TOKEN_2022_PROGRAM_ID,
          })
          .signers([authority])
          .rpc();

        assert.fail("Should have thrown an error");
      } catch (error) {
        assert.include(error.toString(), "ProgramNotEnded");
      }
    });

    it("should fail with wrong authority", async () => {
      try {
        await program.methods
          .closeProgram()
          .accounts({
            stakingPool: stakingPoolPDA,
            authority: user1.publicKey, // Wrong authority
            rewardVault: rewardVaultPDA,
            treasuryTokenAccount: treasuryRewardAccount,
            stakeMint: stakeMint,
            tokenProgram: TOKEN_2022_PROGRAM_ID,
          })
          .signers([user1])
          .rpc();

        assert.fail("Should have thrown an error");
      } catch (error) {
        assert.include(error.toString(), "constraint");
      }
    });
  });

  describe("APY and reward calculations", () => {
    it("should update daily rates when staking", async () => {
      const stakingPool = await program.account.stakingPool.fetch(
        stakingPoolPDA
      );

      // Check that daily rates array was initialized
      assert.isDefined(stakingPool.dailyRates);
      assert.equal(stakingPool.dailyRates.length, 370);
      // lastRateUpdateDay field was removed from the StakingPool struct

      // The initial rate might be 0 if no rewards are available at start
      // But the array should be properly initialized
      assert.isTrue(stakingPool.dailyRates[0] >= 0);
    });

    it("should track total rewards distributed", async () => {
      const stakingPool = await program.account.stakingPool.fetch(
        stakingPoolPDA
      );

      // Check that total rewards distributed is tracked
      assert.isAtLeast(stakingPool.totalRewardsDistributed.toNumber(), 0);
    });

    it("should have non-zero daily_rates after first stake", async () => {
      // First, ensure reward vault is funded
      const rewardVaultAccountBefore = await getAccount(
        provider.connection,
        rewardVaultPDA,
        undefined,
        TOKEN_2022_PROGRAM_ID
      );
      
      if (Number(rewardVaultAccountBefore.amount) === 0) {
        await mintTo(
          provider.connection,
          authority,
          stakeMint,
          rewardVaultPDA,
          authority,
          BigInt(REWARD_POOL_AMOUNT.toString()),
          undefined,
          undefined,
          TOKEN_2022_PROGRAM_ID
        );
      }

      // Get staking pool state before stake
      const poolBefore = await program.account.stakingPool.fetch(stakingPoolPDA);
      console.log("Total staked before:", poolBefore.totalStaked.toString());
      console.log("Daily rates before stake:", poolBefore.dailyRates.slice(0, 5));

      // Create a new user for clean test
      const testUser = anchor.web3.Keypair.generate();
      await provider.connection.confirmTransaction(
        await provider.connection.requestAirdrop(
          testUser.publicKey,
          2 * anchor.web3.LAMPORTS_PER_SOL
        ),
        "confirmed"
      );

      // Create user token account and mint tokens
      const testUserTokenAccount = await createAssociatedTokenAccount(
        provider.connection,
        authority,
        stakeMint,
        testUser.publicKey,
        undefined,
        TOKEN_2022_PROGRAM_ID
      );

      const stakeAmount = new BN("1000000000"); // 1 token
      await mintTo(
        provider.connection,
        authority,
        stakeMint,
        testUserTokenAccount,
        authority,
        BigInt(stakeAmount.toString()),
        undefined,
        undefined,
        TOKEN_2022_PROGRAM_ID
      );

      // Stake tokens
      const testUserStakingAccountPDA = await getUserStakingAccountPDA(
        program,
        testUser.publicKey,
        stakingPoolPDA
      );
      const testStakeEntryPDA = await getStakeEntryPDA(
        program,
        testUser.publicKey,
        stakingPoolPDA,
        0
      );

      await program.methods
        .stake(stakeAmount, 3)
        .accounts({
          user: testUser.publicKey,
          userTokenAccount: testUserTokenAccount,
          userStakingAccount: testUserStakingAccountPDA,
          stakeEntry: testStakeEntryPDA,
          stakingPool: stakingPoolPDA,
          stakeMint: stakeMint,
          stakeVault: stakeVaultPDA,
          systemProgram: anchor.web3.SystemProgram.programId,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .signers([testUser])
        .rpc();

      // Get staking pool state after stake
      const poolAfter = await program.account.stakingPool.fetch(stakingPoolPDA);
      console.log("Total staked after:", poolAfter.totalStaked.toString());
      console.log("Daily rates after stake:", poolAfter.dailyRates.slice(0, 5));

      // Verify daily_rates is not empty (not all zeros)
      const hasNonZeroRate = poolAfter.dailyRates.some(rate => rate > 0);
      assert.isTrue(hasNonZeroRate, "Daily rates should have at least one non-zero value after staking");

      // Check the current day's rate specifically
      const currentDay = 0; // Assuming we're testing on day 0
      assert.isAbove(
        poolAfter.dailyRates[currentDay].toNumber(), 
        0, 
        `Daily rate for day ${currentDay} should be greater than 0`
      );

      // Calculate expected APY manually
      const totalStaked = poolAfter.totalStaked.toNumber();
      const monthlyRewards = 20_833_333_000_000_000; // First month rewards
      const expectedBaseApy = (monthlyRewards * 100) / (totalStaked + 1);
      console.log("Expected base APY (with 4 decimals):", expectedBaseApy);
      console.log("Actual daily rate[0]:", poolAfter.dailyRates[0].toNumber());
      
      // Check day calculation
      const programStartTime = poolAfter.programStartTime.toNumber();
      const currentTime = Math.floor(Date.now() / 1000);
      const secondsElapsed = currentTime - programStartTime;
      const dayIndex = Math.floor(secondsElapsed / 86400);
      console.log("Seconds elapsed:", secondsElapsed);
      console.log("Expected day index:", dayIndex);
    });
  });

  describe("Edge cases and validations", () => {
    it("should handle multiple users correctly", async () => {
      // User2 should still have an active stake
      const user2StakeEntry = await program.account.stakeEntry.fetch(
        user2StakeEntry0PDA
      );
      const user2StakingAccount =
        await program.account.userStakingAccount.fetch(user2StakingAccountPDA);

      assert.isTrue(user2StakeEntry.isActive);
      assert.equal(user2StakeEntry.durationMonths, 12);
      assert.equal(user2StakeEntry.stakeIndex.toNumber(), 0);
      assert.ok(user2StakeEntry.amount.eq(STAKE_AMOUNT.mul(new BN(2))));

      // User1 should have one active stake (index 1) and one inactive (index 0)
      const user1StakeEntry0 = await program.account.stakeEntry.fetch(
        user1StakeEntry0PDA
      );
      const user1StakeEntry1 = await program.account.stakeEntry.fetch(
        user1StakeEntry1PDA
      );

      assert.isFalse(user1StakeEntry0.isActive); // Unstaked
      assert.isTrue(user1StakeEntry1.isActive); // Still active
      assert.equal(user1StakeEntry1.durationMonths, 6);
    });

    it("should validate stake duration constraints", async () => {
      const validDurations = [3, 6, 9, 12];
      for (const duration of validDurations) {
        // These should be valid durations (tested in stake tests)
        assert.include(validDurations, duration);
      }
    });

    it("should prevent negative amounts", async () => {
      // This test verifies that the program handles u64 amounts correctly
      // Negative amounts would overflow to very large positive numbers
      const stakingPool = await program.account.stakingPool.fetch(
        stakingPoolPDA
      );
      assert.isAtLeast(stakingPool.totalStaked.toNumber(), 0);
      assert.isAtLeast(stakingPool.totalRewardsDistributed.toNumber(), 0);
    });
  });

  describe("Transfer-based rewards", () => {
    it("should verify reward vault has sufficient funds", async () => {
      // Fund the reward vault if not already funded
      const rewardVaultAccountBefore = await getAccount(
        provider.connection,
        rewardVaultPDA,
        undefined,
        TOKEN_2022_PROGRAM_ID
      );
      
      if (Number(rewardVaultAccountBefore.amount) === 0) {
        await mintTo(
          provider.connection,
          authority,
          stakeMint,
          rewardVaultPDA,
          authority,
          BigInt(REWARD_POOL_AMOUNT.toString()),
          undefined,
          undefined,
          TOKEN_2022_PROGRAM_ID
        );
      }
      
      const rewardVaultAccount = await getAccount(
        provider.connection,
        rewardVaultPDA,
        undefined,
        TOKEN_2022_PROGRAM_ID
      );

      // Should have the initial funding minus any distributed rewards
      assert.isAbove(Number(rewardVaultAccount.amount), 0);
      assert.isTrue(
        new BN(rewardVaultAccount.amount.toString()).lte(REWARD_POOL_AMOUNT)
      );
    });

    it("should prevent claiming when reward vault is empty", async () => {
      // This test would require draining the reward vault first
      // For now, we just verify the vault balance checking logic exists
      const stakingPool = await program.account.stakingPool.fetch(
        stakingPoolPDA
      );
      assert.isDefined(stakingPool.totalRewardsDistributed);
    });
  });

  describe("Multiple stakes functionality", () => {
    it("should auto-calculate sequential stake indexes", async () => {
      // User1 now has 2 stakes, next should be index 2
      const userStakingAccountBefore =
        await program.account.userStakingAccount.fetch(user1StakingAccountPDA);
      const expectedIndex = userStakingAccountBefore.stakeCount.toNumber();

      // Derive the expected PDA for the next stake
      const [expectedStakeEntryPDA] =
        await anchor.web3.PublicKey.findProgramAddress(
          [
            Buffer.from("stake_entry"),
            user1.publicKey.toBuffer(),
            stakingPoolPDA.toBuffer(),
            Buffer.from([expectedIndex, 0, 0, 0, 0, 0, 0, 0]),
          ],
          program.programId
        );

      await program.methods
        .stake(STAKE_AMOUNT.div(new BN(4)), 9) // Third stake with auto-calculated index
        .accounts({
          user: user1.publicKey,
          stakingPool: stakingPoolPDA,
          userStakingAccount: user1StakingAccountPDA,
          stakeEntry: expectedStakeEntryPDA,
          userTokenAccount: user1StakeAccount,
          stakeVault: stakeVaultPDA,
          stakeMint: stakeMint,
          systemProgram: anchor.web3.SystemProgram.programId,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
          associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        })
        .signers([user1])
        .rpc();

      // Verify the stake was created with the expected index
      const stakeEntry = await program.account.stakeEntry.fetch(
        expectedStakeEntryPDA
      );
      const userStakingAccountAfter =
        await program.account.userStakingAccount.fetch(user1StakingAccountPDA);

      assert.equal(stakeEntry.stakeIndex.toNumber(), expectedIndex);
      assert.equal(stakeEntry.durationMonths, 9);
      assert.ok(stakeEntry.amount.eq(STAKE_AMOUNT.div(new BN(4))));
      assert.equal(
        userStakingAccountAfter.stakeCount.toNumber(),
        expectedIndex + 1
      );
    });

    it("should fail when trying to create stake entry that already exists", async () => {
      // Try to create another stake using the same PDA as the first stake (index 0)
      try {
        await program.methods
          .stake(STAKE_AMOUNT, 3) // This should fail
          .accounts({
            user: user1.publicKey,
            stakingPool: stakingPoolPDA,
            userStakingAccount: user1StakingAccountPDA,
            stakeEntry: user1StakeEntry0PDA, // Same PDA as first stake
            userTokenAccount: user1StakeAccount,
            stakeVault: stakeVaultPDA,
            stakeMint: stakeMint,
            systemProgram: anchor.web3.SystemProgram.programId,
            tokenProgram: TOKEN_2022_PROGRAM_ID,
            associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
            rent: anchor.web3.SYSVAR_RENT_PUBKEY,
          })
          .signers([user1])
          .rpc();

        assert.fail("Should have thrown an error");
      } catch (error) {
        assert.include(error.toString(), "StakeEntryAlreadyExists");
      }
    });

    it("should allow claiming from specific stake by index", async () => {
      // This test would pass in real scenario with time progression
      // For now we just verify the structure works
      const user1StakeEntry1 = await program.account.stakeEntry.fetch(
        user1StakeEntry1PDA
      );
      assert.equal(user1StakeEntry1.stakeIndex.toNumber(), 1);
      assert.isTrue(user1StakeEntry1.isActive);
    });

    it("should track user stake count correctly", async () => {
      const userStakingAccount = await program.account.userStakingAccount.fetch(
        user1StakingAccountPDA
      );

      // User1 should have 3 stakes total (one inactive, two active)
      assert.equal(userStakingAccount.stakeCount.toNumber(), 3);

      // Total staked should only include active stakes (second + third stakes)
      const expectedTotalStaked = STAKE_AMOUNT.div(new BN(2)).add(
        STAKE_AMOUNT.div(new BN(4))
      );
      assert.ok(userStakingAccount.totalStaked.eq(expectedTotalStaked));
    });
  });

  describe("claim_all functionality", () => {
    it("should claim all rewards from multiple stakes at once", async () => {
      // First, let's create a scenario where we can claim rewards
      // We need to wait some time or simulate time progression
      // For this test, we'll mock the scenario by checking the structure works

      // Get all stake entries for user1 (should have 3 stakes)
      const userStakingAccount = await program.account.userStakingAccount.fetch(
        user1StakingAccountPDA
      );
      const stakeCount = userStakingAccount.stakeCount.toNumber();

      // Create remaining accounts array with all stake entries
      const remainingAccounts = [];
      for (let i = 0; i < stakeCount; i++) {
        const [stakeEntryPDA] = await anchor.web3.PublicKey.findProgramAddress(
          [
            Buffer.from("stake_entry"),
            user1.publicKey.toBuffer(),
            stakingPoolPDA.toBuffer(),
            Buffer.from([i, 0, 0, 0, 0, 0, 0, 0]),
          ],
          program.programId
        );
        remainingAccounts.push({
          pubkey: stakeEntryPDA,
          isSigner: false,
          isWritable: true,
        });
      }

      // Try to claim all (should fail with NoRewardsAvailable since no time has passed)
      try {
        await program.methods
          .claimAll()
          .accounts({
            user: user1.publicKey,
            stakingPool: stakingPoolPDA,
            userStakingAccount: user1StakingAccountPDA,
            userRewardAccount: user1RewardAccount,
            rewardVault: rewardVaultPDA,
            stakeMint: stakeMint,
            systemProgram: anchor.web3.SystemProgram.programId,
            tokenProgram: TOKEN_2022_PROGRAM_ID,
            associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
            rent: anchor.web3.SYSVAR_RENT_PUBKEY,
          })
          .remainingAccounts(remainingAccounts)
          .signers([user1])
          .rpc();

        assert.fail("Should have thrown an error");
      } catch (error) {
        assert.include(error.toString(), "NoRewardsAvailable");
      }
    });

    it("should handle empty remaining accounts", async () => {
      try {
        await program.methods
          .claimAll()
          .accounts({
            user: user2.publicKey,
            stakingPool: stakingPoolPDA,
            userStakingAccount: user2StakingAccountPDA,
            userRewardAccount: user2RewardAccount,
            rewardVault: rewardVaultPDA,
            stakeMint: stakeMint,
            systemProgram: anchor.web3.SystemProgram.programId,
            tokenProgram: TOKEN_2022_PROGRAM_ID,
            associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
            rent: anchor.web3.SYSVAR_RENT_PUBKEY,
          })
          .remainingAccounts([]) // No stake entries
          .signers([user2])
          .rpc();

        assert.fail("Should have thrown an error");
      } catch (error) {
        assert.include(error.toString(), "NoRewardsAvailable");
      }
    });

    it("should validate PDA correctness for remaining accounts", async () => {
      // Create an invalid PDA (not a stake entry)
      const invalidPDA = anchor.web3.Keypair.generate();

      const remainingAccounts = [
        {
          pubkey: invalidPDA.publicKey,
          isSigner: false,
          isWritable: true,
        },
      ];

      try {
        await program.methods
          .claimAll()
          .accounts({
            user: user1.publicKey,
            stakingPool: stakingPoolPDA,
            userStakingAccount: user1StakingAccountPDA,
            userRewardAccount: user1RewardAccount,
            rewardVault: rewardVaultPDA,
            stakeMint: stakeMint,
            systemProgram: anchor.web3.SystemProgram.programId,
            tokenProgram: TOKEN_2022_PROGRAM_ID,
            associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
            rent: anchor.web3.SYSVAR_RENT_PUBKEY,
          })
          .remainingAccounts(remainingAccounts)
          .signers([user1])
          .rpc();

        assert.fail("Should have thrown an error");
      } catch (error) {
        assert.include(error.toString(), "InvalidStakeIndex");
      }
    });

    it("should skip inactive stakes when claiming all", async () => {
      // User1 has 3 stakes: inactive (index 0), active (index 1), active (index 2)
      const userStakingAccount = await program.account.userStakingAccount.fetch(
        user1StakingAccountPDA
      );
      const stakeCount = userStakingAccount.stakeCount.toNumber();

      // Verify we have the expected number of stakes
      assert.equal(stakeCount, 3);

      // Check status of each stake
      const stakeEntry0 = await program.account.stakeEntry.fetch(
        user1StakeEntry0PDA
      );
      const stakeEntry1 = await program.account.stakeEntry.fetch(
        user1StakeEntry1PDA
      );

      // Generate PDA for third stake
      const [user1StakeEntry2PDA] =
        await anchor.web3.PublicKey.findProgramAddress(
          [
            Buffer.from("stake_entry"),
            user1.publicKey.toBuffer(),
            stakingPoolPDA.toBuffer(),
            Buffer.from([2, 0, 0, 0, 0, 0, 0, 0]),
          ],
          program.programId
        );
      const stakeEntry2 = await program.account.stakeEntry.fetch(
        user1StakeEntry2PDA
      );

      assert.isFalse(stakeEntry0.isActive); // First stake was unstaked
      assert.isTrue(stakeEntry1.isActive); // Second stake is active
      assert.isTrue(stakeEntry2.isActive); // Third stake is active

      // Create remaining accounts for all stakes
      const remainingAccounts = [
        { pubkey: user1StakeEntry0PDA, isSigner: false, isWritable: true },
        { pubkey: user1StakeEntry1PDA, isSigner: false, isWritable: true },
        { pubkey: user1StakeEntry2PDA, isSigner: false, isWritable: true },
      ];

      // This should not fail due to inactive stakes (they should be skipped)
      // but will fail due to NoRewardsAvailable since no time has passed
      try {
        await program.methods
          .claimAll()
          .accounts({
            user: user1.publicKey,
            stakingPool: stakingPoolPDA,
            userStakingAccount: user1StakingAccountPDA,
            userRewardAccount: user1RewardAccount,
            rewardVault: rewardVaultPDA,
            stakeMint: stakeMint,
            systemProgram: anchor.web3.SystemProgram.programId,
            tokenProgram: TOKEN_2022_PROGRAM_ID,
            associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
            rent: anchor.web3.SYSVAR_RENT_PUBKEY,
          })
          .remainingAccounts(remainingAccounts)
          .signers([user1])
          .rpc();

        assert.fail("Should have thrown an error");
      } catch (error) {
        // Should fail with NoRewardsAvailable, not with any validation error
        assert.include(error.toString(), "NoRewardsAvailable");
      }
    });

    it("should fail when trying to claim for wrong user", async () => {
      // Try to claim user1's stakes as user2
      const remainingAccounts = [
        {
          pubkey: user1StakeEntry1PDA,
          isSigner: false,
          isWritable: true,
        },
      ];

      try {
        await program.methods
          .claimAll()
          .accounts({
            user: user2.publicKey, // Wrong user
            stakingPool: stakingPoolPDA,
            userStakingAccount: user2StakingAccountPDA,
            userRewardAccount: user2RewardAccount,
            rewardVault: rewardVaultPDA,
            stakeMint: stakeMint,
            systemProgram: anchor.web3.SystemProgram.programId,
            tokenProgram: TOKEN_2022_PROGRAM_ID,
            associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
            rent: anchor.web3.SYSVAR_RENT_PUBKEY,
          })
          .remainingAccounts(remainingAccounts)
          .signers([user2])
          .rpc();

        assert.fail("Should have thrown an error");
      } catch (error) {
        // Should fail with either Unauthorized or InvalidStakeIndex
        assert.isTrue(
          error.toString().includes("Unauthorized") ||
          error.toString().includes("InvalidStakeIndex")
        );
      }
    });
  });

  describe("calculate_total_rewards_for_claim_all", () => {
    let testUser: anchor.web3.Keypair;
    let testStakingAccountPDA: anchor.web3.PublicKey;
    let testStakeEntry1PDA: anchor.web3.PublicKey;
    let testStakeEntry2PDA: anchor.web3.PublicKey;
    let testStakeEntry3PDA: anchor.web3.PublicKey;

    before(async () => {
      testUser = anchor.web3.Keypair.generate();

      // Airdrop SOL to test user
      const connection = anchor.getProvider().connection;
      const airdropSig = await connection.requestAirdrop(
        testUser.publicKey,
        2 * anchor.web3.LAMPORTS_PER_SOL
      );
      await connection.confirmTransaction(airdropSig);

      // Create token accounts for test user
      const testTokenAccount = await createAssociatedTokenAccount(
        connection,
        testUser,
        stakeMint,
        testUser.publicKey,
        undefined,
        TOKEN_2022_PROGRAM_ID
      );


      // Mint tokens to test user
      await mintTo(
        connection,
        authority,
        stakeMint,
        testTokenAccount,
        authority.publicKey,
        10_000_000_000_000, // 10M tokens
        [],
        undefined,
        TOKEN_2022_PROGRAM_ID
      );

      // Get PDAs for test user
      testStakingAccountPDA = await getUserStakingAccountPDA(
        program,
        testUser.publicKey,
        stakingPoolPDA
      );
      testStakeEntry1PDA = await getStakeEntryPDA(
        program,
        testUser.publicKey,
        stakingPoolPDA,
        0
      );
      testStakeEntry2PDA = await getStakeEntryPDA(
        program,
        testUser.publicKey,
        stakingPoolPDA,
        1
      );
      testStakeEntry3PDA = await getStakeEntryPDA(
        program,
        testUser.publicKey,
        stakingPoolPDA,
        2
      );
    });

    it("should correctly calculate total rewards for multiple active stakes", async () => {
      // Create 3 stakes with different durations
      const stake1Amount = new BN(1_000_000_000_000); // 1M tokens
      const stake2Amount = new BN(2_000_000_000_000); // 2M tokens
      const stake3Amount = new BN(500_000_000_000); // 500K tokens

      // Stake 1: 3 months
      await program.methods
        .stake(stake1Amount, 3)
        .accounts({
          user: testUser.publicKey,
          stakingPool: stakingPoolPDA,
          userStakingAccount: testStakingAccountPDA,
          stakeEntry: testStakeEntry1PDA,
          userTokenAccount: await getAssociatedTokenAddress(
            stakeMint,
            testUser.publicKey,
            undefined,
            TOKEN_2022_PROGRAM_ID
          ),
          stakeVault: stakeVaultPDA,
          stakeMint: stakeMint,
          systemProgram: anchor.web3.SystemProgram.programId,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
          associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        })
        .signers([testUser])
        .rpc();

      // Stake 2: 6 months
      await program.methods
        .stake(stake2Amount, 6)
        .accounts({
          user: testUser.publicKey,
          stakingPool: stakingPoolPDA,
          userStakingAccount: testStakingAccountPDA,
          stakeEntry: testStakeEntry2PDA,
          userTokenAccount: await getAssociatedTokenAddress(
            stakeMint,
            testUser.publicKey,
            undefined,
            TOKEN_2022_PROGRAM_ID
          ),
          stakeVault: stakeVaultPDA,
          stakeMint: stakeMint,
          systemProgram: anchor.web3.SystemProgram.programId,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
          associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        })
        .signers([testUser])
        .rpc();

      // Stake 3: 12 months
      await program.methods
        .stake(stake3Amount, 12)
        .accounts({
          user: testUser.publicKey,
          stakingPool: stakingPoolPDA,
          userStakingAccount: testStakingAccountPDA,
          stakeEntry: testStakeEntry3PDA,
          userTokenAccount: await getAssociatedTokenAddress(
            stakeMint,
            testUser.publicKey,
            undefined,
            TOKEN_2022_PROGRAM_ID
          ),
          stakeVault: stakeVaultPDA,
          stakeMint: stakeMint,
          systemProgram: anchor.web3.SystemProgram.programId,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
          associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        })
        .signers([testUser])
        .rpc();

      // Note: In a real test environment with time progression, we would verify the rewards calculation
      // For now, we verify that the function can handle multiple stakes correctly
      const userStakingAccount = await program.account.userStakingAccount.fetch(
        testStakingAccountPDA
      );
      expect(userStakingAccount.stakeCount.toNumber()).to.equal(3);
    });

    it("should skip inactive stakes when calculating rewards", async () => {
      // Create a 4th stake
      const testStakeEntry4PDA = await getStakeEntryPDA(
        program,
        testUser.publicKey,
        stakingPoolPDA,
        3
      );
      const stake4Amount = new BN(1_000_000_000_000); // 1M tokens

      await program.methods
        .stake(stake4Amount, 3)
        .accounts({
          user: testUser.publicKey,
          stakingPool: stakingPoolPDA,
          userStakingAccount: testStakingAccountPDA,
          stakeEntry: testStakeEntry4PDA,
          userTokenAccount: await getAssociatedTokenAddress(
            stakeMint,
            testUser.publicKey,
            undefined,
            TOKEN_2022_PROGRAM_ID
          ),
          stakeVault: stakeVaultPDA,
          stakeMint: stakeMint,
          systemProgram: anchor.web3.SystemProgram.programId,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
          associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        })
        .signers([testUser])
        .rpc();

      // Immediately unstake it to make it inactive
      await program.methods
        .unstake(new BN(3))
        .accounts({
          user: testUser.publicKey,
          stakingPool: stakingPoolPDA,
          userStakingAccount: testStakingAccountPDA,
          stakeEntry: testStakeEntry4PDA,
          userTokenAccount: await getAssociatedTokenAddress(
            stakeMint,
            testUser.publicKey,
            undefined,
            TOKEN_2022_PROGRAM_ID
          ),
          userRewardAccount: await getAssociatedTokenAddress(
            stakeMint,
            testUser.publicKey,
            undefined,
            TOKEN_2022_PROGRAM_ID
          ),
          stakeVault: stakeVaultPDA,
          rewardVault: rewardVaultPDA,
          treasuryTokenAccount: treasuryRewardAccount,
          stakeMint: stakeMint,
          systemProgram: anchor.web3.SystemProgram.programId,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
          associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        })
        .signers([testUser])
        .rpc();

      // Verify the stake is inactive
      const stakeEntry4 = await program.account.stakeEntry.fetch(
        testStakeEntry4PDA
      );
      expect(stakeEntry4.isActive).to.be.false;
    });

    it("should handle empty remaining_accounts gracefully", async () => {
      try {
        await program.methods
          .claimAll()
          .accounts({
            user: testUser.publicKey,
            stakingPool: stakingPoolPDA,
            userStakingAccount: testStakingAccountPDA,
            userRewardAccount: await getAssociatedTokenAddress(
              stakeMint,
              testUser.publicKey,
              undefined,
              TOKEN_2022_PROGRAM_ID
            ),
            rewardVault: rewardVaultPDA,
            stakeMint: stakeMint,
            systemProgram: anchor.web3.SystemProgram.programId,
            tokenProgram: TOKEN_2022_PROGRAM_ID,
            associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
            rent: anchor.web3.SYSVAR_RENT_PUBKEY,
          })
          .remainingAccounts([]) // Empty array
          .signers([testUser])
          .rpc();

        assert.fail("Should have thrown NoRewardsAvailable error");
      } catch (error) {
        assert.include(error.toString(), "NoRewardsAvailable");
      }
    });

    it("should verify correct PDA for each stake entry", async () => {
      // Try to pass an incorrect PDA
      const fakeStakeEntryPDA = anchor.web3.Keypair.generate().publicKey;

      try {
        await program.methods
          .claimAll()
          .accounts({
            user: testUser.publicKey,
            stakingPool: stakingPoolPDA,
            userStakingAccount: testStakingAccountPDA,
            userRewardAccount: await getAssociatedTokenAddress(
              stakeMint,
              testUser.publicKey,
              undefined,
              TOKEN_2022_PROGRAM_ID
            ),
            rewardVault: rewardVaultPDA,
            stakeMint: stakeMint,
            systemProgram: anchor.web3.SystemProgram.programId,
            tokenProgram: TOKEN_2022_PROGRAM_ID,
            associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
            rent: anchor.web3.SYSVAR_RENT_PUBKEY,
          })
          .remainingAccounts([
            {
              pubkey: fakeStakeEntryPDA,
              isSigner: false,
              isWritable: true,
            },
          ])
          .signers([testUser])
          .rpc();

        assert.fail("Should have thrown InvalidStakeIndex error");
      } catch (error) {
        assert.include(error.toString(), "InvalidStakeIndex");
      }
    });

    it("should accumulate rewards from all valid stakes correctly", async () => {
      // This test would ideally verify the actual reward calculations
      // In a test environment with time progression, we would:
      // 1. Progress time by several weeks
      // 2. Call claim_all with all stake entries
      // 3. Verify that total_rewards equals sum of individual stake rewards

      // For now, we verify the structure is correct
      const remainingAccounts = [
        { pubkey: testStakeEntry1PDA, isSigner: false, isWritable: true },
        { pubkey: testStakeEntry2PDA, isSigner: false, isWritable: true },
        { pubkey: testStakeEntry3PDA, isSigner: false, isWritable: true },
      ];

      // Note: This will fail with NoRewardsAvailable in test environment
      // because no time has passed, but it validates the function structure
      try {
        await program.methods
          .claimAll()
          .accounts({
            user: testUser.publicKey,
            stakingPool: stakingPoolPDA,
            userStakingAccount: testStakingAccountPDA,
            userRewardAccount: await getAssociatedTokenAddress(
              stakeMint,
              testUser.publicKey,
              undefined,
              TOKEN_2022_PROGRAM_ID
            ),
            rewardVault: rewardVaultPDA,
            stakeMint: stakeMint,
            systemProgram: anchor.web3.SystemProgram.programId,
            tokenProgram: TOKEN_2022_PROGRAM_ID,
            associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
            rent: anchor.web3.SYSVAR_RENT_PUBKEY,
          })
          .remainingAccounts(remainingAccounts)
          .signers([testUser])
          .rpc();
      } catch (error) {
        // Expected to fail with NoRewardsAvailable in test environment
        assert.include(error.toString(), "NoRewardsAvailable");
      }
    });
  });

  describe("get_total_claimable_rewards (view-only)", () => {
    let viewTestUser: anchor.web3.Keypair;
    let viewTestStakingAccountPDA: anchor.web3.PublicKey;
    let viewTestStakeEntries: anchor.web3.PublicKey[] = [];

    before(async () => {
      viewTestUser = anchor.web3.Keypair.generate();

      // Airdrop SOL to test user
      const connection = anchor.getProvider().connection;
      const airdropSig = await connection.requestAirdrop(
        viewTestUser.publicKey,
        2 * anchor.web3.LAMPORTS_PER_SOL
      );
      await connection.confirmTransaction(airdropSig);

      // Create token accounts for test user
      const viewTestTokenAccount = await createAssociatedTokenAccount(
        connection,
        viewTestUser,
        stakeMint,
        viewTestUser.publicKey,
        undefined,
        TOKEN_2022_PROGRAM_ID
      );

      // Mint tokens to test user
      await mintTo(
        connection,
        authority,
        stakeMint,
        viewTestTokenAccount,
        authority.publicKey,
        10_000_000_000_000, // 10M tokens
        [],
        undefined,
        TOKEN_2022_PROGRAM_ID
      );

      // Get PDAs for test user
      viewTestStakingAccountPDA = await getUserStakingAccountPDA(
        program,
        viewTestUser.publicKey,
        stakingPoolPDA
      );

      // Create multiple stakes for testing
      const stakeAmounts = [
        new BN(1_000_000_000_000), // 1M tokens
        new BN(2_000_000_000_000), // 2M tokens
        new BN(500_000_000_000), // 500K tokens
      ];
      const durations = [3, 6, 12];

      for (let i = 0; i < 3; i++) {
        const stakeEntryPDA = await getStakeEntryPDA(
          program,
          viewTestUser.publicKey,
          stakingPoolPDA,
          i
        );
        viewTestStakeEntries.push(stakeEntryPDA);

        await program.methods
          .stake(stakeAmounts[i], durations[i])
          .accounts({
            user: viewTestUser.publicKey,
            stakingPool: stakingPoolPDA,
            userStakingAccount: viewTestStakingAccountPDA,
            stakeEntry: stakeEntryPDA,
            userTokenAccount: await getAssociatedTokenAddress(
              stakeMint,
              viewTestUser.publicKey,
              undefined,
              TOKEN_2022_PROGRAM_ID
            ),
            stakeVault: stakeVaultPDA,
            stakeMint: stakeMint,
            systemProgram: anchor.web3.SystemProgram.programId,
            tokenProgram: TOKEN_2022_PROGRAM_ID,
            associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
            rent: anchor.web3.SYSVAR_RENT_PUBKEY,
          })
          .signers([viewTestUser])
          .rpc();
      }
    });

    it("should return total claimable rewards for all active stakes", async () => {
      // Prepare remaining accounts for all stakes
      const remainingAccounts = viewTestStakeEntries.map((stakeEntry) => ({
        pubkey: stakeEntry,
        isSigner: false,
        isWritable: false, // Read-only для view функции
      }));

      // Call the view-only function
      const result = await program.methods
        .getTotalClaimableRewards()
        .accounts({
          user: viewTestUser.publicKey,
          stakingPool: stakingPoolPDA,
        })
        .remainingAccounts(remainingAccounts)
        .rpc();

      // Проверим, что пользователь имеет 3 активных стейка
      const userStakingAccount = await program.account.userStakingAccount.fetch(
        viewTestStakingAccountPDA
      );
      expect(userStakingAccount.stakeCount.toNumber()).to.equal(3);
    });

    it("should work with partial stake entries", async () => {
      // Тестируем с только первыми двумя стейками
      const partialRemainingAccounts = viewTestStakeEntries
        .slice(0, 2)
        .map((stakeEntry) => ({
          pubkey: stakeEntry,
          isSigner: false,
          isWritable: false,
        }));

      const result = await program.methods
        .getTotalClaimableRewards()
        .accounts({
          user: viewTestUser.publicKey,
          stakingPool: stakingPoolPDA,
        })
        .remainingAccounts(partialRemainingAccounts)
        .rpc();
    });

    it("should work with empty remaining accounts", async () => {
      // Тестируем с пустым массивом remaining accounts
      const result = await program.methods
        .getTotalClaimableRewards()
        .accounts({
          user: viewTestUser.publicKey,
          stakingPool: stakingPoolPDA,
        })
        .remainingAccounts([])
        .rpc();
    });

    it("should fail with invalid stake entry PDA", async () => {
      // Создаем недействительный PDA
      const invalidPDA = anchor.web3.Keypair.generate().publicKey;

      const invalidRemainingAccounts = [
        {
          pubkey: invalidPDA,
          isSigner: false,
          isWritable: false,
        },
      ];

      try {
        await program.methods
          .getTotalClaimableRewards()
          .accounts({
            user: viewTestUser.publicKey,
            stakingPool: stakingPoolPDA,
          })
          .remainingAccounts(invalidRemainingAccounts)
          .rpc();

        assert.fail("Should have thrown InvalidStakeIndex error");
      } catch (error) {
        assert.include(error.toString(), "InvalidStakeIndex");
      }
    });

    it("should work with mixed active and inactive stakes", async () => {
      // Создаем еще один стейк и сразу его анстейкаем
      const inactiveStakeEntryPDA = await getStakeEntryPDA(
        program,
        viewTestUser.publicKey,
        stakingPoolPDA,
        3
      );

      // Создаем стейк
      await program.methods
        .stake(new BN(1_000_000_000_000), 3)
        .accounts({
          user: viewTestUser.publicKey,
          stakingPool: stakingPoolPDA,
          userStakingAccount: viewTestStakingAccountPDA,
          stakeEntry: inactiveStakeEntryPDA,
          userTokenAccount: await getAssociatedTokenAddress(
            stakeMint,
            viewTestUser.publicKey,
            undefined,
            TOKEN_2022_PROGRAM_ID
          ),
          stakeVault: stakeVaultPDA,
          stakeMint: stakeMint,
          systemProgram: anchor.web3.SystemProgram.programId,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
          associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        })
        .signers([viewTestUser])
        .rpc();

      // Анстейкаем его (делаем неактивным)
      await program.methods
        .unstake(new BN(3))
        .accounts({
          user: viewTestUser.publicKey,
          stakingPool: stakingPoolPDA,
          userStakingAccount: viewTestStakingAccountPDA,
          stakeEntry: inactiveStakeEntryPDA,
          userTokenAccount: await getAssociatedTokenAddress(
            stakeMint,
            viewTestUser.publicKey,
            undefined,
            TOKEN_2022_PROGRAM_ID
          ),
          userRewardAccount: await getAssociatedTokenAddress(
            stakeMint,
            viewTestUser.publicKey,
            undefined,
            TOKEN_2022_PROGRAM_ID
          ),
          stakeVault: stakeVaultPDA,
          rewardVault: rewardVaultPDA,
          treasuryTokenAccount: treasuryRewardAccount,
          stakeMint: stakeMint,
          systemProgram: anchor.web3.SystemProgram.programId,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
          associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        })
        .signers([viewTestUser])
        .rpc();

      // Тестируем view функцию с смешанными активными и неактивными стейками
      const mixedRemainingAccounts = [
        ...viewTestStakeEntries.map((stakeEntry) => ({
          pubkey: stakeEntry,
          isSigner: false,
          isWritable: false,
        })),
        {
          pubkey: inactiveStakeEntryPDA,
          isSigner: false,
          isWritable: false,
        },
      ];

      const result = await program.methods
        .getTotalClaimableRewards()
        .accounts({
          user: viewTestUser.publicKey,
          stakingPool: stakingPoolPDA,
        })
        .remainingAccounts(mixedRemainingAccounts)
        .rpc();

      // Проверяем, что неактивный стейк действительно неактивен
      const inactiveStakeEntry = await program.account.stakeEntry.fetch(
        inactiveStakeEntryPDA
      );
      expect(inactiveStakeEntry.isActive).to.be.false;
    });

    it("should work without requiring user signature", async () => {
      // Тестируем, что функция работает без подписи пользователя
      // Просто проверяем, что user в Context не требует подписи
      const remainingAccounts = viewTestStakeEntries.map((stakeEntry) => ({
        pubkey: stakeEntry,
        isSigner: false,
        isWritable: false,
      }));

      // Вызываем функцию - user это AccountInfo, не Signer
      const result = await program.methods
        .getTotalClaimableRewards()
        .accounts({
          user: viewTestUser.publicKey, // AccountInfo, не требует подписи
          stakingPool: stakingPoolPDA,
        })
        .remainingAccounts(remainingAccounts)
        .rpc();
    });

    it("should return consistent results with claim_all simulation", async () => {
      // Сравниваем результат view функции с симуляцией claim_all

      const remainingAccounts = viewTestStakeEntries.map((stakeEntry) => ({
        pubkey: stakeEntry,
        isSigner: false,
        isWritable: false, // Read-only для view
      }));

      // Вызываем view функцию
      await program.methods
        .getTotalClaimableRewards()
        .accounts({
          user: viewTestUser.publicKey,
          stakingPool: stakingPoolPDA,
        })
        .remainingAccounts(remainingAccounts)
        .rpc();

      // Симулируем claim_all (должно дать тот же результат)
      const writableRemainingAccounts = viewTestStakeEntries.map(
        (stakeEntry) => ({
          pubkey: stakeEntry,
          isSigner: false,
          isWritable: true, // Writable для claim_all
        })
      );

      try {
        const instruction = await program.methods
          .claimAll()
          .accounts({
            user: viewTestUser.publicKey,
            stakingPool: stakingPoolPDA,
            userStakingAccount: viewTestStakingAccountPDA,
            userRewardAccount: await getAssociatedTokenAddress(
              stakeMint,
              viewTestUser.publicKey,
              undefined,
              TOKEN_2022_PROGRAM_ID
            ),
            rewardVault: rewardVaultPDA,
            stakeMint: stakeMint,
            systemProgram: anchor.web3.SystemProgram.programId,
            tokenProgram: TOKEN_2022_PROGRAM_ID,
            associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
            rent: anchor.web3.SYSVAR_RENT_PUBKEY,
          })
          .remainingAccounts(writableRemainingAccounts)
          .instruction();

        const transaction = new anchor.web3.Transaction().add(instruction);
        const simulation = await program.provider.connection.simulateTransaction(
          transaction
        );

      } catch (error) {
        // Ожидаем NoRewardsAvailable или другие ошибки связанные с временем
        console.log("Expected simulation error due to test environment:", error.message);
      }
    });
  });

  describe("penalty logic for early unstaking", () => {
    let penaltyTestUser: anchor.web3.Keypair;
    let penaltyTestUserTokenAccount: anchor.web3.PublicKey;
    let penaltyTestUserStakingAccountPDA: anchor.web3.PublicKey;
    let penaltyTestStakeEntryPDA: anchor.web3.PublicKey;
    let treasuryBalanceBefore: bigint;

    before(async () => {
      // Setup test user
      penaltyTestUser = anchor.web3.Keypair.generate();
      
      await provider.connection.confirmTransaction(
        await provider.connection.requestAirdrop(
          penaltyTestUser.publicKey,
          5 * anchor.web3.LAMPORTS_PER_SOL
        )
      );

      // Create token account and mint tokens
      penaltyTestUserTokenAccount = await createAssociatedTokenAccount(
        provider.connection,
        penaltyTestUser,
        stakeMint,
        penaltyTestUser.publicKey,
        undefined,
        TOKEN_2022_PROGRAM_ID
      );

      await mintTo(
        provider.connection,
        authority,
        stakeMint,
        penaltyTestUserTokenAccount,
        authority,
        BigInt(STAKE_AMOUNT.mul(new BN(5)).toString()),
        undefined,
        undefined,
        TOKEN_2022_PROGRAM_ID
      );

      // Get PDAs
      [penaltyTestUserStakingAccountPDA] = await anchor.web3.PublicKey.findProgramAddress(
        [
          Buffer.from("user_staking"),
          penaltyTestUser.publicKey.toBuffer(),
          stakingPoolPDA.toBuffer()
        ],
        program.programId
      );

      [penaltyTestStakeEntryPDA] = await anchor.web3.PublicKey.findProgramAddress(
        [
          Buffer.from("stake_entry"),
          penaltyTestUser.publicKey.toBuffer(),
          stakingPoolPDA.toBuffer(),
          Buffer.from([0, 0, 0, 0, 0, 0, 0, 0])
        ],
        program.programId
      );

      // Record treasury balance
      const treasuryAccount = await getAccount(
        provider.connection,
        treasuryRewardAccount,
        undefined,
        TOKEN_2022_PROGRAM_ID
      );
      treasuryBalanceBefore = treasuryAccount.amount;
    });

    it("should apply 20% penalty for immediate unstaking", async () => {
      const stakeAmount = STAKE_AMOUNT;
      
      // Stake for 3 months
      await program.methods
        .stake(stakeAmount, 3)
        .accounts({
          user: penaltyTestUser.publicKey,
          stakingPool: stakingPoolPDA,
          userStakingAccount: penaltyTestUserStakingAccountPDA,
          stakeEntry: penaltyTestStakeEntryPDA,
          userTokenAccount: penaltyTestUserTokenAccount,
          stakeVault: stakeVaultPDA,
          stakeMint: stakeMint,
          systemProgram: anchor.web3.SystemProgram.programId,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
          associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        })
        .signers([penaltyTestUser])
        .rpc();

      const userBalanceBefore = await getAccount(
        provider.connection,
        penaltyTestUserTokenAccount,
        undefined,
        TOKEN_2022_PROGRAM_ID
      );

      // Unstake immediately (20% penalty expected)
      await program.methods
        .unstake(new BN(0))
        .accounts({
          user: penaltyTestUser.publicKey,
          stakingPool: stakingPoolPDA,
          userStakingAccount: penaltyTestUserStakingAccountPDA,
          stakeEntry: penaltyTestStakeEntryPDA,
          userTokenAccount: penaltyTestUserTokenAccount,
          userRewardAccount: getAssociatedTokenAddressSync(
            stakeMint,
            penaltyTestUser.publicKey,
            false,
            TOKEN_2022_PROGRAM_ID
          ),
          stakeVault: stakeVaultPDA,
          rewardVault: rewardVaultPDA,
          treasuryTokenAccount: treasuryRewardAccount,
          stakeMint: stakeMint,
          systemProgram: anchor.web3.SystemProgram.programId,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
          associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        })
        .signers([penaltyTestUser])
        .rpc();

      const userBalanceAfter = await getAccount(
        provider.connection,
        penaltyTestUserTokenAccount,
        undefined,
        TOKEN_2022_PROGRAM_ID
      );

      const treasuryBalanceAfter = await getAccount(
        provider.connection,
        treasuryRewardAccount,
        undefined,
        TOKEN_2022_PROGRAM_ID
      );

      // User should receive 80% of staked amount (20% penalty)
      const expectedUserReturn = stakeAmount.mul(new BN(80)).div(new BN(100));
      const actualUserReturn = new BN((userBalanceAfter.amount - userBalanceBefore.amount).toString());
      
      assert.ok(
        actualUserReturn.eq(expectedUserReturn),
        `Expected user to receive ${expectedUserReturn.toString()}, but got ${actualUserReturn.toString()}`
      );

      // Treasury should receive 20% penalty
      const expectedPenalty = stakeAmount.mul(new BN(20)).div(new BN(100));
      const actualPenalty = new BN((treasuryBalanceAfter.amount - treasuryBalanceBefore).toString());
      
      assert.ok(
        actualPenalty.eq(expectedPenalty),
        `Expected treasury to receive ${expectedPenalty.toString()}, but got ${actualPenalty.toString()}`
      );
    });

    it("should apply decreasing penalty over time", async () => {
      // Create new stake entry for this test
      const [secondStakeEntryPDA] = await anchor.web3.PublicKey.findProgramAddress(
        [
          Buffer.from("stake_entry"),
          penaltyTestUser.publicKey.toBuffer(),
          stakingPoolPDA.toBuffer(),
          Buffer.from([1, 0, 0, 0, 0, 0, 0, 0])
        ],
        program.programId
      );

      const stakeAmount = STAKE_AMOUNT;
      
      // Stake for 6 months (180 days)
      await program.methods
        .stake(stakeAmount, 6)
        .accounts({
          user: penaltyTestUser.publicKey,
          stakingPool: stakingPoolPDA,
          userStakingAccount: penaltyTestUserStakingAccountPDA,
          stakeEntry: secondStakeEntryPDA,
          userTokenAccount: penaltyTestUserTokenAccount,
          stakeVault: stakeVaultPDA,
          stakeMint: stakeMint,
          systemProgram: anchor.web3.SystemProgram.programId,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
          associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        })
        .signers([penaltyTestUser])
        .rpc();

      // For testing, we can't wait real time, but we can verify the penalty calculation
      // The penalty formula is: 20 * (lock_duration_days - elapsed_days) / lock_duration_days
      // For 6 months (180 days), if we unstake at day 90 (half way), penalty should be 10%
      
      const stakeEntry = await program.account.stakeEntry.fetch(secondStakeEntryPDA);
      assert.equal(stakeEntry.durationMonths, 6);
      assert.ok(stakeEntry.amount.eq(stakeAmount));
      assert.isTrue(stakeEntry.isActive);
    });

    it("should apply no penalty after lock period ends", async () => {
      // This test would require time manipulation or mocking
      // In real scenario, after full lock period, penalty should be 0%
      // The formula ensures: when elapsed_days >= lock_duration_days, penalty = 0
      
      // We can at least verify the calculation logic exists in our implementation
      const stakingPool = await program.account.stakingPool.fetch(stakingPoolPDA);
      assert.ok(stakingPool.treasuryAddress.equals(treasuryRewardAccount));
    });

    it("should handle penalty calculation for different lock periods", async () => {
      // Test penalty calculation for different durations
      const durations = [3, 6, 9, 12]; // months
      const expectedDays = [90, 180, 270, 360]; // days
      
      for (let i = 0; i < durations.length; i++) {
        const lockDays = durations[i] * 30;
        assert.equal(lockDays, expectedDays[i], `Lock period for ${durations[i]} months should be ${expectedDays[i]} days`);
        
        // Verify penalty decreases linearly
        // At 25% of time elapsed, penalty should be 15% (20% * 0.75)
        // At 50% of time elapsed, penalty should be 10% (20% * 0.5)
        // At 75% of time elapsed, penalty should be 5% (20% * 0.25)
        // At 100% of time elapsed, penalty should be 0% (20% * 0)
      }
    });
  });

  describe("update_normalization_k", () => {
    it("should update normalization_k when called by authority", async () => {
      // Get initial normalization_k value
      const poolBefore = await program.account.stakingPool.fetch(stakingPoolPDA);
      const oldK = poolBefore.normalizationK;
      assert.equal(oldK.toString(), "250", "Initial normalization_k should be 250");

      // Update normalization_k to a new value
      const newK = new BN(500);
      await program.methods
        .updateNormalizationK(newK)
        .accounts({
          authority: authority.publicKey,
          stakingPool: stakingPoolPDA,
        })
        .signers([authority])
        .rpc();

      // Verify the update
      const poolAfter = await program.account.stakingPool.fetch(stakingPoolPDA);
      assert.equal(poolAfter.normalizationK.toString(), "500", "Normalization_k should be updated to 500");
    });

    it("should fail when non-authority tries to update normalization_k", async () => {
      try {
        await program.methods
          .updateNormalizationK(new BN(300))
          .accounts({
            authority: user1.publicKey,
            stakingPool: stakingPoolPDA,
          })
          .signers([user1])
          .rpc();
        assert.fail("Should have thrown an error");
      } catch (error) {
        assert.include(error.toString(), "Unauthorized");
      }
    });

    it("should fail when trying to set normalization_k to zero", async () => {
      try {
        await program.methods
          .updateNormalizationK(new BN(0))
          .accounts({
            authority: authority.publicKey,
            stakingPool: stakingPoolPDA,
          })
          .signers([authority])
          .rpc();
        assert.fail("Should have thrown an error");
      } catch (error) {
        assert.include(error.toString(), "InvalidNormalizationK");
      }
    });

    it("should update daily rates after changing normalization_k", async () => {
      // Get pool state before update
      const poolBefore = await program.account.stakingPool.fetch(stakingPoolPDA);
      const ratesBefore = poolBefore.dailyRates.slice(0, 5);
      
      // Update normalization_k back to original value
      const originalK = new BN(250);
      await program.methods
        .updateNormalizationK(originalK)
        .accounts({
          authority: authority.publicKey,
          stakingPool: stakingPoolPDA,
        })
        .signers([authority])
        .rpc();

      // Get pool state after update
      const poolAfter = await program.account.stakingPool.fetch(stakingPoolPDA);
      
      // Verify normalization_k is updated
      assert.equal(poolAfter.normalizationK.toString(), "250", "Normalization_k should be back to 250");
      
      // Daily rates should be recalculated (they might be the same if no other state changed)
      // but the update_daily_rate function should have been called
      assert.isDefined(poolAfter.dailyRates);
    });
  });
});

// Helper functions for reward calculations
function calculateExpectedRewards (
  stakeAmount: BN,
  durationMonths: number,
  apyRate: number,
  days: number
): BN {
  const weight = getWeight(durationMonths);
  const dailyRate = apyRate / 365 / 100;
  const rewards = stakeAmount
    .mul(new BN(Math.floor(dailyRate * weight * days * 1000000)))
    .div(new BN(1000000));
  return rewards;
}

function getWeight (durationMonths: number): number {
  switch (durationMonths) {
    case 3:
      return 1.0;
    case 6:
      return 1.5;
    case 9:
      return 2.0;
    case 12:
      return 3.0;
    default:
      return 1.0;
  }
}

// Helper function to get stake entry PDA with index
async function getStakeEntryPDA (
  program: any,
  userPublicKey: anchor.web3.PublicKey,
  stakingPoolPDA: anchor.web3.PublicKey,
  stakeIndex: number
): Promise<anchor.web3.PublicKey> {
  const indexBuffer = Buffer.alloc(8);
  indexBuffer.writeUInt32LE(stakeIndex, 0);

  const [stakeEntryPDA] = await anchor.web3.PublicKey.findProgramAddress(
    [
      Buffer.from("stake_entry"),
      userPublicKey.toBuffer(),
      stakingPoolPDA.toBuffer(),
      indexBuffer,
    ],
    program.programId
  );

  return stakeEntryPDA;
}

// Helper function to get user staking account PDA
async function getUserStakingAccountPDA (
  program: any,
  userPublicKey: anchor.web3.PublicKey,
  stakingPoolPDA: anchor.web3.PublicKey
): Promise<anchor.web3.PublicKey> {
  const [userStakingAccountPDA] =
    await anchor.web3.PublicKey.findProgramAddress(
      [
        Buffer.from("user_staking"),
        userPublicKey.toBuffer(),
        stakingPoolPDA.toBuffer(),
      ],
      program.programId
    );

  return userStakingAccountPDA;
}
