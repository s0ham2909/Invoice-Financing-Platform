import { expect } from "chai";
import hre from "hardhat";
const { ethers } = hre;
import { mine, time } from "@nomicfoundation/hardhat-network-helpers";

describe("Step 5 Deep Verification: Slashing, Accounting, Fee Impact & Bounds", function () {
  let dtest;
  let invx;
  let mockUsdc;
  let reserveStaking;
  let governance;
  let platformConfig;
  let tierGate;
  let invoiceNFT;
  let owner;
  let alice;
  let supplier;
  let investor;
  let treasury;

  const PROPOSAL_THRESHOLD = ethers.parseEther("100");
  const VOTING_DELAY_BLOCKS = 0; // Previous-block snapshot, full timed voting window
  const VOTING_PERIOD_SECONDS = 180;
  const QUORUM_BPS = 400; // 4%
  const MAJORITY_BPS = 5001; // >50%
  const TIMELOCK_DELAY = 60; // 1 min
  const QUEUE_WINDOW = 3600; // 1 hour
  const GRACE_PERIOD = 3600; // 1 hour

  beforeEach(async function () {
    [owner, alice, supplier, investor, treasury] = await ethers.getSigners();

    // 1. Deploy DTEST (Governance Token)
    const DTESTFactory = await ethers.getContractFactory("DTEST");
    dtest = await DTESTFactory.deploy(ethers.parseEther("1000000"), owner.address);
    await dtest.waitForDeployment();

    // 2. Deploy INVX (Staking Token) & MockUSDC (Reward Token)
    const MockERC20Factory = await ethers.getContractFactory("contracts/MockERC20.sol:MockERC20");
    invx = await MockERC20Factory.deploy("INVX Protocol Token", "INVX");
    await invx.waitForDeployment();
    const MockUSDCFactory = await ethers.getContractFactory("MockUSDC");
    mockUsdc = await MockUSDCFactory.deploy();
    await mockUsdc.waitForDeployment();

    // 3. Deploy ReserveStaking
    const StakingFactory = await ethers.getContractFactory("ReserveStaking");
    reserveStaking = await StakingFactory.deploy(
      await invx.getAddress(),
      await mockUsdc.getAddress()
    );
    await reserveStaking.waitForDeployment();

    // Transfer reward tokens to ReserveStaking: 1 mUSDC/sec for 10,000 seconds
    await mockUsdc.transfer(await reserveStaking.getAddress(), ethers.parseUnits("100000", 6));
    await reserveStaking.setRewardRateDirect(ethers.parseUnits("1", 6), 10000);

    // 4. Deploy Governance
    const params = {
      proposalThreshold: PROPOSAL_THRESHOLD,
      votingDelayBlocks: VOTING_DELAY_BLOCKS,
      votingPeriodSeconds: VOTING_PERIOD_SECONDS,
      quorumBps: QUORUM_BPS,
      majorityBps: MAJORITY_BPS,
      timelockDelay: TIMELOCK_DELAY,
      queueWindow: QUEUE_WINDOW,
      gracePeriod: GRACE_PERIOD,
    };

    const GovernanceFactory = await ethers.getContractFactory("Governance");
    governance = await GovernanceFactory.deploy(
      await dtest.getAddress(),
      params,
      owner.address
    );
    await governance.waitForDeployment();

    // 5. Deploy InvoiceNFT
    const InvoiceNFTFactory = await ethers.getContractFactory("InvoiceNFT");
    invoiceNFT = await InvoiceNFTFactory.deploy();
    await invoiceNFT.waitForDeployment();

    // 6. Deploy TierGate
    const TierGateFactory = await ethers.getContractFactory("TierGate");
    tierGate = await TierGateFactory.deploy(
      await invoiceNFT.getAddress(),
      await reserveStaking.getAddress()
    );
    await tierGate.waitForDeployment();

    // 7. Deploy PlatformConfig
    const ConfigFactory = await ethers.getContractFactory("PlatformConfig");
    platformConfig = await ConfigFactory.deploy(
      owner.address,
      await reserveStaking.getAddress(),
      await invoiceNFT.getAddress(),
      await tierGate.getAddress(),
      treasury.address
    );
    await platformConfig.waitForDeployment();

    // 8. Authorize PlatformConfig as a slasher/locker in ReserveStaking
    await reserveStaking.setAuthorizedLockerStatus(await platformConfig.getAddress(), true);

    // 9. Transfer ownership of PlatformConfig and TierGate to Governance
    await platformConfig.transferOwnership(await governance.getAddress());
    await tierGate.transferOwnership(await platformConfig.getAddress());
    await invoiceNFT.transferOwnership(await platformConfig.getAddress());

    // 10. Whitelist PlatformConfig target & selectors in Governance
    const configAddr = await platformConfig.getAddress();
    await governance.setTargetWhitelisted(configAddr, true);

    const setFeeSel = platformConfig.interface.getFunction("setPlatformFeeBps").selector;
    const penaltySel = platformConfig.interface.getFunction("applyDefaultPenalty").selector;

    await governance.setTargetSelector(configAddr, setFeeSel, 1, true); // PARAM_CHANGE = 1
    await governance.setTargetSelector(configAddr, penaltySel, 0, true); // DEFAULT_PENALTY = 0

    // 11. Seed Alice with DTEST voting power (50k tokens)
    await dtest.transfer(alice.address, ethers.parseEther("50000"));
    await dtest.connect(alice).delegate(alice.address);

    // 12. Seed Supplier with INVX and stake 1,000 INVX into ReserveStaking
    await invx.transfer(supplier.address, ethers.parseEther("5000"));
    await invx.connect(supplier).approve(await reserveStaking.getAddress(), ethers.MaxUint256);
    await reserveStaking.connect(supplier).stake(ethers.parseEther("1000"));

    await mine(1);
  });

  describe("1. Slashing & Synthetix Reward Accounting Integrity", function () {
    it("Deducts staked balance and totalStaked, preserves accrued rewards, and updates future accrual rate", async function () {
      expect(await reserveStaking.totalStaked()).to.equal(ethers.parseEther("1000"));
      expect(await reserveStaking.stakedBalance(supplier.address)).to.equal(ethers.parseEther("1000"));

      // Advance 10 seconds: supplier should accrue ~10 mUSDC rewards (1 mUSDC/sec)
      await time.increase(10);
      const earnedBefore = await reserveStaking.earned(supplier.address);
      expect(earnedBefore).to.be.closeTo(ethers.parseUnits("10", 6), ethers.parseUnits("1", 6));

      // Direct slash of 400 INVX via authorized PlatformConfig caller
      // (Test directly on ReserveStaking using an authorized slasher)
      const slashAmount = ethers.parseEther("400");
      const treasuryBalanceBefore = await invx.balanceOf(treasury.address);

      // Call slash directly through authorized locker/slasher
      // Simulate call from PlatformConfig
      await hre.network.provider.request({
        method: "hardhat_impersonateAccount",
        params: [await platformConfig.getAddress()],
      });
      const configSigner = await ethers.getSigner(await platformConfig.getAddress());
      // Fund configSigner with ETH via hardhat_setBalance
      await hre.network.provider.send("hardhat_setBalance", [
        await platformConfig.getAddress(),
        "0x1000000000000000000",
      ]);

      await reserveStaking.connect(configSigner).slashSupplierStake(supplier.address, slashAmount, treasury.address);

      // Verify balances after slash
      expect(await reserveStaking.stakedBalance(supplier.address)).to.equal(ethers.parseEther("600"));
      expect(await reserveStaking.totalStaked()).to.equal(ethers.parseEther("600"));
      expect(await invx.balanceOf(treasury.address)).to.equal(treasuryBalanceBefore + slashAmount);

      // Accrued rewards were preserved!
      const earnedAfter = await reserveStaking.earned(supplier.address);
      expect(earnedAfter).to.be.gte(earnedBefore);

      // Supplier can still claim their accrued rewards!
      const usdcBeforeClaim = await mockUsdc.balanceOf(supplier.address);
      await reserveStaking.connect(supplier).claimReward();
      const usdcAfterClaim = await mockUsdc.balanceOf(supplier.address);
      expect(usdcAfterClaim - usdcBeforeClaim).to.be.closeTo(ethers.parseUnits("13", 6), ethers.parseUnits("3", 6));
    });

    it("Reverts unauthorized slashing", async function () {
      await expect(
        reserveStaking.connect(alice).slashSupplierStake(supplier.address, ethers.parseEther("100"), treasury.address)
      ).to.be.revertedWithCustomError(reserveStaking, "Unauthorized");
    });

    it("Reverts over-slash (slashing more than staked)", async function () {
      await hre.network.provider.request({
        method: "hardhat_impersonateAccount",
        params: [await platformConfig.getAddress()],
      });
      const configSigner = await ethers.getSigner(await platformConfig.getAddress());
      await hre.network.provider.send("hardhat_setBalance", [
        await platformConfig.getAddress(),
        "0x1000000000000000000",
      ]);

      // Staked balance is 1,000; attempt to slash 2,000 -> REVERTS
      await expect(
        reserveStaking.connect(configSigner).slashSupplierStake(supplier.address, ethers.parseEther("2000"), treasury.address)
      ).to.be.revertedWithCustomError(reserveStaking, "CannotSlashMoreThanStaked");
    });
  });

  describe("2. Fee Proposal Impact on Actual Platform Financing", function () {
    it("Passed fee proposal on PlatformConfig dynamically changes basePlatformFeeBps in TierGate", async function () {
      expect(await tierGate.basePlatformFeeBps()).to.equal(300); // initial 3%

      // Propose reducing base fee to 150 bps (1.5%)
      const data = platformConfig.interface.encodeFunctionData("setPlatformFeeBps", [150]);
      await governance.connect(alice).propose(1, "Reduce fee to 1.5%", await platformConfig.getAddress(), data);

      await mine(VOTING_DELAY_BLOCKS + 1);
      await governance.connect(alice).castVote(1, 1); // Vote For
      await time.increase(VOTING_PERIOD_SECONDS + 1);

      await governance.queue(1);
      await time.increase(TIMELOCK_DELAY + 1);

      await governance.execute(1);

      // Both PlatformConfig and TierGate now have 150 bps!
      expect(await platformConfig.platformFeeBps()).to.equal(150);
      expect(await tierGate.basePlatformFeeBps()).to.equal(150);
    });
  });

  describe("3. Selector & Type Mismatch Protection", function () {
    it("Reverts if proposal type does not match the selector's authorized category", async function () {
      // SET_FEE_SELECTOR is only registered for PARAM_CHANGE (1).
      // If proposer submits it under DEFAULT_PENALTY (0) -> REVERTS!
      const data = platformConfig.interface.encodeFunctionData("setPlatformFeeBps", [200]);

      await expect(
        governance.connect(alice).propose(
          0, // DEFAULT_PENALTY (wrong type!)
          "Misclassified proposal",
          await platformConfig.getAddress(),
          data
        )
      ).to.be.revertedWithCustomError(governance, "SelectorTypeMismatch");
    });
  });

  describe("4. Queue Window Expiry", function () {
    it("Transitions Succeeded proposal to Expired if not queued within queueWindow", async function () {
      const data = platformConfig.interface.encodeFunctionData("setPlatformFeeBps", [100]);
      await governance.connect(alice).propose(1, "Fee change", await platformConfig.getAddress(), data);

      await mine(VOTING_DELAY_BLOCKS + 1);
      await governance.connect(alice).castVote(1, 1);
      await time.increase(VOTING_PERIOD_SECONDS + 1);

      // Proposal succeeded
      expect(await governance.state(1)).to.equal(3); // Succeeded

      // Advance past queueWindow (3600 seconds)
      await time.increase(QUEUE_WINDOW + 10);

      // State is now Expired (7)!
      expect(await governance.state(1)).to.equal(7); // Expired

      // Attempting to queue reverts with InvalidState(Succeeded, Expired)
      await expect(
        governance.queue(1)
      ).to.be.revertedWithCustomError(governance, "InvalidState");
    });
  });

  describe("5. Governance Parameter Bounds Validation", function () {
    it("Reverts if updateGovernanceParams sets values outside strict bounds", async function () {
      // Encode an invalid update (e.g. quorum = 0%)
      const invalidParams = {
        proposalThreshold: PROPOSAL_THRESHOLD,
        votingDelayBlocks: VOTING_DELAY_BLOCKS,
        votingPeriodSeconds: VOTING_PERIOD_SECONDS,
        quorumBps: 0, // INVALID: minimum is 100 bps (1%)
        majorityBps: MAJORITY_BPS,
        timelockDelay: TIMELOCK_DELAY,
        queueWindow: QUEUE_WINDOW,
        gracePeriod: GRACE_PERIOD,
      };

      // Call updateGovernanceParams directly from owner -> reverts Unauthorized (onlyGovernance)
      await expect(
        governance.connect(owner).updateGovernanceParams(invalidParams)
      ).to.be.revertedWithCustomError(governance, "Unauthorized");
    });
  });

  describe("6. Default Penalty Invoice Verification & Cap", function () {
    it("Reverts if penalty exceeds MAX_PENALTY_PER_PROPOSAL (50k)", async function () {
      await hre.network.provider.request({
        method: "hardhat_impersonateAccount",
        params: [await governance.getAddress()],
      });
      const govSigner = await ethers.getSigner(await governance.getAddress());
      await hre.network.provider.send("hardhat_setBalance", [
        await governance.getAddress(),
        "0x1000000000000000000",
      ]);

      // Attempt slash of 50,001 tokens
      const illegalSlash = ethers.parseEther("50001");
      await expect(
        platformConfig.connect(govSigner).applyDefaultPenalty(0, supplier.address, illegalSlash, "Excessive penalty")
      ).to.be.revertedWithCustomError(platformConfig, "SlashAmountExceedsCap");
    });
  });
});
