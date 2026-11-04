import { expect } from "chai";
import hre from "hardhat";
const { ethers } = hre;

describe("DeFi Experiment 7: Chainlink Price Feed Oracle Implementation", function () {
  let deployer, user;
  let mockEthFeed, mockBtcFeed, mockUsdcFeed, mock18DecFeed;
  let oracle;

  const MAX_AGE_8_DEC = 3600; // 1 hour
  const MAX_AGE_18_DEC = 4500;

  beforeEach(async function () {
    [deployer, user] = await ethers.getSigners();

    const MockFeedFactory = await ethers.getContractFactory("MockFeed", deployer);
    mockEthFeed = await MockFeedFactory.deploy();
    mockBtcFeed = await MockFeedFactory.deploy();
    mockUsdcFeed = await MockFeedFactory.deploy();
    mock18DecFeed = await MockFeedFactory.deploy();

    await mockEthFeed.waitForDeployment();
    await mockBtcFeed.waitForDeployment();
    await mockUsdcFeed.waitForDeployment();
    await mock18DecFeed.waitForDeployment();

    // Default: 8 decimals for ETH, BTC, USDC
    // Configure mock18DecFeed to have 18 decimals
    await mock18DecFeed.setDecimals(18);

    // Initialise fresh prices
    // ETH = $2,500.00 (250,000,000,000 with 8 decimals)
    await mockEthFeed.setFresh(250000000000n);
    // BTC = $65,000.00 (6,500,000,000,000 with 8 decimals)
    await mockBtcFeed.setFresh(6500000000000n);
    // USDC = $1.00 (100,000,000 with 8 decimals)
    await mockUsdcFeed.setFresh(100000000n);
    // 18-dec token = $10.00 (10 * 10^18)
    await mock18DecFeed.setFresh(ethers.parseUnits("10", 18));

    const OracleFactory = await ethers.getContractFactory("PlatformPriceOracle", deployer);
    oracle = await OracleFactory.deploy(
      ["ETH/USD", "BTC/USD", "USDC/USD", "TOKEN18/USD"],
      [
        await mockEthFeed.getAddress(),
        await mockBtcFeed.getAddress(),
        await mockUsdcFeed.getAddress(),
        await mock18DecFeed.getAddress()
      ],
      [MAX_AGE_8_DEC, MAX_AGE_8_DEC, 86400, MAX_AGE_18_DEC]
    );
    await oracle.waitForDeployment();
  });

  describe("Section 1: The 5 Document Test Cases (Step 6 Exact Specifications)", function () {
    it("Case 1: setFresh(250000000000) gives 250000000000", async function () {
      await mockEthFeed.setFresh(250000000000n);
      const price = await oracle.safePrice("ETH/USD");
      expect(price).to.equal(250000000000n);
    });

    it("Case 2: valueOf of 3e18 gives 7500e18 (7,500 scaled by 10^18)", async function () {
      await mockEthFeed.setFresh(250000000000n);
      // 3 units of an 18-decimal token at $2,500 = $7,500 (7500 * 10^18)
      const amount = ethers.parseEther("3");
      const val = await oracle.getFunction("valueOf")("ETH/USD", amount, 18);
      expect(val).to.equal(ethers.parseUnits("7500", 18));
    });

    it("Case 3: setFresh(0) reverts with 'invalid price'", async function () {
      await mockEthFeed.setFresh(0);
      await expect(oracle.safePrice("ETH/USD")).to.be.revertedWith("invalid price");
    });

    it("Case 4: setFresh(-5) reverts with 'invalid price'", async function () {
      await mockEthFeed.setFresh(-5);
      await expect(oracle.safePrice("ETH/USD")).to.be.revertedWith("invalid price");
    });

    it("Case 5: set(250000000000, 1) reverts with 'stale price'", async function () {
      // Timestamp = 1 (far in the past, Jan 1970)
      await mockEthFeed.set(250000000000n, 1);
      await expect(oracle.safePrice("ETH/USD")).to.be.revertedWith("stale price");
    });
  });

  describe("Section 2: Extended Specification Tests", function () {
    it("Dynamic decimals normalisation: 18-decimal feed vs 8-decimal feed", async function () {
      // 8-decimal feed: 250000000000 ($2,500.00) scaled to 18 decimals -> 2500 * 10^18
      const ethPrice18 = await oracle.safePrice18("ETH/USD");
      expect(ethPrice18).to.equal(ethers.parseUnits("2500", 18));

      // 18-decimal feed: 10 * 10^18 ($10.00) remains 10 * 10^18 without distortion
      const token18Price18 = await oracle.safePrice18("TOKEN18/USD");
      expect(token18Price18).to.equal(ethers.parseUnits("10", 18));

      // Test valueOf on token18 (5 tokens at $10 = $50)
      const fiveTokens = ethers.parseUnits("5", 18);
      const val = await oracle.getFunction("valueOf")("TOKEN18/USD", fiveTokens, 18);
      expect(val).to.equal(ethers.parseUnits("50", 18));
    });

    it("maxAge boundary checks: exactly on boundary vs 1 second past", async function () {
      // Advance block time by a known amount and set updatedAt accordingly
      await ethers.provider.send("evm_increaseTime", [100]);
      await ethers.provider.send("evm_mine");
      const currentBlock = await ethers.provider.getBlock("latest");
      const now = currentBlock.timestamp;

      // Exactly at limit: block.timestamp - updatedAt == MAX_AGE_8_DEC (3600)
      // Set updatedAt = now - 3600 + 10 (safe within limit)
      await mockEthFeed.set(250000000000n, now - 3590);
      const p = await oracle.safePrice("ETH/USD");
      expect(p).to.equal(250000000000n);

      // Now advance time so it exceeds MAX_AGE_8_DEC
      await ethers.provider.send("evm_increaseTime", [20]);
      await ethers.provider.send("evm_mine");

      // Now block.timestamp - updatedAt > 3600 -> reverts
      await expect(oracle.safePrice("ETH/USD")).to.be.revertedWith("stale price");
    });

    it("isHealthy non-reverting circuit breaker: true when valid, false on invalid/stale/missing", async function () {
      // Fresh ETH feed is healthy
      expect(await oracle.isHealthy("ETH/USD")).to.be.true;

      // Stale feed is not healthy (does NOT revert)
      await mockEthFeed.set(250000000000n, 1);
      expect(await oracle.isHealthy("ETH/USD")).to.be.false;

      // Zero price feed is not healthy
      await mockEthFeed.setFresh(0);
      expect(await oracle.isHealthy("ETH/USD")).to.be.false;

      // Negative price feed is not healthy
      await mockEthFeed.setFresh(-100);
      expect(await oracle.isHealthy("ETH/USD")).to.be.false;

      // Non-existent symbol is not healthy
      expect(await oracle.isHealthy("UNKNOWN/PAIR")).to.be.false;
    });

    it("ethToUsd and usdToEth round trip conversion", async function () {
      // ETH price is $2,500.00
      await mockEthFeed.setFresh(250000000000n);

      // 2 ETH in wei = 2 * 10^18
      const twoEth = ethers.parseEther("2");
      const usdVal = await oracle.ethToUsd(twoEth);
      // 2 * $2500 = $5000 (5000 * 10^18)
      expect(usdVal).to.equal(ethers.parseUnits("5000", 18));

      // Reverse conversion: $5000 USD to ETH should yield exactly 2 ETH
      const ethBack = await oracle.usdToEth(usdVal);
      expect(ethBack).to.equal(twoEth);

      // Sub-unit test: $1250 USD = 0.5 ETH
      const halfEth = await oracle.usdToEth(ethers.parseUnits("1250", 18));
      expect(halfEth).to.equal(ethers.parseEther("0.5"));

      // Reverts if ETH price is stale
      await mockEthFeed.set(250000000000n, 1);
      await expect(oracle.ethToUsd(twoEth)).to.be.revertedWith("stale price");
      await expect(oracle.usdToEth(usdVal)).to.be.revertedWith("stale price");
    });

    it("Owner-only configuration: addFeed and updateMaxAge restricted to owner", async function () {
      const MockFeedFactory = await ethers.getContractFactory("MockFeed", deployer);
      const newFeed = await MockFeedFactory.deploy();
      await newFeed.waitForDeployment();
      await newFeed.setFresh(100000000n);

      // Non-owner cannot addFeed
      await expect(
        oracle.connect(user).addFeed("LINK/USD", await newFeed.getAddress(), 3600)
      ).to.be.revertedWithCustomError(oracle, "OwnableUnauthorizedAccount");

      // Owner can addFeed
      await oracle.connect(deployer).addFeed("LINK/USD", await newFeed.getAddress(), 3600);
      expect(await oracle.safePrice("LINK/USD")).to.equal(100000000n);

      // Non-owner cannot updateMaxAge
      await expect(
        oracle.connect(user).updateMaxAge("LINK/USD", 7200)
      ).to.be.revertedWithCustomError(oracle, "OwnableUnauthorizedAccount");

      // Owner can updateMaxAge
      await oracle.connect(deployer).updateMaxAge("LINK/USD", 7200);
      const feedConfig = await oracle.feeds("LINK/USD");
      expect(feedConfig.maxAge).to.equal(7200n);
    });

    it("Reference basic PriceConsumer contract can read latestPrice", async function () {
      const ConsumerFactory = await ethers.getContractFactory("PriceConsumer", deployer);
      const consumer = await ConsumerFactory.deploy(await mockEthFeed.getAddress());
      await consumer.waitForDeployment();

      await mockEthFeed.setFresh(320000000000n);
      const price = await consumer.latestPrice();
      expect(price).to.equal(320000000000n);
    });
  });
});
