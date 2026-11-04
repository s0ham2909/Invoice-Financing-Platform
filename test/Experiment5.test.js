import { expect } from "chai";
import hre from "hardhat";
const { ethers } = hre;

describe("DeFi Experiment 5: Yield Farming + Staking & Invoice Platform Integration", function () {
  let deployer, alice, bob, supplier, insurancePool;
  let mockUsdc, invoiceVault, invx, invoiceFarm, reserveStaking, feeRouter;

  const parseUSDC = (val) => ethers.parseUnits(val.toString(), 6);
  const parseINVX = (val) => ethers.parseUnits(val.toString(), 18);

  beforeEach(async function () {
    [deployer, alice, bob, supplier, insurancePool] = await ethers.getSigners();

    // 1. Deploy MockUSDC (mUSDC, 6 decimals)
    const MockUSDC = await ethers.getContractFactory("MockUSDC");
    mockUsdc = await MockUSDC.deploy();
    await mockUsdc.waitForDeployment();

    // 2. Deploy InvoiceVault (vINV, ERC-4626)
    const InvoiceVault = await ethers.getContractFactory("InvoiceVault");
    invoiceVault = await InvoiceVault.deploy(await mockUsdc.getAddress());
    await invoiceVault.waitForDeployment();

    // 3. Deploy INVX (Platform Token)
    const INVX = await ethers.getContractFactory("INVX");
    invx = await INVX.deploy();
    await invx.waitForDeployment();

    // 4. Deploy InvoiceFarm (vINV Staking -> INVX Rewards)
    const InvoiceFarm = await ethers.getContractFactory("InvoiceFarm");
    invoiceFarm = await InvoiceFarm.deploy(
      await invoiceVault.getAddress(),
      await invx.getAddress()
    );
    await invoiceFarm.waitForDeployment();

    // 5. Deploy ReserveStaking (INVX Staking -> mUSDC Real Yield)
    const ReserveStaking = await ethers.getContractFactory("ReserveStaking");
    reserveStaking = await ReserveStaking.deploy(
      await invx.getAddress(),
      await mockUsdc.getAddress()
    );
    await reserveStaking.waitForDeployment();

    // 6. Deploy FeeRouter (Splits: 70% Vault, 20% ReserveStaking, 10% Insurance)
    const FeeRouter = await ethers.getContractFactory("FeeRouter");
    feeRouter = await FeeRouter.deploy(
      await mockUsdc.getAddress(),
      await invoiceVault.getAddress(),
      await reserveStaking.getAddress(),
      insurancePool.address
    );
    await feeRouter.waitForDeployment();

    // Fund test users
    await mockUsdc.mint(alice.address, parseUSDC(50_000));
    await mockUsdc.mint(bob.address, parseUSDC(50_000));
    await mockUsdc.mint(supplier.address, parseUSDC(50_000));

    await invx.mint(alice.address, parseINVX(10_000));
    await invx.mint(bob.address, parseINVX(10_000));
    await invx.mint(supplier.address, parseINVX(10_000));
  });

  // ─────────────────────────────────────────────────────────────
  // 1. Prerequisite Fix: InvoiceVault totalAssets & Receivables
  // ─────────────────────────────────────────────────────────────
  describe("Prerequisite Fix: InvoiceVault Accounting & Share Price Resilience", function () {
    it("Share price does NOT drop when funds are allocated to an invoice", async function () {
      // Alice deposits 1,000 mUSDC into vault
      await mockUsdc.connect(alice).approve(await invoiceVault.getAddress(), parseUSDC(1000));
      await invoiceVault.connect(alice).deposit(parseUSDC(1000), alice.address);

      const sharesBefore = await invoiceVault.balanceOf(alice.address);
      const totalAssetsBefore = await invoiceVault.totalAssets();
      expect(totalAssetsBefore).to.equal(parseUSDC(1000));

      const sharePriceBefore = await invoiceVault.convertToAssets(sharesBefore);
      expect(sharePriceBefore).to.equal(parseUSDC(1000));

      // Owner allocates 400 mUSDC to finance supplier's invoice
      await invoiceVault.allocateToInvoice(supplier.address, parseUSDC(400));

      // Vault idle cash is now 600, but outstandingReceivables is 400 -> totalAssets remains 1000!
      expect(await mockUsdc.balanceOf(await invoiceVault.getAddress())).to.equal(parseUSDC(600));
      expect(await invoiceVault.outstandingReceivables()).to.equal(parseUSDC(400));
      expect(await invoiceVault.totalAssets()).to.equal(parseUSDC(1000));

      // Crucial: Alice's share price did NOT drop!
      const sharePriceDuring = await invoiceVault.convertToAssets(sharesBefore);
      expect(sharePriceDuring).to.equal(parseUSDC(1000));

      // Supplier repays 400 principal + 50 interest = 450 mUSDC
      await mockUsdc.connect(supplier).approve(await invoiceVault.getAddress(), parseUSDC(450));
      await invoiceVault.connect(supplier).receiveRepayment(parseUSDC(450));

      // Outstanding receivables becomes 0, idle cash becomes 600 + 450 = 1050!
      expect(await invoiceVault.outstandingReceivables()).to.equal(0);
      expect(await invoiceVault.totalAssets()).to.equal(parseUSDC(1050));

      // Alice's shares are now worth 1,050 mUSDC (yield generated!)
      const sharePriceAfter = await invoiceVault.convertToAssets(sharesBefore);
      expect(Number(sharePriceAfter)).to.be.closeTo(Number(parseUSDC(1050)), 1);
    });

    it("Fails when allocating more liquidity than idle balance", async function () {
      await mockUsdc.connect(alice).approve(await invoiceVault.getAddress(), parseUSDC(500));
      await invoiceVault.connect(alice).deposit(parseUSDC(500), alice.address);

      await expect(
        invoiceVault.allocateToInvoice(supplier.address, parseUSDC(600))
      ).to.be.revertedWithCustomError(invoiceVault, "InsufficientVaultLiquidity");
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 2. Part 1: Yield Farming (InvoiceFarm.sol) & Document Test Values
  // ─────────────────────────────────────────────────────────────
  describe("Part 1: Yield Farming (SimpleYieldFarm / InvoiceFarm)", function () {
    it("Verifies Lab doc values: 100 stake, 0.001 rate, ~6 reward over 60s, partial 40 withdraw, exit", async function () {
      // Alice deposits 100 mUSDC to get 100 vINV shares (assuming 1:1 initial)
      await mockUsdc.connect(alice).approve(await invoiceVault.getAddress(), parseUSDC(100));
      await invoiceVault.connect(alice).deposit(parseUSDC(100), alice.address);

      const vInvBalance = await invoiceVault.balanceOf(alice.address);

      // Fund InvoiceFarm with 1,000 INVX rewards
      await invx.mint(await invoiceFarm.getAddress(), parseINVX(1000));

      // Set simulation rate matching doc: 0.001 INVX per token per second for 100 tokens
      // Rate = 100 * 0.001 = 0.1 INVX per second = 1e17 wei/s
      const rewardRateWei = ethers.parseUnits("0.1", 18);
      await invoiceFarm.setRewardRateDirect(rewardRateWei, 3600);

      // Alice approves farm to spend 100 vINV and stakes
      await invoiceVault.connect(alice).approve(await invoiceFarm.getAddress(), vInvBalance);
      await invoiceFarm.connect(alice).stake(vInvBalance);

      expect(await invoiceFarm.stakedBalance(alice.address)).to.equal(vInvBalance);

      // Fast forward time by 60 seconds
      await ethers.provider.send("evm_increaseTime", [60]);
      await ethers.provider.send("evm_mine", []);

      // Check earned reward: 60s * 0.1 INVX/s = 6.0 INVX (approx)
      const earned = await invoiceFarm.earned(alice.address);
      const earnedTokens = Number(ethers.formatUnits(earned, 18));
      expect(earnedTokens).to.be.closeTo(6.0, 0.2);

      // Alice harvests rewards
      const balBeforeHarvest = await invx.balanceOf(alice.address);
      await invoiceFarm.connect(alice).harvest();
      const balAfterHarvest = await invx.balanceOf(alice.address);
      const harvested = Number(ethers.formatUnits(balAfterHarvest - balBeforeHarvest, 18));
      expect(harvested).to.be.closeTo(6.0, 0.25);

      // Partial withdrawal of 40% (40 tokens)
      const withdrawAmount = (vInvBalance * 40n) / 100n;
      await invoiceFarm.connect(alice).withdraw(withdrawAmount);

      const remainingStake = await invoiceFarm.stakedBalance(alice.address);
      expect(remainingStake).to.equal((vInvBalance * 60n) / 100n);

      // Final Exit: withdraw remaining 60 tokens and harvest
      await invoiceFarm.connect(alice).exit();
      expect(await invoiceFarm.stakedBalance(alice.address)).to.equal(0);
      expect(await invoiceVault.balanceOf(alice.address)).to.equal(vInvBalance);
    });

    it("Rejects zero-value stake and excessive withdrawal", async function () {
      await expect(invoiceFarm.connect(alice).stake(0)).to.be.revertedWithCustomError(
        invoiceFarm,
        "ZeroAmount"
      );

      await expect(
        invoiceFarm.connect(alice).withdraw(parseINVX(50))
      ).to.be.revertedWithCustomError(invoiceFarm, "InsufficientStake");
    });

    it("Utilization-aware emissions boost rewards when vault utilization is low", async function () {
      // Fund farm
      await invx.mint(await invoiceFarm.getAddress(), parseINVX(1000));
      await invoiceFarm.notifyRewardAmount(parseINVX(100), 1000);

      const initialRate = await invoiceFarm.rewardRate();

      // Low vault utilization (20% = 2,000 bps) -> idle liquidity is 80%
      await invoiceFarm.setUtilizationIncentive(2000);

      const boostedRate = await invoiceFarm.rewardRate();
      expect(boostedRate).to.be.greaterThan(initialRate);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 3. Part 2: Staking & Supplier Tiers (ReserveStaking.sol)
  // ─────────────────────────────────────────────────────────────
  describe("Part 2: Protocol Token Staking & Supplier Tiers (SimpleStaking / ReserveStaking)", function () {
    it("Verifies Lab doc values: 100 stake, 0.001 rate, ~6 reward over 60s, partial 40 unstake, exit", async function () {
      // Fund ReserveStaking with 500 mUSDC rewards
      await mockUsdc.mint(await reserveStaking.getAddress(), parseUSDC(500));

      // Alice stakes 100 INVX
      await invx.connect(alice).approve(await reserveStaking.getAddress(), parseINVX(100));
      await reserveStaking.connect(alice).stake(parseINVX(100));

      expect(await reserveStaking.stakedBalance(alice.address)).to.equal(parseINVX(100));

      // Set simulation rate: 0.1 mUSDC/s for 100 tokens
      const ratePerSec = parseUSDC("0.1");
      await reserveStaking.setRewardRateDirect(ratePerSec, 3600);

      // Fast forward 60 seconds
      await ethers.provider.send("evm_increaseTime", [60]);
      await ethers.provider.send("evm_mine", []);

      // Check earned: approx 6.0 mUSDC
      const earned = await reserveStaking.earned(alice.address);
      const earnedVal = Number(ethers.formatUnits(earned, 6));
      expect(earnedVal).to.be.closeTo(6.0, 0.2);

      // Claim reward
      const balBefore = await mockUsdc.balanceOf(alice.address);
      await reserveStaking.connect(alice).claimReward();
      const balAfter = await mockUsdc.balanceOf(alice.address);
      expect(Number(ethers.formatUnits(balAfter - balBefore, 6))).to.be.closeTo(6.0, 0.25);

      // Partial unstake 40 INVX
      await reserveStaking.connect(alice).unstake(parseINVX(40));
      expect(await reserveStaking.stakedBalance(alice.address)).to.equal(parseINVX(60));

      // Exit recovers remaining 60 INVX
      await reserveStaking.connect(alice).exit();
      expect(await reserveStaking.stakedBalance(alice.address)).to.equal(0);
    });

    it("Correctly categorizes supplier tiers & fee discounts", async function () {
      // Bronze tier (0 INVX)
      expect(await reserveStaking.getSupplierTier(supplier.address)).to.equal(0);
      expect(await reserveStaking.feeDiscountBps(supplier.address)).to.equal(0);
      expect(await reserveStaking.financingLimit(supplier.address)).to.equal(parseUSDC(10_000));

      // Stake 1,000 INVX -> Silver tier (100 bps discount)
      await invx.connect(supplier).approve(await reserveStaking.getAddress(), parseINVX(1500));
      await reserveStaking.connect(supplier).stake(parseINVX(1500));

      expect(await reserveStaking.getSupplierTier(supplier.address)).to.equal(1);
      expect(await reserveStaking.feeDiscountBps(supplier.address)).to.equal(100);
      expect(await reserveStaking.financingLimit(supplier.address)).to.equal(parseUSDC(50_000));

      // Stake additional 4,000 INVX (total 5,500) -> Gold tier (250 bps discount)
      await invx.connect(supplier).approve(await reserveStaking.getAddress(), parseINVX(4000));
      await reserveStaking.connect(supplier).stake(parseINVX(4000));

      expect(await reserveStaking.getSupplierTier(supplier.address)).to.equal(2);
      expect(await reserveStaking.feeDiscountBps(supplier.address)).to.equal(250);
      expect(await reserveStaking.financingLimit(supplier.address)).to.equal(parseUSDC(200_000));
    });

    it("Enforces Unstake Lock Rule while an invoice is active", async function () {
      // Supplier stakes 2,000 INVX (Silver)
      await invx.connect(supplier).approve(await reserveStaking.getAddress(), parseINVX(2000));
      await reserveStaking.connect(supplier).stake(parseINVX(2000));

      // Authorize deployer as locker for this test
      await reserveStaking.setAuthorizedLocker(deployer.address);

      // Supplier finances an invoice requiring 1,000 INVX minimum locked
      await reserveStaking.lockSupplierStake(supplier.address, parseINVX(1000));

      // Supplier can unstake up to 1,000 INVX
      await reserveStaking.connect(supplier).unstake(parseINVX(500));
      expect(await reserveStaking.stakedBalance(supplier.address)).to.equal(parseINVX(1500));

      // Attempting to unstake beyond locked limit (e.g. 600 more, leaving 900 < 1000) MUST revert!
      await expect(
        reserveStaking.connect(supplier).unstake(parseINVX(600))
      ).to.be.revertedWithCustomError(reserveStaking, "StakeIsLocked");

      // Once invoice is repaid, unlock stake
      await reserveStaking.unlockSupplierStake(supplier.address);

      // Now supplier can unstake remaining tokens freely
      await reserveStaking.connect(supplier).unstake(parseINVX(1500));
      expect(await reserveStaking.stakedBalance(supplier.address)).to.equal(0);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 4. FeeRouter: Repayment Split Verification
  // ─────────────────────────────────────────────────────────────
  describe("FeeRouter: Automated Split of Real Yield", function () {
    it("Routes 70% to Vault, 20% to ReserveStaking, and 10% to Insurance Reserve", async function () {
      const principal = parseUSDC(1000);
      const interest = parseUSDC(100); // 100 mUSDC interest

      // Alice stakes INVX in ReserveStaking to receive real yield
      await invx.connect(alice).approve(await reserveStaking.getAddress(), parseINVX(1000));
      await reserveStaking.connect(alice).stake(parseINVX(1000));

      // Supplier approves FeeRouter for 1,100 mUSDC
      await mockUsdc.connect(supplier).approve(await feeRouter.getAddress(), parseUSDC(1100));

      const insuranceBefore = await mockUsdc.balanceOf(insurancePool.address);

      // Route repayment
      await feeRouter.connect(supplier).routeRepayment(principal, interest);

      // 1. Vault received 1000 principal + 70 interest = 1070 mUSDC
      expect(await mockUsdc.balanceOf(await invoiceVault.getAddress())).to.equal(parseUSDC(1070));

      // 2. ReserveStaking received 20 mUSDC (notified as reward)
      expect(await mockUsdc.balanceOf(await reserveStaking.getAddress())).to.equal(parseUSDC(20));

      // 3. Insurance pool received 10 mUSDC
      const insuranceAfter = await mockUsdc.balanceOf(insurancePool.address);
      expect(insuranceAfter - insuranceBefore).to.equal(parseUSDC(10));
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 5. TierGate: On-Chain Enforcement (Task 1 Requirements)
  // ─────────────────────────────────────────────────────────────
  describe("TierGate: On-Chain Tier Enforcement, Limits & Unstake Locking", function () {
    let invoiceNFT, tierGate;

    beforeEach(async function () {
      // Deploy InvoiceNFT
      const InvoiceNFT = await ethers.getContractFactory("InvoiceNFT");
      invoiceNFT = await InvoiceNFT.deploy();
      await invoiceNFT.waitForDeployment();

      // Deploy TierGate wrapping InvoiceNFT and hooking ReserveStaking
      const TierGate = await ethers.getContractFactory("TierGate");
      tierGate = await TierGate.deploy(
        await invoiceNFT.getAddress(),
        await reserveStaking.getAddress()
      );
      await tierGate.waitForDeployment();

      // Authorize TierGate as a locker in ReserveStaking
      await reserveStaking.setAuthorizedLocker(await tierGate.getAddress());
    });

    it("Applies tier discount on-chain and locks supplier stake on financing", async function () {
      // Supplier stakes 1,500 INVX (Silver Tier: 100 bps discount, $50,000 limit)
      await invx.connect(supplier).approve(await reserveStaking.getAddress(), parseINVX(1500));
      await reserveStaking.connect(supplier).stake(parseINVX(1500));

      // Supplier mints an invoice of 1 ETH (1e18 wei)
      const invoiceAmount = ethers.parseEther("1.0");
      await invoiceNFT.connect(supplier).mintInvoice(
        supplier.address,
        "INV-TEST-001",
        invoiceAmount,
        30,
        "ipfs://test"
      );

      // Silver tier has 100 bps (1%) discount. Base fee is 300 bps (3%).
      // Effective fee = 300 - 100 = 200 bps (2%).
      // Required payment = 1.0 ETH + 0.02 ETH = 1.02 ETH.
      const requiredPay = ethers.parseEther("1.02");

      const supplierEthBefore = await ethers.provider.getBalance(supplier.address);

      // Alice finances the invoice through TierGate
      await tierGate.connect(alice).financeWithTier(0, { value: requiredPay });

      // Supplier received 1.0 ETH payout directly
      const supplierEthAfter = await ethers.provider.getBalance(supplier.address);
      expect(supplierEthAfter - supplierEthBefore).to.equal(invoiceAmount);

      // On-chain invoice is marked financed
      const invoiceData = await invoiceNFT.getInvoice(0);
      expect(invoiceData.isFinanced).to.equal(true);

      // Crucial: Supplier stake is now LOCKED on-chain at Silver threshold (1,000 INVX)!
      // Supplier cannot unstake below 1,000 INVX while invoice is unpaid
      expect(await reserveStaking.lockedStake(supplier.address)).to.equal(parseINVX(1000));

      await expect(
        reserveStaking.connect(supplier).unstake(parseINVX(600)) // 1500 - 600 = 900 < 1000 locked
      ).to.be.revertedWithCustomError(reserveStaking, "StakeIsLocked");

      // Supplier can unstake up to unlocked surplus (500 INVX)
      await reserveStaking.connect(supplier).unstake(parseINVX(500));
      expect(await reserveStaking.stakedBalance(supplier.address)).to.equal(parseINVX(1000));

      // Settle repayment & unlock supplier stake
      await tierGate.connect(supplier).settleRepaymentAndUnlock(0);

      // Locked stake is now 0!
      expect(await reserveStaking.lockedStake(supplier.address)).to.equal(0);

      // Now supplier can freely unstake remaining 1,000 INVX
      await reserveStaking.connect(supplier).unstake(parseINVX(1000));
      expect(await reserveStaking.stakedBalance(supplier.address)).to.equal(0);
    });

    it("Reverts on-chain if invoice amount exceeds supplier financing limit", async function () {
      // Bronze supplier (0 INVX) has bronzeLimit = 10,000 mUSDC ($10,000).
      // Mint invoice of 50 ETH (50 * $2,500 = $125,000 > $10,000 bronze limit).
      const bigAmount = ethers.parseEther("50.0");
      await invoiceNFT.connect(supplier).mintInvoice(
        supplier.address,
        "INV-OVERLIMIT",
        bigAmount,
        30,
        "ipfs://test"
      );

      // Attempting to finance through TierGate must revert on-chain with ExceedsTierFinancingLimit!
      const totalPay = ethers.parseEther("51.5");
      await expect(
        tierGate.connect(alice).financeWithTier(0, { value: totalPay })
      ).to.be.revertedWithCustomError(tierGate, "ExceedsTierFinancingLimit");
    });

    it("Hook disabled path (address(0)): standard financing works without tier lock or discount", async function () {
      // Set hook to address(0)
      await tierGate.setReserveStakingHook(ethers.ZeroAddress);

      const invoiceAmount = ethers.parseEther("0.5");
      await invoiceNFT.connect(supplier).mintInvoice(
        supplier.address,
        "INV-NOHOOK",
        invoiceAmount,
        30,
        "ipfs://test"
      );

      // Base fee is 300 bps (3%) -> 0.5 * 0.03 = 0.015 ETH -> total 0.515 ETH
      const payment = ethers.parseEther("0.515");
      await tierGate.connect(alice).financeWithTier(0, { value: payment });

      const invoiceData = await invoiceNFT.getInvoice(0);
      expect(invoiceData.isFinanced).to.equal(true);

      // Supplier stake was not locked
      expect(await reserveStaking.lockedStake(supplier.address)).to.equal(0);
    });
  });
});
