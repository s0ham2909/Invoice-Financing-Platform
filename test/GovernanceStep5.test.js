import { expect } from "chai";
import hre from "hardhat";
const { ethers } = hre;
import { mine, time } from "@nomicfoundation/hardhat-network-helpers";

describe("Governance Advanced Security & State Transitions", function () {
  let dtest;
  let governance;
  let platformConfig;
  let reserveStaking;
  let owner;
  let alice;
  let bob;
  let debtor;
  let eoaTarget;

  const PROPOSAL_THRESHOLD = ethers.parseEther("100");
  const VOTING_DELAY_BLOCKS = 0; // Previous-block snapshot, full timed voting window
  const VOTING_PERIOD_SECONDS = 180; // 3 minutes
  const QUORUM_BPS = 400; // 4%
  const MAJORITY_BPS = 5001; // >50%
  const TIMELOCK_DELAY = 60; // 1 minute
  const QUEUE_WINDOW = 3600; // 1 hour
  const GRACE_PERIOD = 3600; // 1 hour

  // Selectors
  // setPlatformFeeBps(uint256) -> 0x3acbf810
  const SET_FEE_SELECTOR = "0x3acbf810";
  // applyDefaultPenalty(address,uint256,string) -> 0x81156e71
  const APPLY_PENALTY_SELECTOR = "0x81156e71";
  // setIssuerWhitelisted(address,bool) -> 0xd15ee1ae
  const WHITELIST_ISSUER_SELECTOR = "0xd15ee1ae";
  // resolveInvoiceDispute(uint256,uint8,string) -> 0x6e93fb23
  const RESOLVE_DISPUTE_SELECTOR = "0x6e93fb23";

  beforeEach(async function () {
    [owner, alice, bob, debtor, eoaTarget] = await ethers.getSigners();

    // 1. Deploy DTEST
    const DTESTFactory = await ethers.getContractFactory("DTEST");
    dtest = await DTESTFactory.deploy(ethers.parseEther("1000000"), owner.address);
    await dtest.waitForDeployment();

    // 2. Deploy Governance
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

    // 3. Deploy PlatformConfig
    const ConfigFactory = await ethers.getContractFactory("PlatformConfig");
    platformConfig = await ConfigFactory.deploy(
      owner.address,
      ethers.ZeroAddress,
      ethers.ZeroAddress,
      ethers.ZeroAddress,
      owner.address
    );
    await platformConfig.waitForDeployment();

    // 4. Whitelist PlatformConfig target & real selectors in Governance
    const configAddr = await platformConfig.getAddress();
    await governance.setTargetWhitelisted(configAddr, true);

    const setFeeSel = platformConfig.interface.getFunction("setPlatformFeeBps").selector;
    const penaltySel = platformConfig.interface.getFunction("applyDefaultPenalty").selector;

    await governance.setTargetSelector(configAddr, setFeeSel, 1, true); // PARAM_CHANGE = 1
    await governance.setTargetSelector(configAddr, penaltySel, 0, true); // DEFAULT_PENALTY = 0

    // 5. Transfer PlatformConfig ownership to Governance contract
    await platformConfig.transferOwnership(await governance.getAddress());

    // 6. Seed Alice with 50,000 DTEST (sufficient for quorum) and self-delegate
    await dtest.transfer(alice.address, ethers.parseEther("50000"));
    await dtest.connect(alice).delegate(alice.address);
    await mine(1);
  });

  describe("Ownership Transfer Verification", function () {
    it("Governance contract is the sole owner of PlatformConfig", async function () {
      expect(await platformConfig.owner()).to.equal(await governance.getAddress());
    });

    it("Unauthorized direct call to PlatformConfig setter reverts", async function () {
      await expect(
        platformConfig.connect(owner).setPlatformFeeBps(100)
      ).to.be.revertedWithCustomError(platformConfig, "OwnableUnauthorizedAccount");
    });
  });

  describe("Immediate voting with a completed snapshot", function () {
    it("Provides a full window without waiting for future blocks", async function () {
      const data = platformConfig.interface.encodeFunctionData("setPlatformFeeBps", [100]);
      await governance.connect(alice).propose(1, "Fee", await platformConfig.getAddress(), data);
      const proposal = await governance.getProposal(1);
      expect(proposal.snapshotBlock).to.be.lt(await ethers.provider.getBlockNumber());
      expect(proposal.deadline - proposal.startTime).to.equal(VOTING_PERIOD_SECONDS);
      expect(await governance.state(1)).to.equal(1);
      await expect(governance.connect(alice).castVote(1, 1)).to.emit(governance, "VoteCast");
    });
  });

  describe("Proposer Cancel Constraints", function () {
    it("Proposer can cancel while proposal is Active", async function () {
      const data = platformConfig.interface.encodeFunctionData("setPlatformFeeBps", [100]);
      await governance.connect(alice).propose(1, "Change fee", await platformConfig.getAddress(), data);

      await mine(VOTING_DELAY_BLOCKS + 1);
      expect(await governance.state(1)).to.equal(1); // Active

      await expect(governance.connect(alice).cancel(1))
        .to.emit(governance, "ProposalCancelled")
        .withArgs(1);

      expect(await governance.state(1)).to.equal(6); // 6 = Cancelled
    });

    it("Proposer CANNOT cancel after voting succeeds (reverts ProposerCannotCancelAfterVoting)", async function () {
      const data = platformConfig.interface.encodeFunctionData("setPlatformFeeBps", [100]);
      await governance.connect(alice).propose(1, "Change fee", await platformConfig.getAddress(), data);

      await mine(VOTING_DELAY_BLOCKS + 1);
      // Alice votes For
      await governance.connect(alice).castVote(1, 1);

      // Advance past votingPeriodSeconds
      await time.increase(VOTING_PERIOD_SECONDS + 1);

      // State is now Succeeded (3)
      expect(await governance.state(1)).to.equal(3);

      // Alice tries to cancel her succeeded proposal -> REVERTS
      await expect(
        governance.connect(alice).cancel(1)
      ).to.be.revertedWithCustomError(governance, "ProposerCannotCancelAfterVoting");
    });

    it("Guardian (Owner) can veto a proposal", async function () {
      const data = platformConfig.interface.encodeFunctionData("setPlatformFeeBps", [100]);
      await governance.connect(alice).propose(1, "Change fee", await platformConfig.getAddress(), data);

      await mine(VOTING_DELAY_BLOCKS + 1);
      await governance.connect(alice).castVote(1, 1);
      await time.increase(VOTING_PERIOD_SECONDS + 1);

      // Succeeded proposal can still be vetoed by guardian (owner)
      await expect(governance.connect(owner).cancel(1))
        .to.emit(governance, "ProposalVetoed")
        .withArgs(1, owner.address);

      expect(await governance.state(1)).to.equal(6); // Cancelled
    });
  });

  describe("Target Security & Whitelist Revocation at Execute", function () {
    it("Reverts proposal creation for code-less target (EOA)", async function () {
      const dummyData = "0x12345678";
      // Even if target was accidentally whitelisted:
      await governance.setTargetWhitelisted(eoaTarget.address, true);

      await expect(
        governance.connect(alice).propose(1, "EOA call", eoaTarget.address, dummyData)
      ).to.be.revertedWithCustomError(governance, "TargetHasNoCode");
    });

    it("Reverts execution if target whitelist is revoked after queueing", async function () {
      const data = platformConfig.interface.encodeFunctionData("setPlatformFeeBps", [100]);
      await governance.connect(alice).propose(1, "Change fee", await platformConfig.getAddress(), data);

      await mine(VOTING_DELAY_BLOCKS + 1);
      await governance.connect(alice).castVote(1, 1);
      await time.increase(VOTING_PERIOD_SECONDS + 1);

      // Queue the proposal
      await governance.queue(1);
      expect(await governance.state(1)).to.equal(4); // Queued

      // Revoke whitelist of PlatformConfig before timelock elapses
      await governance.connect(owner).setTargetWhitelisted(await platformConfig.getAddress(), false);

      // Fast-forward past timelock
      await time.increase(TIMELOCK_DELAY + 1);

      // Execute must revert with TargetNotWhitelisted!
      await expect(
        governance.execute(1)
      ).to.be.revertedWithCustomError(governance, "TargetNotWhitelisted");
    });
  });

  describe("End-to-End Governance Execution of Platform Parameter", function () {
    it("Successfully queues and executes PARAM_CHANGE to update platformFeeBps", async function () {
      expect(await platformConfig.platformFeeBps()).to.equal(50); // initial 0.5%

      const data = platformConfig.interface.encodeFunctionData("setPlatformFeeBps", [150]);
      await governance.connect(alice).propose(1, "Increase fee to 1.5%", await platformConfig.getAddress(), data);

      await mine(VOTING_DELAY_BLOCKS + 1);
      await governance.connect(alice).castVote(1, 1);
      await time.increase(VOTING_PERIOD_SECONDS + 1);

      await governance.queue(1);
      await time.increase(TIMELOCK_DELAY + 1);

      await expect(governance.execute(1))
        .to.emit(governance, "ProposalExecuted")
        .withArgs(1);

      // Verify on-chain parameter changed!
      expect(await platformConfig.platformFeeBps()).to.equal(150);
    });

    it("Reverts if PARAM_CHANGE proposes a value outside strict bounds", async function () {
      // 5,000 bps = 50% (MAX is 1,000 bps)
      const data = platformConfig.interface.encodeFunctionData("setPlatformFeeBps", [5000]);
      await governance.connect(alice).propose(1, "Illegal 50% fee", await platformConfig.getAddress(), data);

      await mine(VOTING_DELAY_BLOCKS + 1);
      await governance.connect(alice).castVote(1, 1);
      await time.increase(VOTING_PERIOD_SECONDS + 1);

      await governance.queue(1);
      await time.increase(TIMELOCK_DELAY + 1);

      // Execution will fail because PlatformConfig bounds check reverts!
      await expect(
        governance.execute(1)
      ).to.be.revertedWithCustomError(governance, "ExecutionFailed");
    });
  });
});
