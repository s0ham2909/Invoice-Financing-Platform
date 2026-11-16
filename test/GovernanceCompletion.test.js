import { expect } from "chai";
import hre from "hardhat";
import { time, mine } from "@nomicfoundation/hardhat-network-helpers";
const { ethers } = hre;
const amount = ethers.parseEther;

describe("Completed DAO: binding fees, repayments and default safety", function () {
  let owner, alice, borrower, investor, other, token, invx, staking, invoices, gov, config;
  const rules = { proposalThreshold: amount("100"), votingDelayBlocks: 0, votingPeriodSeconds: 180,
    quorumBps: 400, majorityBps: 5001, timelockDelay: 60, queueWindow: 3600, gracePeriod: 3600 };
  beforeEach(async function () {
    [owner, alice, borrower, investor, other] = await ethers.getSigners();
    const deploy = async (name, ...args) => { const c = await (await ethers.getContractFactory(name)).deploy(...args); await c.waitForDeployment(); return c; };
    token = await deploy("DTEST", amount("1000000"), owner.address);
    invx = await deploy("INVX");
    const usd = await deploy("MockUSDC");
    staking = await deploy("ReserveStaking", invx.target, usd.target);
    invoices = await deploy("InvoiceNFT");
    gov = await deploy("Governance", token.target, rules, owner.address);
    config = await deploy("PlatformConfig", owner.address, staking.target, invoices.target, ethers.ZeroAddress, owner.address);
    await invoices.configureCollateral(staking.target, owner.address);
    await invoices.setPlatformFeeBps(50);
    await invoices.transferOwnership(config.target);
    await config.transferOwnership(gov.target);
    await staking.setAuthorizedLockerStatus(invoices.target, true);
    await staking.setAuthorizedLockerStatus(config.target, true);
    await gov.setTargetWhitelisted(config.target, true);
    for (const [fn, type] of [["setPlatformFeeBps", 1], ["applyDefaultPenalty", 0]]) await gov.setTargetSelector(config.target, config.interface.getFunction(fn).selector, type, true);
    await token.transfer(alice.address, amount("50000"));
    await token.connect(alice).delegate(alice.address);
    await invx.transfer(borrower.address, amount("2000"));
    await invx.connect(borrower).approve(staking.target, amount("2000"));
    await staking.connect(borrower).stake(amount("1000"));
    await mine();
  });
  async function invoice() {
    const id = Number(await invoices.totalMinted());
    await invoices.connect(borrower).mintInvoice(borrower.address, "TEST", amount("1"), 1, "");
    return id;
  }
  async function finance(id) { await invoices.connect(investor).financeInvoice(id, { value: await invoices.financingCost(id) }); }
  async function propose(fn, args, target = config, proposer = alice, type = fn === "applyDefaultPenalty" ? 0 : 1) {
    await gov.connect(proposer).propose(type, fn, target.target, target.interface.encodeFunctionData(fn, args));
    return Number(await gov.proposalCount());
  }
  async function queued(id, voter = alice) {
    await gov.connect(voter).castVote(id, 1);
    const p = await gov.getProposal(id);
    await time.increaseTo(p.deadline + 1n);
    await gov.queue(id);
    const q = await gov.getProposal(id);
    await time.increaseTo(q.eta);
  }
  it("Charges the DAO-approved fee on the actual direct financing entry point", async function () {
    const p = await propose("setPlatformFeeBps", [150]); await queued(p); await gov.execute(p);
    const id = await invoice();
    expect(await invoices.financingCost(id)).to.equal(amount("1.015"));
    await expect(invoices.connect(investor).financeInvoice(id, { value: amount("1") })).to.be.revertedWithCustomError(invoices, "InsufficientETH");
    await expect(invoices.connect(investor).financeInvoice(id, { value: amount("1.015") }))
      .to.changeEtherBalances([borrower, owner], [amount("1"), amount("0.015")]);
    await expect(invoices.connect(investor).setPlatformFeeBps(10)).to.be.revertedWithCustomError(invoices, "OwnableUnauthorizedAccount");
  });
  it("Locks collateral and only unlocks after all loans are actually repaid", async function () {
    const a = await invoice(), b = await invoice(); await finance(a); await finance(b);
    await expect(staking.connect(borrower).unstake(1)).to.be.revertedWithCustomError(staking, "StakeIsLocked");
    await invoices.connect(borrower).repayInvoice(a, { value: amount("1") });
    await expect(staking.connect(borrower).unstake(1)).to.be.revertedWithCustomError(staking, "StakeIsLocked");
    await expect(invoices.connect(borrower).repayInvoice(b, { value: amount("1") })).to.changeEtherBalance(investor, amount("1"));
    await staking.connect(borrower).unstake(amount("1000"));
    expect(await invoices.isRepaid(a)).to.equal(true);
    await expect(invoices.connect(borrower).repayInvoice(a, { value: amount("1") })).to.be.revertedWithCustomError(invoices, "InvalidRepayment");
  });
  it("Requires collateral before disbursing financing", async function () {
    await staking.connect(borrower).unstake(amount("1000"));
    const id = await invoice();
    await expect(invoices.connect(investor).financeInvoice(id, { value: await invoices.financingCost(id) })).to.be.revertedWithCustomError(invoices, "CollateralRequired");
    expect((await invoices.getInvoice(id)).isFinanced).to.equal(false);
  });
  it("Cannot invent an invoice for someone else's wallet", async function () {
    await expect(invoices.connect(other).mintInvoice(borrower.address, "FAKE", amount("1"), 1, "")).to.be.revertedWithCustomError(invoices, "InvalidAmount");
  });
  it("Rejects a penalty on unfinanced invoice zero", async function () {
    const id = await invoice(); const p = await propose("applyDefaultPenalty", [id, borrower.address, amount("100"), "default"]);
    await queued(p); await expect(gov.execute(p)).to.be.revertedWithCustomError(gov, "ExecutionFailed");
    expect(await config.invoicePenalized(0)).to.equal(false);
  });
  it("Rejects invoice zero penalties before its due date", async function () {
    const id = await invoice(); await finance(id);
    const p = await propose("applyDefaultPenalty", [id, borrower.address, amount("100"), "default"]); await queued(p);
    await expect(gov.execute(p)).to.be.revertedWithCustomError(gov, "ExecutionFailed");
  });
  it("Executes a real default penalty once and preserves the unpaid loan", async function () {
    const id = await invoice(); await finance(id); await time.increase(86401);
    const p = await propose("applyDefaultPenalty", [id, borrower.address, amount("300"), "default"]); await queued(p);
    await expect(gov.execute(p)).to.changeTokenBalance(invx, owner, amount("300"));
    expect(await staking.stakedBalance(borrower.address)).to.equal(amount("700"));
    expect(await invoices.isRepaid(id)).to.equal(false);
    const again = await propose("applyDefaultPenalty", [id, borrower.address, amount("300"), "again"]); await queued(again);
    await expect(gov.execute(again)).to.be.revertedWithCustomError(gov, "ExecutionFailed");
  });
  it("Rechecks repayment after the proposal has passed", async function () {
    const id = await invoice(); await finance(id); await time.increase(86401);
    const p = await propose("applyDefaultPenalty", [id, borrower.address, amount("300"), "default"]); await queued(p);
    await invoices.connect(borrower).repayInvoice(id, { value: amount("1") });
    await expect(gov.execute(p)).to.be.revertedWithCustomError(gov, "ExecutionFailed");
    expect(await config.invoicePenalized(id)).to.equal(false);
  });
  it("Cannot slash a different supplier or a nonexistent invoice", async function () {
    const id = await invoice(); await finance(id); await time.increase(86401);
    for (const [invoiceId, supplier] of [[id, other.address], [999, borrower.address]]) {
      const p = await propose("applyDefaultPenalty", [invoiceId, supplier, amount("100"), "default"]); await queued(p);
      await expect(gov.execute(p)).to.be.revertedWithCustomError(gov, "ExecutionFailed");
    }
  });
  it("An over-slash rolls back all accounting and can be retried without marking executed", async function () {
    const id = await invoice(); await finance(id); await time.increase(86401);
    const p = await propose("applyDefaultPenalty", [id, borrower.address, amount("1500"), "too much"]); await queued(p);
    await expect(gov.execute(p)).to.be.revertedWithCustomError(gov, "ExecutionFailed");
    expect(await config.invoicePenalized(id)).to.equal(false);
    expect(await config.totalPenaltiesSlashed(borrower.address)).to.equal(0);
    expect(await gov.state(p)).to.equal(4);
  });
  it("Freezes old proposal rules when a governance settings proposal executes", async function () {
    await gov.setTargetWhitelisted(gov.target, true);
    await gov.setTargetSelector(gov.target, gov.interface.getFunction("updateGovernanceParams").selector, 1, true);
    const old = await propose("setPlatformFeeBps", [100]); await gov.connect(alice).castVote(old, 1);
    const update = await propose("updateGovernanceParams", [{ ...rules, quorumBps: 2000, gracePeriod: 60 }], gov, owner);
    await queued(update, owner); await gov.execute(update);
    expect(await gov.state(old)).to.equal(3);
    expect((await gov.proposalParams(old)).quorumBps).to.equal(400);
  });
  it("Revocation of the target/selector/type combination blocks execution", async function () {
    const p = await propose("setPlatformFeeBps", [100]); await queued(p);
    const selector = config.interface.getFunction("setPlatformFeeBps").selector;
    await gov.setTargetSelector(config.target, selector, 1, false);
    await gov.setTargetSelector(config.target, selector, 0, true);
    await expect(gov.execute(p)).to.be.revertedWithCustomError(gov, "SelectorTypeMismatch");
  });
  it("Seals token issuance and execution permissions after bootstrap", async function () {
    expect(await token.faucetEnabled()).to.equal(false);
    await expect(token.connect(other).faucet(other.address, 1)).to.be.revertedWithCustomError(token, "FaucetDisabled");
    await token.sealMinting();
    await expect(token.mint(owner.address, 1)).to.be.revertedWithCustomError(token, "MintingSealed");
    await expect(token.setFaucetEnabled(true)).to.be.revertedWithCustomError(token, "MintingSealed");
    await gov.sealPermissions();
    await expect(gov.setTargetWhitelisted(other.address, true)).to.be.revertedWithCustomError(gov, "Unauthorized");
    const p = await propose("setPlatformFeeBps", [100]); await gov.cancel(p);
    expect(await gov.state(p)).to.equal(6);
  });
  it("Closes the deployer's collateral bypass while retaining DAO execution", async function () {
    await staking.sealCollateralAdmin();
    await expect(staking.setAuthorizedLockerStatus(owner.address, true)).to.be.revertedWithCustomError(staking, "Unauthorized");
    await expect(staking.slashSupplierStake(borrower.address, 1, owner.address)).to.be.revertedWithCustomError(staking, "Unauthorized");
    const id = await invoice(); await finance(id); await time.increase(86401);
    const p = await propose("applyDefaultPenalty", [id, borrower.address, amount("100"), "default"]);
    await queued(p); await gov.execute(p);
    expect(await staking.stakedBalance(borrower.address)).to.equal(amount("900"));
  });
  it("Rejects removed proposal categories and malformed calldata", async function () {
    await expect(gov.connect(alice).propose(2, "refund", config.target, "0x12345678")).to.be.revertedWithCustomError(gov, "InvalidParameters");
    await expect(gov.connect(alice).propose(1, "fee", config.target, "0x12")).to.be.revertedWithCustomError(gov, "InvalidParameters");
  });
});

describe("Legacy ETH pool accounting regression", function () {
  it("Keeps share value accurate across finance, repayment, and full withdrawal", async function () {
    const [investor, borrower] = await ethers.getSigners();
    const nft = await (await ethers.getContractFactory("InvoiceNFT")).deploy();
    const pool = await (await ethers.getContractFactory("InvoiceLiquidityPool")).deploy(nft.target);
    await pool.depositLiquidity({ value: amount("10") });
    await nft.connect(borrower).mintInvoice(borrower.address, "POOL", amount("2"), 7, "");
    await pool.connect(borrower).requestPoolFinancing(0);
    expect(await pool.totalPoolETH()).to.equal(amount("10"));
    expect(await pool.availableLiquidity()).to.equal(amount("8"));
    await pool.connect(borrower).repayInvoice(0, { value: amount("2.1") });
    expect(await pool.totalPoolETH()).to.equal(amount("10.1"));
    expect(await ethers.provider.getBalance(pool.target)).to.equal(amount("10.1"));
    await pool.withdrawLiquidity(await pool.balanceOf(investor.address));
    expect(await ethers.provider.getBalance(pool.target)).to.equal(0);
  });
});
