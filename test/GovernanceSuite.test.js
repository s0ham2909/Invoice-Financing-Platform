import { expect } from "chai";
import hre from "hardhat";
const { ethers } = hre;
import { mine, time } from "@nomicfoundation/hardhat-network-helpers";

describe("Governance Comprehensive Test Suite (Step 6 Verification)", function () {
  let dtest;
  let invx;
  let mockUsdc;
  let reserveStaking;
  let invoiceNFT;
  let tierGate;
  let platformConfig;
  let governance;

  let owner;
  let alice;
  let bob;
  let charlie;
  let supplier;
  let investor;
  let treasury;

  const PROPOSAL_THRESHOLD = ethers.parseEther("100");
  const VOTING_DELAY_BLOCKS = 0; // Previous-block snapshot, full timed voting window
  const VOTING_PERIOD_SECONDS = 180; // 3 minutes
  const QUORUM_BPS = 400; // 4%
  const MAJORITY_BPS = 5001; // >50%
  const TIMELOCK_DELAY = 60; // 1 minute
  const QUEUE_WINDOW = 3600; // 1 hour
  const GRACE_PERIOD = 3600; // 1 hour

  beforeEach(async function () {
    [owner, alice, bob, charlie, supplier, investor, treasury] = await ethers.getSigners();

    // 1. Deploy DTEST Token
    const DTESTFactory = await ethers.getContractFactory("DTEST");
    dtest = await DTESTFactory.deploy(ethers.parseEther("1000000"), owner.address);
    await dtest.waitForDeployment();

    // 2. Deploy INVX & MockUSDC
    const MockERC20Factory = await ethers.getContractFactory("contracts/MockERC20.sol:MockERC20");
    invx = await MockERC20Factory.deploy("INVX Protocol Token", "INVX");
    await invx.waitForDeployment();

    const MockUSDCFactory = await ethers.getContractFactory("MockUSDC");
    mockUsdc = await MockUSDCFactory.deploy();
    await mockUsdc.waitForDeployment();

    // 3. Deploy ReserveStaking
    const StakingFactory = await ethers.getContractFactory("ReserveStaking");
    reserveStaking = await StakingFactory.deploy(await invx.getAddress(), await mockUsdc.getAddress());
    await reserveStaking.waitForDeployment();

    // 4. Deploy InvoiceNFT
    const InvoiceNFTFactory = await ethers.getContractFactory("InvoiceNFT");
    invoiceNFT = await InvoiceNFTFactory.deploy();
    await invoiceNFT.waitForDeployment();

    // 5. Deploy TierGate
    const TierGateFactory = await ethers.getContractFactory("TierGate");
    tierGate = await TierGateFactory.deploy(await invoiceNFT.getAddress(), await reserveStaking.getAddress());
    await tierGate.waitForDeployment();

    // 6. Deploy Governance
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
    governance = await GovernanceFactory.deploy(await dtest.getAddress(), params, owner.address);
    await governance.waitForDeployment();

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

    // Authorize PlatformConfig in ReserveStaking
    await reserveStaking.setAuthorizedLockerStatus(await platformConfig.getAddress(), true);

    // Whitelist PlatformConfig target & selectors in Governance
    const configAddr = await platformConfig.getAddress();
    await governance.setTargetWhitelisted(configAddr, true);

    const setFeeSel = platformConfig.interface.getFunction("setPlatformFeeBps").selector;
    const penaltySel = platformConfig.interface.getFunction("applyDefaultPenalty").selector;

    await governance.setTargetSelector(configAddr, setFeeSel, 1, true); // PARAM_CHANGE = 1
    await governance.setTargetSelector(configAddr, penaltySel, 0, true); // DEFAULT_PENALTY = 0

    // Transfer ownership of PlatformConfig and TierGate to Governance
    await platformConfig.transferOwnership(await governance.getAddress());
    await tierGate.transferOwnership(await platformConfig.getAddress());
    await invoiceNFT.transferOwnership(await platformConfig.getAddress());

    // Seed voting accounts with DTEST and self-delegate
    // Alice: 50,000 DTEST (5% of 1M supply, satisfies quorum)
    await dtest.transfer(alice.address, ethers.parseEther("50000"));
    await dtest.connect(alice).delegate(alice.address);

    // Bob: 20,000 DTEST
    await dtest.transfer(bob.address, ethers.parseEther("20000"));
    await dtest.connect(bob).delegate(bob.address);

    // Charlie: 20,000 DTEST
    await dtest.transfer(charlie.address, ethers.parseEther("20000"));
    await dtest.connect(charlie).delegate(charlie.address);

    // Seed Supplier with INVX and stake 1,000 INVX in ReserveStaking
    await invx.transfer(supplier.address, ethers.parseEther("2000"));
    await invx.connect(supplier).approve(await reserveStaking.getAddress(), ethers.MaxUint256);
    await reserveStaking.connect(supplier).stake(ethers.parseEther("1000"));

    await mine(1);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 1. Proposal Creation
  // ─────────────────────────────────────────────────────────────────────────────
  describe("1. Proposal Creation", function () {
    it("Creates a valid proposal and emits ProposalCreated", async function () {
      const data = platformConfig.interface.encodeFunctionData("setPlatformFeeBps", [120]);
      await expect(
        governance.connect(alice).propose(1, "Fee to 1.2%", await platformConfig.getAddress(), data)
      ).to.emit(governance, "ProposalCreated");

      const p = await governance.getProposal(1);
      expect(p.id).to.equal(1);
      expect(p.proposer).to.equal(alice.address);
      expect(p.target).to.equal(await platformConfig.getAddress());
      expect(p.proposalType).to.equal(1);
    });

    it("Reverts when description is empty", async function () {
      const data = platformConfig.interface.encodeFunctionData("setPlatformFeeBps", [120]);
      await expect(
        governance.connect(alice).propose(1, "", await platformConfig.getAddress(), data)
      ).to.be.revertedWithCustomError(governance, "EmptyDescription");
    });

    it("Reverts when proposer voting power is below threshold", async function () {
      const [stranger] = await ethers.getSigners();
      // Stranger with 0 DTEST attempts to propose
      const data = platformConfig.interface.encodeFunctionData("setPlatformFeeBps", [120]);
      await expect(
        governance.connect(investor).propose(1, "Fee change", await platformConfig.getAddress(), data)
      ).to.be.revertedWithCustomError(governance, "BelowProposalThreshold");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 2. Voting Mechanics
  // ─────────────────────────────────────────────────────────────────────────────
  describe("2. Voting Mechanics", function () {
    let proposalId;

    beforeEach(async function () {
      const data = platformConfig.interface.encodeFunctionData("setPlatformFeeBps", [150]);
      const tx = await governance.connect(alice).propose(1, "Fee update", await platformConfig.getAddress(), data);
      await tx.wait();
      proposalId = 1;
    });

    it("Casts valid votes (For, Against, Abstain) and tracks weight accurately", async function () {
      await mine(VOTING_DELAY_BLOCKS + 1); // Activate voting

      await expect(governance.connect(alice).castVote(proposalId, 1)) // For
        .to.emit(governance, "VoteCast")
        .withArgs(alice.address, proposalId, 1, ethers.parseEther("50000"));

      await expect(governance.connect(bob).castVote(proposalId, 0)) // Against
        .to.emit(governance, "VoteCast")
        .withArgs(bob.address, proposalId, 0, ethers.parseEther("20000"));

      await expect(governance.connect(charlie).castVote(proposalId, 2)) // Abstain
        .to.emit(governance, "VoteCast")
        .withArgs(charlie.address, proposalId, 2, ethers.parseEther("20000"));

      const p = await governance.getProposal(proposalId);
      expect(p.votesFor).to.equal(ethers.parseEther("50000"));
      expect(p.votesAgainst).to.equal(ethers.parseEther("20000"));
      expect(p.votesAbstain).to.equal(ethers.parseEther("20000"));
    });

    it("Reverts double voting by the same address", async function () {
      await mine(VOTING_DELAY_BLOCKS + 1);
      await governance.connect(alice).castVote(proposalId, 1);

      await expect(
        governance.connect(alice).castVote(proposalId, 1)
      ).to.be.revertedWithCustomError(governance, "AlreadyVoted");
    });

    it("Reverts voting after the deadline has elapsed", async function () {
      await mine(VOTING_DELAY_BLOCKS + 1);
      await time.increase(VOTING_PERIOD_SECONDS + 10);

      await expect(
        governance.connect(alice).castVote(proposalId, 1)
      ).to.be.revertedWithCustomError(governance, "InvalidState");
    });

    it("Reverts vote from address with zero voting power at snapshot", async function () {
      await mine(VOTING_DELAY_BLOCKS + 1);
      await expect(
        governance.connect(investor).castVote(proposalId, 1)
      ).to.be.revertedWithCustomError(governance, "ZeroVotingPower");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 3. Quorum, Tie & Majority Outcomes
  // ─────────────────────────────────────────────────────────────────────────────
  describe("3. Quorum, Tie & Majority Outcomes", function () {
    it("Outcome: Defeated when quorum is NOT reached even if votesFor > votesAgainst", async function () {
      // Bob votes with 20k DTEST (Quorum requires 40k = 4% of 1M supply)
      const data = platformConfig.interface.encodeFunctionData("setPlatformFeeBps", [150]);
      await governance.connect(bob).propose(1, "Low turnout", await platformConfig.getAddress(), data);

      await mine(VOTING_DELAY_BLOCKS + 1);
      await governance.connect(bob).castVote(1, 1); // 20k For

      await time.increase(VOTING_PERIOD_SECONDS + 1);

      // Defeated (2) because 20k < 40k quorum
      expect(await governance.state(1)).to.equal(2);
    });

    it("Outcome: Defeated on an exact tie (votesFor == votesAgainst)", async function () {
      // Alice gives 20k each to Bob and Charlie (both meet proposal threshold)
      const data = platformConfig.interface.encodeFunctionData("setPlatformFeeBps", [150]);
      await governance.connect(bob).propose(1, "Tie vote", await platformConfig.getAddress(), data);

      await mine(VOTING_DELAY_BLOCKS + 1);
      await governance.connect(bob).castVote(1, 1);    // 20k For
      await governance.connect(charlie).castVote(1, 0); // 20k Against

      await time.increase(VOTING_PERIOD_SECONDS + 1);

      // Total = 40k (quorum reached), but votesFor (20k) is NOT > votesAgainst (20k)
      expect(await governance.state(1)).to.equal(2); // Defeated
    });

    it("Outcome: Succeeded when quorum is met and simple majority voted For", async function () {
      const data = platformConfig.interface.encodeFunctionData("setPlatformFeeBps", [150]);
      await governance.connect(alice).propose(1, "Passing vote", await platformConfig.getAddress(), data);

      await mine(VOTING_DELAY_BLOCKS + 1);
      await governance.connect(alice).castVote(1, 1);   // 50k For
      await governance.connect(bob).castVote(1, 0);     // 20k Against

      await time.increase(VOTING_PERIOD_SECONDS + 1);

      // 50k For > 20k Against; 70k > 40k Quorum -> Succeeded (3)
      expect(await governance.state(1)).to.equal(3);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 4. Timelock Execution & Reentrancy Guards
  // ─────────────────────────────────────────────────────────────────────────────
  describe("4. Timelock Execution & Reentrancy Guards", function () {
    let proposalId;

    beforeEach(async function () {
      const data = platformConfig.interface.encodeFunctionData("setPlatformFeeBps", [150]);
      await governance.connect(alice).propose(1, "Fee change", await platformConfig.getAddress(), data);
      await mine(VOTING_DELAY_BLOCKS + 1);
      await governance.connect(alice).castVote(1, 1);
      await time.increase(VOTING_PERIOD_SECONDS + 1);
      proposalId = 1;
    });

    it("Reverts execution before the proposal is queued", async function () {
      await expect(
        governance.execute(proposalId)
      ).to.be.revertedWithCustomError(governance, "InvalidState");
    });

    it("Reverts execution before the timelock delay has elapsed", async function () {
      await governance.queue(proposalId);
      expect(await governance.state(proposalId)).to.equal(4); // Queued

      // Advance only 30s (timelockDelay is 60s)
      await time.increase(30);

      await expect(
        governance.execute(proposalId)
      ).to.be.revertedWithCustomError(governance, "TimelockNotMet");
    });

    it("Reverts double execution", async function () {
      await governance.queue(proposalId);
      await time.increase(TIMELOCK_DELAY + 1);

      await governance.execute(proposalId);
      expect(await governance.state(proposalId)).to.equal(5); // Executed

      await expect(
        governance.execute(proposalId)
      ).to.be.revertedWithCustomError(governance, "InvalidState");
    });

    it("Reverts direct unauthorized call to PlatformConfig functions", async function () {
      await expect(
        platformConfig.connect(alice).setPlatformFeeBps(100)
      ).to.be.revertedWithCustomError(platformConfig, "OwnableUnauthorizedAccount");

      await expect(
        platformConfig.connect(owner).applyDefaultPenalty(0, supplier.address, ethers.parseEther("100"), "Fraud")
      ).to.be.revertedWithCustomError(platformConfig, "OwnableUnauthorizedAccount");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 5. Complete End-to-End Invoice Default -> Penalty Workflow
  // ─────────────────────────────────────────────────────────────────────────────
  describe("5. End-to-End Invoice Default & Penalty Execution", function () {
    it("Full workflow: Mint invoice -> Finance -> Default after due date -> DAO Proposal -> Vote -> Timelock -> Slash Supplier Stake", async function () {
      // Step A: Supplier mints an invoice NFT for 5 ETH, due in 7 days
      const invoiceAmount = ethers.parseEther("5");
      await invoiceNFT.connect(supplier).mintInvoice(supplier.address, "INV-2026-001", invoiceAmount, 7, "ipfs://meta");
      const invoiceId = 0;

      // Step B: Investor finances the invoice
      await invoiceNFT.connect(investor).financeInvoice(invoiceId, { value: invoiceAmount });
      let inv = await invoiceNFT.getInvoice(invoiceId);
      expect(inv.isFinanced).to.equal(true);

      // Step C: Fast-forward 8 days (past due date) - Invoice is now in DEFAULT!
      await time.increase(8 * 86400);
      expect(await time.latest()).to.be.gt(inv.dueDate);

      // Step D: Supplier currently has 1,000 INVX staked in ReserveStaking
      expect(await reserveStaking.stakedBalance(supplier.address)).to.equal(ethers.parseEther("1000"));
      const treasuryBefore = await invx.balanceOf(treasury.address);

      // Step E: Alice creates DEFAULT_PENALTY proposal to slash 300 INVX from supplier
      const slashAmount = ethers.parseEther("300");
      const penaltyCalldata = platformConfig.interface.encodeFunctionData("applyDefaultPenalty", [
        invoiceId,
        supplier.address,
        slashAmount,
        "Overdue default on INV-2026-001",
      ]);

      await governance.connect(alice).propose(
        0, // DEFAULT_PENALTY
        "Slash 300 INVX from supplier for default on invoice #1",
        await platformConfig.getAddress(),
        penaltyCalldata
      );
      const proposalId = 1;

      // Step F: Mining blocks past snapshotBlock -> voting window opens
      await mine(VOTING_DELAY_BLOCKS + 1);
      expect(await governance.state(proposalId)).to.equal(1); // Active

      // Step G: DAO members vote
      await governance.connect(alice).castVote(proposalId, 1); // 50k For
      await governance.connect(bob).castVote(proposalId, 1);   // 20k For

      // Step H: Voting period ends -> Proposal Succeeded
      await time.increase(VOTING_PERIOD_SECONDS + 1);
      expect(await governance.state(proposalId)).to.equal(3); // Succeeded

      // Step I: Queue in timelock
      await governance.queue(proposalId);
      expect(await governance.state(proposalId)).to.equal(4); // Queued

      // Step J: Timelock elapses
      await time.increase(TIMELOCK_DELAY + 1);

      // Step K: Execute proposal!
      await expect(governance.execute(proposalId))
        .to.emit(governance, "ProposalExecuted")
        .withArgs(proposalId);

      // Step L: Verify on-chain collateral slashing results!
      // 1. Supplier's stake reduced by 300 INVX (from 1,000 to 700)
      expect(await reserveStaking.stakedBalance(supplier.address)).to.equal(ethers.parseEther("700"));
      expect(await reserveStaking.totalStaked()).to.equal(ethers.parseEther("700"));

      // 2. Treasury received the 300 INVX slashed tokens
      expect(await invx.balanceOf(treasury.address)).to.equal(treasuryBefore + slashAmount);

      // 3. PlatformConfig recorded penalty history
      expect(await platformConfig.totalPenaltiesSlashed(supplier.address)).to.equal(slashAmount);
    });
  });
});
