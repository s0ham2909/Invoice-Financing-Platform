import { expect } from "chai";
import hre from "hardhat";
const { ethers } = hre;
import { mine, time } from "@nomicfoundation/hardhat-network-helpers";

describe("Governance & DTEST Security Tests (Flash-loan & Snapshot Protection)", function () {
  let dtest;
  let governance;
  let owner;
  let alice;
  let bob;
  let attacker;
  let targetPlatform;

  const PROPOSAL_THRESHOLD = ethers.parseEther("100");
  const VOTING_DELAY_BLOCKS = 0; // Previous-block snapshot, full timed voting window
  const VOTING_PERIOD_SECONDS = 180; // 3 minutes
  const QUORUM_BPS = 400; // 4%
  const MAJORITY_BPS = 5001; // >50%
  const TIMELOCK_DELAY = 60; // 1 minute
  const GRACE_PERIOD = 3600; // 1 hour

  beforeEach(async function () {
    [owner, alice, bob, attacker, targetPlatform] = await ethers.getSigners();

    // 1. Deploy DTEST with 1,000,000 supply to owner
    const initialSupply = ethers.parseEther("1000000");
    const DTESTFactory = await ethers.getContractFactory("DTEST");
    dtest = await DTESTFactory.deploy(initialSupply, owner.address);
    await dtest.waitForDeployment();
    // Only these isolated faucet tests explicitly enable minting. Deployment leaves it disabled.
    await dtest.setFaucetEnabled(true);

    // 2. Deploy Governance
    const params = {
      proposalThreshold: PROPOSAL_THRESHOLD,
      votingDelayBlocks: VOTING_DELAY_BLOCKS,
      votingPeriodSeconds: VOTING_PERIOD_SECONDS,
      quorumBps: QUORUM_BPS,
      majorityBps: MAJORITY_BPS,
      timelockDelay: TIMELOCK_DELAY,
      queueWindow: 3600,
      gracePeriod: GRACE_PERIOD,
    };

    const GovernanceFactory = await ethers.getContractFactory("Governance");
    governance = await GovernanceFactory.deploy(
      await dtest.getAddress(),
      params,
      owner.address
    );
    await governance.waitForDeployment();

    // Deploy PlatformConfig as the legitimate contract target
    const ConfigFactory = await ethers.getContractFactory("PlatformConfig");
    const platformConfig = await ConfigFactory.deploy(
      owner.address,
      ethers.ZeroAddress,
      ethers.ZeroAddress,
      ethers.ZeroAddress,
      owner.address
    );
    await platformConfig.waitForDeployment();
    const configAddr = await platformConfig.getAddress();

    // Whitelist target & selector
    const dummySelector = "0x12345678";
    await governance.setTargetWhitelisted(configAddr, true);
    await governance.setTargetSelector(configAddr, dummySelector, 0, true);
    targetPlatform = { address: configAddr };

    // Seed Alice with 1,000 DTEST and self-delegate
    await dtest.transfer(alice.address, ethers.parseEther("1000"));
    await dtest.connect(alice).delegate(alice.address);
    // Mine a block so Alice's voting power is recorded in block history
    await mine(1);
  });

  describe("DTEST Faucet & Auto-Self-Delegation", function () {
    it("Auto-self-delegates when receiving faucet tokens if delegates == address(0)", async function () {
      expect(await dtest.delegates(bob.address)).to.equal(ethers.ZeroAddress);
      expect(await dtest.getVotes(bob.address)).to.equal(0n);

      await dtest.connect(bob).faucet(bob.address, ethers.parseEther("500"));

      expect(await dtest.delegates(bob.address)).to.equal(bob.address);
      expect(await dtest.getVotes(bob.address)).to.equal(ethers.parseEther("500"));
    });

    it("Owner can disable faucet and users can no longer draw from it", async function () {
      await dtest.connect(owner).setFaucetEnabled(false);
      expect(await dtest.faucetEnabled()).to.equal(false);

      await expect(
        dtest.connect(bob).faucet(bob.address, ethers.parseEther("100"))
      ).to.be.revertedWithCustomError(dtest, "FaucetDisabled");
    });
  });

  describe("Flash-Loan Attack Prevention on Proposal Creation", function () {
    it("Reverts proposal creation if attacker flash-borrows tokens in the same block/tx (pastVotes at block.number - 1 is zero)", async function () {
      // Deploy FlashLoanAttacker contract
      const AttackerFactory = await ethers.getContractFactory("FlashLoanAttacker");
      const attackContract = await AttackerFactory.deploy(
        await dtest.getAddress(),
        await governance.getAddress()
      );
      await attackContract.waitForDeployment();

      // Fund the attacker contract with 50,000 DTEST (simulate flash-loan funding)
      await dtest.connect(owner).transfer(await attackContract.getAddress(), ethers.parseEther("50000"));

      // In the same transaction/block, attacker attempts to propose
      // Governance inspects getPastVotes(attacker, block.number - 1) which was 0
      await expect(
        attackContract.executeFlashLoanAndPropose(targetPlatform.address)
      ).to.be.revertedWithCustomError(governance, "BelowProposalThreshold");
    });

    it("Allows proposal creation if proposer had required voting power at block.number - 1", async function () {
      // Alice already held 1,000 DTEST and delegated in previous blocks
      const currentBlock = await ethers.provider.getBlockNumber();
      const pastVotes = await dtest.getPastVotes(alice.address, currentBlock - 1);
      expect(pastVotes).to.be.gte(PROPOSAL_THRESHOLD);

      const dummyCalldata = "0x12345678";
      await expect(
        governance
          .connect(alice)
          .propose(
            0,
            "Legitimate proposal by Alice",
            targetPlatform.address,
            dummyCalldata
          )
      ).to.emit(governance, "ProposalCreated");
    });
  });

  describe("Transfer-After-Snapshot Attack Prevention", function () {
    it("Tokens transferred to Bob AFTER the proposal snapshot block cannot vote on that proposal", async function () {
      // 1. Alice creates proposal
      const dummyCalldata = "0x12345678";
      await governance
        .connect(alice)
        .propose(0, "Proposal 1", targetPlatform.address, dummyCalldata);

      const proposal = await governance.getProposal(1);
      const snapshotBlock = proposal.snapshotBlock;

      // 2. Mine blocks past snapshotBlock so voting becomes Active
      await mine(2);

      // 3. Now (after snapshotBlock), Alice transfers 800 DTEST to Bob
      await dtest.connect(alice).transfer(bob.address, ethers.parseEther("800"));
      await dtest.connect(bob).delegate(bob.address);

      // Bob now has 800 current votes in the latest block:
      expect(await dtest.getVotes(bob.address)).to.equal(ethers.parseEther("800"));

      // But Bob's past votes at the proposal's snapshotBlock is 0:
      const bobPastVotes = await dtest.getPastVotes(bob.address, snapshotBlock);
      expect(bobPastVotes).to.equal(0n);

      // 4. Bob attempts to cast vote on proposal 1 -> REVERTS with ZeroVotingPower
      await expect(
        governance.connect(bob).castVote(1, 1) // For
      ).to.be.revertedWithCustomError(governance, "ZeroVotingPower");
    });

    it("Alice retains full voting weight at snapshotBlock even if she transfers tokens afterward", async function () {
      const dummyCalldata = "0x12345678";
      await governance
        .connect(alice)
        .propose(0, "Proposal 1", targetPlatform.address, dummyCalldata);

      const proposal = await governance.getProposal(1);
      const snapshotBlock = proposal.snapshotBlock;

      // Mine past snapshot
      await mine(2);

      // Alice transfers away her tokens after the snapshot
      await dtest.connect(alice).transfer(bob.address, ethers.parseEther("1000"));

      // Alice's current balance is 0:
      expect(await dtest.balanceOf(alice.address)).to.equal(0n);

      // But Alice's pastVotes at snapshotBlock was 1,000 DTEST:
      const alicePastVotes = await dtest.getPastVotes(alice.address, snapshotBlock);
      expect(alicePastVotes).to.equal(ethers.parseEther("1000"));

      // Alice can legitimately vote with the power she held at the snapshot:
      await expect(governance.connect(alice).castVote(1, 1))
        .to.emit(governance, "VoteCast")
        .withArgs(alice.address, 1, 1, ethers.parseEther("1000"));
    });
  });
});
