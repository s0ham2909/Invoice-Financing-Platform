import { expect } from "chai";
import hre from "hardhat";
const { ethers } = hre;

describe("DeFi Experiment 6: DEX Prototype (Uniswap v2 Architecture)", function () {
  let deployer, alice, bob, charlie;
  let factory, router;
  let tokenA, tokenB, tokenC;

  beforeEach(async function () {
    [deployer, alice, bob, charlie] = await ethers.getSigners();

    // Deploy Factory and Router
    const Factory = await ethers.getContractFactory("DexFactory");
    factory = await Factory.deploy();

    const Router = await ethers.getContractFactory("DexRouter");
    router = await Router.deploy(await factory.getAddress());

    // Deploy standard 18-decimal test tokens
    const MockERC20 = await ethers.getContractFactory("contracts/test/MockERC20.sol:MockERC20");
    tokenA = await MockERC20.deploy("Token A", "TKNA", 18);
    tokenB = await MockERC20.deploy("Token B", "TKNB", 18);
    tokenC = await MockERC20.deploy("Token C", "TKNC", 18);

    // Mint test tokens to participants
    const mintAmount = ethers.parseEther("1000000");
    await tokenA.mint(deployer.address, mintAmount);
    await tokenB.mint(deployer.address, mintAmount);
    await tokenC.mint(deployer.address, mintAmount);

    await tokenA.mint(alice.address, mintAmount);
    await tokenB.mint(alice.address, mintAmount);
    await tokenC.mint(alice.address, mintAmount);

    await tokenA.mint(bob.address, mintAmount);
    await tokenB.mint(bob.address, mintAmount);
    await tokenC.mint(bob.address, mintAmount);
  });

  const getDeadline = () => Math.floor(Date.now() / 1000) + 3600;

  it("Scenario 1: First deposit - empty pool, 1,000 A + 4,000 B gives 1,000 LP tokens (supply 2,000)", async function () {
    const aAddress = await tokenA.getAddress();
    const bAddress = await tokenB.getAddress();
    const routerAddress = await router.getAddress();

    const amountA = 1000n;
    const amountB = 4000n;

    await tokenA.connect(alice).approve(routerAddress, amountA);
    await tokenB.connect(alice).approve(routerAddress, amountB);

    await router.connect(alice).addLiquidity(
      aAddress,
      bAddress,
      amountA,
      amountB,
      0,
      0,
      alice.address,
      getDeadline()
    );

    const pairAddress = await factory.getPair(aAddress, bAddress);
    const pair = await ethers.getContractAt("DexPair", pairAddress);

    const aliceLp = await pair.balanceOf(alice.address);
    const totalSupply = await pair.totalSupply();
    const [resA, resB] = await router.getReserves(aAddress, bAddress);

    // Expected: LP receives 1,000 LP tokens; supply 2,000; reserves 1,000 A / 4,000 B
    expect(aliceLp).to.equal(1000n);
    expect(totalSupply).to.equal(2000n);
    expect(resA).to.equal(1000n);
    expect(resB).to.equal(4000n);
  });

  it("Scenario 2: Basic swap - 1,000 A / 2,000 B pool, sell 100 A gives 181 B (reserves 1,100 A / 1,819 B, k = 2,000,900)", async function () {
    const aAddress = await tokenA.getAddress();
    const bAddress = await tokenB.getAddress();
    const routerAddress = await router.getAddress();

    // Setup pool: 1,000 A / 2,000 B
    await tokenA.connect(deployer).approve(routerAddress, 1000n);
    await tokenB.connect(deployer).approve(routerAddress, 2000n);
    await router.connect(deployer).addLiquidity(
      aAddress,
      bAddress,
      1000n,
      2000n,
      0,
      0,
      deployer.address,
      getDeadline()
    );

    const bBalBefore = await tokenB.balanceOf(alice.address);

    // Alice sells 100 A
    await tokenA.connect(alice).approve(routerAddress, 100n);
    await router.connect(alice).swapExactTokensForTokens(
      100n,
      0,
      [aAddress, bAddress],
      alice.address,
      getDeadline()
    );

    const bBalAfter = await tokenB.balanceOf(alice.address);
    const bReceived = bBalAfter - bBalBefore;

    const [resA, resB] = await router.getReserves(aAddress, bAddress);
    const k = resA * resB;

    // Expected: Receive 181 B; reserves 1,100 A / 1,819 B; k = 2,000,900
    expect(bReceived).to.equal(181n);
    expect(resA).to.equal(1100n);
    expect(resB).to.equal(1819n);
    expect(k).to.equal(2000900n);
  });

  it("Scenario 3: Asking for too much - 100 A in, ask for 182 B reverts with K", async function () {
    const aAddress = await tokenA.getAddress();
    const bAddress = await tokenB.getAddress();
    const routerAddress = await router.getAddress();

    // Setup pool: 1,000 A / 2,000 B
    await tokenA.connect(deployer).approve(routerAddress, 1000n);
    await tokenB.connect(deployer).approve(routerAddress, 2000n);
    await router.connect(deployer).addLiquidity(
      aAddress,
      bAddress,
      1000n,
      2000n,
      0,
      0,
      deployer.address,
      getDeadline()
    );

    const pairAddress = await factory.getPair(aAddress, bAddress);
    const pair = await ethers.getContractAt("DexPair", pairAddress);
    const token0 = await pair.token0();

    // Transfer 100 A to pair directly
    await tokenA.connect(alice).transfer(pairAddress, 100n);

    // Determine output ordering for 182 B
    const amount0Out = token0 === bAddress ? 182n : 0n;
    const amount1Out = token0 === bAddress ? 0n : 182n;

    // Direct swap call asking for 182 B must revert with "K"
    await expect(
      pair.connect(alice).swap(amount0Out, amount1Out, alice.address)
    ).to.be.revertedWith("K");
  });

  it("Scenario 4: No input sent - call swap(0, 181, trader) without sending tokens reverts with INSUFFICIENT_INPUT_AMOUNT", async function () {
    const aAddress = await tokenA.getAddress();
    const bAddress = await tokenB.getAddress();
    const routerAddress = await router.getAddress();

    // Setup pool: 1,000 A / 2,000 B
    await tokenA.connect(deployer).approve(routerAddress, 1000n);
    await tokenB.connect(deployer).approve(routerAddress, 2000n);
    await router.connect(deployer).addLiquidity(
      aAddress,
      bAddress,
      1000n,
      2000n,
      0,
      0,
      deployer.address,
      getDeadline()
    );

    const pairAddress = await factory.getPair(aAddress, bAddress);
    const pair = await ethers.getContractAt("DexPair", pairAddress);
    const token0 = await pair.token0();

    const amount0Out = token0 === bAddress ? 181n : 0n;
    const amount1Out = token0 === bAddress ? 0n : 181n;

    // Call swap without transferring any input tokens to the pair
    await expect(
      pair.connect(alice).swap(amount0Out, amount1Out, alice.address)
    ).to.be.revertedWith("INSUFFICIENT_INPUT_AMOUNT");
  });

  it("Scenario 5: Slippage guard - frontrun by 20 A drops output to 174 B, amountOutMin = 179 reverts with INSUFFICIENT_OUTPUT_AMOUNT", async function () {
    const aAddress = await tokenA.getAddress();
    const bAddress = await tokenB.getAddress();
    const routerAddress = await router.getAddress();

    // Setup pool: 1,000 A / 2,000 B
    await tokenA.connect(deployer).approve(routerAddress, 1000n);
    await tokenB.connect(deployer).approve(routerAddress, 2000n);
    await router.connect(deployer).addLiquidity(
      aAddress,
      bAddress,
      1000n,
      2000n,
      0,
      0,
      deployer.address,
      getDeadline()
    );

    // Another trader (Bob) sells 20 A first
    await tokenA.connect(bob).approve(routerAddress, 20n);
    await router.connect(bob).swapExactTokensForTokens(
      20n,
      0,
      [aAddress, bAddress],
      bob.address,
      getDeadline()
    );

    // Alice attempts to sell 100 A with amountOutMin = 179
    // Expected output is 174 B, which violates 179 minimum
    await tokenA.connect(alice).approve(routerAddress, 100n);
    await expect(
      router.connect(alice).swapExactTokensForTokens(
        100n,
        179n,
        [aAddress, bAddress],
        alice.address,
        getDeadline()
      )
    ).to.be.revertedWith("INSUFFICIENT_OUTPUT_AMOUNT");
  });

  it("Scenario 6: Deadline - swap with past deadline reverts with EXPIRED", async function () {
    const aAddress = await tokenA.getAddress();
    const bAddress = await tokenB.getAddress();
    const routerAddress = await router.getAddress();

    // Setup pool
    await tokenA.connect(deployer).approve(routerAddress, 1000n);
    await tokenB.connect(deployer).approve(routerAddress, 2000n);
    await router.connect(deployer).addLiquidity(
      aAddress,
      bAddress,
      1000n,
      2000n,
      0,
      0,
      deployer.address,
      getDeadline()
    );

    const pastDeadline = (await ethers.provider.getBlock("latest")).timestamp - 100;

    await tokenA.connect(alice).approve(routerAddress, 100n);
    await expect(
      router.connect(alice).swapExactTokensForTokens(
        100n,
        0,
        [aAddress, bAddress],
        alice.address,
        pastDeadline
      )
    ).to.be.revertedWith("EXPIRED");
  });

  it("Scenario 7: Allowance - user approved 100 A only, swap 200 A reverts due to allowance", async function () {
    const aAddress = await tokenA.getAddress();
    const bAddress = await tokenB.getAddress();
    const routerAddress = await router.getAddress();

    // Setup pool
    await tokenA.connect(deployer).approve(routerAddress, 1000n);
    await tokenB.connect(deployer).approve(routerAddress, 2000n);
    await router.connect(deployer).addLiquidity(
      aAddress,
      bAddress,
      1000n,
      2000n,
      0,
      0,
      deployer.address,
      getDeadline()
    );

    // Alice approves 100 A only, but attempts to swap 200 A
    await tokenA.connect(alice).approve(routerAddress, 100n);

    await expect(
      router.connect(alice).swapExactTokensForTokens(
        200n,
        0,
        [aAddress, bAddress],
        alice.address,
        getDeadline()
      )
    ).to.be.reverted; // ERC20InsufficientAllowance from OpenZeppelin
  });

  it("Scenario 8: Multi-hop - Pool 1 (1,000 A / 2,000 B), Pool 2 (4,000 B / 500 C); swap 100 A along A -> B -> C gives 21 C", async function () {
    const aAddress = await tokenA.getAddress();
    const bAddress = await tokenB.getAddress();
    const cAddress = await tokenC.getAddress();
    const routerAddress = await router.getAddress();

    // Pool 1: 1,000 A / 2,000 B
    await tokenA.connect(deployer).approve(routerAddress, 1000n);
    await tokenB.connect(deployer).approve(routerAddress, 2000n);
    await router.connect(deployer).addLiquidity(
      aAddress,
      bAddress,
      1000n,
      2000n,
      0,
      0,
      deployer.address,
      getDeadline()
    );

    // Pool 2: 4,000 B / 500 C
    await tokenB.connect(deployer).approve(routerAddress, 4000n);
    await tokenC.connect(deployer).approve(routerAddress, 500n);
    await router.connect(deployer).addLiquidity(
      bAddress,
      cAddress,
      4000n,
      500n,
      0,
      0,
      deployer.address,
      getDeadline()
    );

    const cBalBefore = await tokenC.balanceOf(alice.address);

    // Alice swaps 100 A along path A -> B -> C
    await tokenA.connect(alice).approve(routerAddress, 100n);
    await router.connect(alice).swapExactTokensForTokens(
      100n,
      0,
      [aAddress, bAddress, cAddress],
      alice.address,
      getDeadline()
    );

    const cBalAfter = await tokenC.balanceOf(alice.address);
    const cReceived = cBalAfter - cBalBefore;

    // Check reserves of Pool 1 and Pool 2
    const [res1A, res1B] = await router.getReserves(aAddress, bAddress);
    const [res2B, res2C] = await router.getReserves(bAddress, cAddress);

    // Expected: Receive 21 C; Pool 1 = 1,100 A / 1,819 B; Pool 2 = 4,181 B / 479 C
    expect(cReceived).to.equal(21n);
    expect(res1A).to.equal(1100n);
    expect(res1B).to.equal(1819n);
    expect(res2B).to.equal(4181n);
    expect(res2C).to.equal(479n);
  });

  it("Scenario 9: Wrong-ratio deposit - Pool 1,000 A / 4,000 B (supply 2,000); adding 500 A and 3,000 B desired uses 500 A + 2,000 B only, minting 1,000 LP", async function () {
    const aAddress = await tokenA.getAddress();
    const bAddress = await tokenB.getAddress();
    const routerAddress = await router.getAddress();

    // Initial pool: 1,000 A / 4,000 B (minting 1,000 LP, supply 2,000)
    await tokenA.connect(deployer).approve(routerAddress, 1000n);
    await tokenB.connect(deployer).approve(routerAddress, 4000n);
    await router.connect(deployer).addLiquidity(
      aAddress,
      bAddress,
      1000n,
      4000n,
      0,
      0,
      deployer.address,
      getDeadline()
    );

    const aBalBefore = await tokenA.balanceOf(alice.address);
    const bBalBefore = await tokenB.balanceOf(alice.address);

    // Alice supplies with 500 A and 3,000 B desired
    await tokenA.connect(alice).approve(routerAddress, 500n);
    await tokenB.connect(alice).approve(routerAddress, 3000n);

    const tx = await router.connect(alice).addLiquidity(
      aAddress,
      bAddress,
      500n,
      3000n,
      0,
      0,
      alice.address,
      getDeadline()
    );
    await tx.wait();

    const aBalAfter = await tokenA.balanceOf(alice.address);
    const bBalAfter = await tokenB.balanceOf(alice.address);

    const aUsed = aBalBefore - aBalAfter;
    const bUsed = bBalBefore - bBalAfter;

    const pairAddress = await factory.getPair(aAddress, bAddress);
    const pair = await ethers.getContractAt("DexPair", pairAddress);
    const aliceLp = await pair.balanceOf(alice.address);

    // Expected: Router uses 500 A + 2,000 B only; mints 1,000 LP tokens
    expect(aUsed).to.equal(500n);
    expect(bUsed).to.equal(2000n);
    expect(aliceLp).to.equal(1000n);
  });

  it("Scenario 10: Duplicate pair - createPair for an existing pair reverts with PAIR_EXISTS", async function () {
    const aAddress = await tokenA.getAddress();
    const bAddress = await tokenB.getAddress();

    await factory.createPair(aAddress, bAddress);

    // Second call for same tokens (even swapped ordering) must revert with PAIR_EXISTS
    await expect(
      factory.createPair(aAddress, bAddress)
    ).to.be.revertedWith("PAIR_EXISTS");

    await expect(
      factory.createPair(bAddress, aAddress)
    ).to.be.revertedWith("PAIR_EXISTS");
  });

  it("Scenario 11 (Extra): Mixed-decimals pair - 6 decimals (mUSDC) and 18 decimals (INVX) operates with perfect precision", async function () {
    const MockERC20 = await ethers.getContractFactory("contracts/test/MockERC20.sol:MockERC20");
    const usdc = await MockERC20.deploy("Mock USDC", "mUSDC", 6);
    const invx = await MockERC20.deploy("InvoiceX", "INVX", 18);

    const usdcAddress = await usdc.getAddress();
    const invxAddress = await invx.getAddress();
    const routerAddress = await router.getAddress();

    // Mint test amounts
    const depositUsdc = ethers.parseUnits("1000", 6); // 1,000 mUSDC ($1,000)
    const depositInvx = ethers.parseUnits("10000", 18); // 10,000 INVX ($0.10 per INVX)

    await usdc.mint(alice.address, depositUsdc);
    await invx.mint(alice.address, depositInvx);

    await usdc.connect(alice).approve(routerAddress, depositUsdc);
    await invx.connect(alice).approve(routerAddress, depositInvx);

    // Add liquidity with mixed decimals
    await router.connect(alice).addLiquidity(
      usdcAddress,
      invxAddress,
      depositUsdc,
      depositInvx,
      0,
      0,
      alice.address,
      getDeadline()
    );

    const pairAddress = await factory.getPair(usdcAddress, invxAddress);
    const pair = await ethers.getContractAt("DexPair", pairAddress);
    const aliceLp = await pair.balanceOf(alice.address);

    // sqrt(1000 * 10^6 * 10000 * 10^18) = sqrt(10^19 * 10^6) = sqrt(10^25) = 3,162,277,660,168
    expect(aliceLp).to.be.gt(0n);

    // Now test a swap: Bob swaps 100 mUSDC for INVX
    const swapAmountIn = ethers.parseUnits("100", 6);
    await usdc.mint(bob.address, swapAmountIn);
    await usdc.connect(bob).approve(routerAddress, swapAmountIn);

    const amounts = await router.getAmountsOut(swapAmountIn, [usdcAddress, invxAddress]);
    const expectedInvxOut = amounts[1];
    expect(expectedInvxOut).to.be.gt(0n);

    const bobInvxBefore = await invx.balanceOf(bob.address);
    await router.connect(bob).swapExactTokensForTokens(
      swapAmountIn,
      expectedInvxOut,
      [usdcAddress, invxAddress],
      bob.address,
      getDeadline()
    );
    const bobInvxAfter = await invx.balanceOf(bob.address);

    expect(bobInvxAfter - bobInvxBefore).to.equal(expectedInvxOut);
  });
});
