import hre from "hardhat";
const { ethers } = hre;
import fs from "fs";
import path from "path";
import dotenv from "dotenv";

dotenv.config();

// Contract addresses from previous deployments
const MOCK_USDC_ADDR = "0xb87fF8Dd0B49d578D20df8887f67303A6c95e62e";
const INVX_ADDR = "0xc2b51d72E701013F2107F77a7eDFB74735332739";
const INVOICE_VAULT_ADDR = "0x81289DBECab824C8db0d5193e2D6a8d8276A1456";

// Initial seed liquidity amounts (cheap & minimal)
// 100 INVX (18 dec) + 10 mUSDC (6 dec) -> Implies 1 INVX = 0.10 mUSDC
const SEED_INVX_AMOUNT = ethers.parseUnits("100", 18);
const SEED_MUSDC_FOR_INVX = ethers.parseUnits("10", 6);

// 10 vINV (6 dec) + 10 mUSDC (6 dec) -> Implies 1 vINV = 1.00 mUSDC
const SEED_VINV_AMOUNT = ethers.parseUnits("10", 6);
const SEED_MUSDC_FOR_VINV = ethers.parseUnits("10", 6);

export async function runDeployment(options = {}) {
  const { isDryRun = false, customSigner = null } = options;

  const signers = await ethers.getSigners();
  const deployer = customSigner || signers[0];
  if (!deployer) {
    throw new Error("No deployer signer found! Check PRIVATE_KEY in .env");
  }

  const network = await ethers.provider.getNetwork();
  const chainId = Number(network.chainId);

  if (chainId === 1) {
    throw new Error("SAFETY HALT: Target chain ID is 1 (Ethereum Mainnet). Aborting immediately!");
  }

  console.log("====================================================");
  console.log(`  DEX DEPLOYMENT ${isDryRun ? "(FORK DRY RUN)" : "(LIVE)"}`);
  console.log(`  Network:  ${network.name} (Chain ID: ${chainId})`);
  console.log(`  Deployer: ${deployer.address}`);
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log(`  Balance:  ${ethers.formatEther(balance)} ETH`);
  console.log("====================================================\n");

  const deploymentDir = path.resolve("./deployments");
  if (!fs.existsSync(deploymentDir)) {
    fs.mkdirSync(deploymentDir, { recursive: true });
  }

  const deploymentFile = path.join(
    deploymentDir,
    chainId === 11155111 ? "dex-sepolia.json" : "dex-local.json"
  );

  let state = {
    network: network.name,
    chainId,
    deployer: deployer.address,
    updatedAt: new Date().toISOString(),
    contracts: {},
    transactions: {},
    gasUsed: {},
    totalGasUsed: 0,
  };

  if (!isDryRun && fs.existsSync(deploymentFile)) {
    try {
      state = JSON.parse(fs.readFileSync(deploymentFile, "utf8"));
      console.log(`📋 Found existing deployment progress at ${deploymentFile}. Resuming...`);
    } catch (e) {
      console.warn("⚠️ Could not parse existing deployment file, starting fresh.");
    }
  }

  const saveState = () => {
    if (!isDryRun) {
      state.updatedAt = new Date().toISOString();
      fs.writeFileSync(deploymentFile, JSON.stringify(state, null, 2));
    }
  };

  let totalGas = 0n;

  const trackTx = async (label, txPromise) => {
    const tx = await txPromise;
    console.log(`  ⏳ [${label}] tx sent: ${tx.hash}`);
    const receipt = await tx.wait(chainId === 11155111 ? 1 : 1);
    console.log(`  ✅ [${label}] confirmed in block ${receipt.blockNumber} (Gas used: ${receipt.gasUsed})`);
    state.transactions[label] = {
      hash: tx.hash,
      blockNumber: receipt.blockNumber,
      gasUsed: receipt.gasUsed.toString(),
    };
    state.gasUsed[label] = receipt.gasUsed.toString();
    totalGas += receipt.gasUsed;
    state.totalGasUsed = totalGas.toString();
    saveState();
    return { tx, receipt };
  };

  // ─── STEP 1: Deploy DexFactory ───────────────────────────────────────────
  let factoryAddress = state.contracts.DexFactory?.address;
  let dexFactory;

  if (factoryAddress) {
    console.log(`ℹ️ Reusing existing DexFactory at ${factoryAddress}`);
    dexFactory = await ethers.getContractAt("DexFactory", factoryAddress, deployer);
  } else {
    console.log("🚀 Deploying DexFactory...");
    const Factory = await ethers.getContractFactory("DexFactory", deployer);
    const deployTx = await Factory.deploy();
    await deployTx.waitForDeployment();
    factoryAddress = await deployTx.getAddress();
    const deployReceipt = await deployTx.deploymentTransaction().wait(chainId === 11155111 ? 1 : 1);
    totalGas += deployReceipt.gasUsed;

    state.contracts.DexFactory = {
      address: factoryAddress,
      args: [],
    };
    state.transactions.DexFactoryDeploy = {
      hash: deployTx.deploymentTransaction().hash,
      gasUsed: deployReceipt.gasUsed.toString(),
    };
    state.totalGasUsed = totalGas.toString();
    saveState();
    console.log(`✅ DexFactory deployed at: ${factoryAddress} (Gas: ${deployReceipt.gasUsed})`);
    dexFactory = await ethers.getContractAt("DexFactory", factoryAddress, deployer);
  }

  // ─── STEP 2: Deploy DexRouter ────────────────────────────────────────────
  let routerAddress = state.contracts.DexRouter?.address;
  let dexRouter;

  if (routerAddress) {
    console.log(`ℹ️ Reusing existing DexRouter at ${routerAddress}`);
    dexRouter = await ethers.getContractAt("DexRouter", routerAddress, deployer);
  } else {
    console.log("🚀 Deploying DexRouter...");
    const Router = await ethers.getContractFactory("DexRouter", deployer);
    const deployTx = await Router.deploy(factoryAddress);
    await deployTx.waitForDeployment();
    routerAddress = await deployTx.getAddress();
    const deployReceipt = await deployTx.deploymentTransaction().wait(chainId === 11155111 ? 1 : 1);
    totalGas += deployReceipt.gasUsed;

    state.contracts.DexRouter = {
      address: routerAddress,
      factory: factoryAddress,
      args: [factoryAddress],
    };
    state.transactions.DexRouterDeploy = {
      hash: deployTx.deploymentTransaction().hash,
      gasUsed: deployReceipt.gasUsed.toString(),
    };
    state.totalGasUsed = totalGas.toString();
    saveState();
    console.log(`✅ DexRouter deployed at: ${routerAddress} (Gas: ${deployReceipt.gasUsed})`);
    dexRouter = await ethers.getContractAt("DexRouter", routerAddress, deployer);
  }

  // ─── STEP 3: Create Pairs ────────────────────────────────────────────────
  // Pair 1: INVX / mUSDC
  let pairInvxMusdcAddress = state.contracts.PairINVX_mUSDC?.address;
  if (!pairInvxMusdcAddress) {
    let existingPair = await dexFactory.getPair(INVX_ADDR, MOCK_USDC_ADDR);
    if (existingPair === ethers.ZeroAddress) {
      console.log("📦 Creating Pair: INVX / mUSDC...");
      await trackTx("CreatePair_INVX_mUSDC", dexFactory.createPair(INVX_ADDR, MOCK_USDC_ADDR));
      existingPair = await dexFactory.getPair(INVX_ADDR, MOCK_USDC_ADDR);
    }
    pairInvxMusdcAddress = existingPair;
    state.contracts.PairINVX_mUSDC = {
      address: pairInvxMusdcAddress,
      token0: INVX_ADDR < MOCK_USDC_ADDR ? INVX_ADDR : MOCK_USDC_ADDR,
      token1: INVX_ADDR < MOCK_USDC_ADDR ? MOCK_USDC_ADDR : INVX_ADDR,
    };
    saveState();
    console.log(`✅ Pair INVX / mUSDC at: ${pairInvxMusdcAddress}`);
  } else {
    console.log(`ℹ️ Reusing existing Pair INVX / mUSDC at: ${pairInvxMusdcAddress}`);
  }

  // Pair 2: vINV / mUSDC
  let pairVinvMusdcAddress = state.contracts.PairvINV_mUSDC?.address;
  if (!pairVinvMusdcAddress) {
    let existingPair = await dexFactory.getPair(INVOICE_VAULT_ADDR, MOCK_USDC_ADDR);
    if (existingPair === ethers.ZeroAddress) {
      console.log("📦 Creating Pair: vINV / mUSDC...");
      await trackTx("CreatePair_vINV_mUSDC", dexFactory.createPair(INVOICE_VAULT_ADDR, MOCK_USDC_ADDR, { gasLimit: 2500000 }));
      existingPair = await dexFactory.getPair(INVOICE_VAULT_ADDR, MOCK_USDC_ADDR);
    }
    pairVinvMusdcAddress = existingPair;
    state.contracts.PairvINV_mUSDC = {
      address: pairVinvMusdcAddress,
      token0: INVOICE_VAULT_ADDR < MOCK_USDC_ADDR ? INVOICE_VAULT_ADDR : MOCK_USDC_ADDR,
      token1: INVOICE_VAULT_ADDR < MOCK_USDC_ADDR ? MOCK_USDC_ADDR : INVOICE_VAULT_ADDR,
    };
    saveState();
    console.log(`✅ Pair vINV / mUSDC at: ${pairVinvMusdcAddress}`);
  } else {
    console.log(`ℹ️ Reusing existing Pair vINV / mUSDC at: ${pairVinvMusdcAddress}`);
  }

  // ─── STEP 4: Seed Initial Liquidity ──────────────────────────────────────
  const mockUSDC = await ethers.getContractAt("MockUSDC", MOCK_USDC_ADDR, deployer);
  const invx = await ethers.getContractAt("INVX", INVX_ADDR, deployer);
  const invoiceVault = await ethers.getContractAt("InvoiceVault", INVOICE_VAULT_ADDR, deployer);

  const pairInvx = await ethers.getContractAt("DexPair", pairInvxMusdcAddress, deployer);
  const pairInvxSupply = await pairInvx.totalSupply();

  if (pairInvxSupply === 0n) {
    console.log("\n💧 Seeding initial liquidity for INVX / mUSDC (100 INVX + 10 mUSDC)...");
    // Ensure deployer has enough tokens
    const invxBal = await invx.balanceOf(deployer.address);
    if (invxBal < SEED_INVX_AMOUNT) {
      console.log("  Faucet INVX to deployer...");
      await trackTx("FaucetINVX", invx.faucet(deployer.address, ethers.parseUnits("1000", 18), { gasLimit: 120000 }));
    }

    const usdcBal = await mockUSDC.balanceOf(deployer.address);
    if (usdcBal < SEED_MUSDC_FOR_INVX + SEED_MUSDC_FOR_VINV + ethers.parseUnits("50", 6)) {
      console.log("  Minting mUSDC to deployer...");
      await trackTx("MintUSDC", mockUSDC.mint(deployer.address, ethers.parseUnits("200", 6), { gasLimit: 120000 }));
    }

    // Approvals
    console.log("  Approving DexRouter for INVX & mUSDC...");
    await trackTx("Approve_INVX_Router", invx.approve(routerAddress, SEED_INVX_AMOUNT, { gasLimit: 80000 }));
    await trackTx("Approve_mUSDC_Router1", mockUSDC.approve(routerAddress, SEED_MUSDC_FOR_INVX, { gasLimit: 80000 }));

    // Add Liquidity
    const deadline = Math.floor(Date.now() / 1000) + 1800;
    console.log("  Calling addLiquidity for INVX / mUSDC...");
    await trackTx(
      "AddLiquidity_INVX_mUSDC",
      dexRouter.addLiquidity(
        INVX_ADDR,
        MOCK_USDC_ADDR,
        SEED_INVX_AMOUNT,
        SEED_MUSDC_FOR_INVX,
        0,
        0,
        deployer.address,
        deadline,
        { gasLimit: 400000 }
      )
    );
    console.log("  ✅ Liquidity added for INVX / mUSDC!");
  } else {
    console.log(`ℹ️ Pair INVX / mUSDC already has liquidity (Total Supply: ${pairInvxSupply})`);
  }

  const pairVinv = await ethers.getContractAt("DexPair", pairVinvMusdcAddress, deployer);
  const pairVinvSupply = await pairVinv.totalSupply();

  if (pairVinvSupply === 0n) {
    console.log("\n💧 Seeding initial liquidity for vINV / mUSDC (10 vINV + 10 mUSDC)...");
    // Ensure deployer has vINV
    const vinvBal = await invoiceVault.balanceOf(deployer.address);
    if (vinvBal < SEED_VINV_AMOUNT) {
      console.log("  Depositing mUSDC into InvoiceVault to obtain vINV...");
      await trackTx("Approve_mUSDC_Vault", mockUSDC.approve(INVOICE_VAULT_ADDR, ethers.parseUnits("20", 6), { gasLimit: 80000 }));
      await trackTx("Deposit_mUSDC_Vault", invoiceVault.deposit(ethers.parseUnits("15", 6), deployer.address, { gasLimit: 150000 }));
    }

    // Approvals
    console.log("  Approving DexRouter for vINV & mUSDC...");
    await trackTx("Approve_vINV_Router", invoiceVault.approve(routerAddress, SEED_VINV_AMOUNT, { gasLimit: 80000 }));
    await trackTx("Approve_mUSDC_Router2", mockUSDC.approve(routerAddress, SEED_MUSDC_FOR_VINV, { gasLimit: 80000 }));

    // Add Liquidity
    const deadline = Math.floor(Date.now() / 1000) + 1800;
    console.log("  Calling addLiquidity for vINV / mUSDC...");
    await trackTx(
      "AddLiquidity_vINV_mUSDC",
      dexRouter.addLiquidity(
        INVOICE_VAULT_ADDR,
        MOCK_USDC_ADDR,
        SEED_VINV_AMOUNT,
        SEED_MUSDC_FOR_VINV,
        0,
        0,
        deployer.address,
        deadline,
        { gasLimit: 400000 }
      )
    );
    console.log("  ✅ Liquidity added for vINV / mUSDC!");
  } else {
    console.log(`ℹ️ Pair vINV / mUSDC already has liquidity (Total Supply: ${pairVinvSupply})`);
  }

  // ─── STEP 5: Optional LP Farm ────────────────────────────────────────────
  if (process.env.DEPLOY_LP_FARM === "true") {
    let lpFarmAddr = state.contracts.InvoiceLPFarm?.address;
    if (!lpFarmAddr) {
      console.log("\n🚜 Deploying InvoiceLPFarm for INVX/mUSDC LP tokens...");
      const Farm = await ethers.getContractFactory("InvoiceFarm", deployer);
      const farmTx = await Farm.deploy(pairInvxMusdcAddress, INVX_ADDR);
      await farmTx.waitForDeployment();
      lpFarmAddr = await farmTx.getAddress();
      const farmReceipt = await farmTx.deploymentTransaction().wait(chainId === 11155111 ? 1 : 1);
      totalGas += farmReceipt.gasUsed;

      state.contracts.InvoiceLPFarm = {
        address: lpFarmAddr,
        stakingToken: pairInvxMusdcAddress,
        rewardToken: INVX_ADDR,
      };
      saveState();
      console.log(`✅ InvoiceLPFarm deployed at: ${lpFarmAddr}`);
    }
  }

  // ─── STEP 6: Update Frontend dexConfig.js ────────────────────────────────
  const frontendConfigPath = path.resolve("./warranty-tracker/src/config/dexConfig.js");
  const configContent = `import dexFactoryAbi from "./dexFactoryAbi.json";
import dexRouterAbi from "./dexRouterAbi.json";
import dexPairAbi from "./dexPairAbi.json";

// ============================================================
// DeFi Experiment 6 DEX Configuration
// Automatically generated on ${new Date().toISOString()}
// ============================================================

export const DEX_FACTORY_ADDRESS = "${factoryAddress}";
export const DEX_ROUTER_ADDRESS = "${routerAddress}";
export const DEX_PAIR_INVX_USDC_ADDRESS = "${pairInvxMusdcAddress}";
export const DEX_PAIR_VINV_USDC_ADDRESS = "${pairVinvMusdcAddress}";

// ABIs
export const DEX_FACTORY_ABI = dexFactoryAbi;
export const DEX_ROUTER_ABI = dexRouterAbi;
export const DEX_PAIR_ABI = dexPairAbi;
`;
  fs.writeFileSync(frontendConfigPath, configContent);
  console.log(`\n📝 Updated frontend config: ${frontendConfigPath}`);

  // ─── STEP 7: Etherscan Verification (if live on Sepolia) ─────────────────
  if (!isDryRun && chainId === 11155111 && process.env.ETHERSCAN_API_KEY && process.env.ETHERSCAN_API_KEY.trim()) {
    console.log("\n🔎 Starting Etherscan contract verification...");
    try {
      await hre.run("verify:verify", {
        address: factoryAddress,
        constructorArguments: [],
      });
      console.log("  ✅ DexFactory verified");
    } catch (e) {
      console.log(`  ℹ️ DexFactory verify note: ${e.message}`);
    }

    try {
      await hre.run("verify:verify", {
        address: routerAddress,
        constructorArguments: [factoryAddress],
      });
      console.log("  ✅ DexRouter verified");
    } catch (e) {
      console.log(`  ℹ️ DexRouter verify note: ${e.message}`);
    }
  } else if (!isDryRun && chainId === 11155111) {
    console.log("\nℹ️ ETHERSCAN_API_KEY not set or empty. Skipping verification.");
  }

  console.log("\n====================================================");
  console.log(`🎉 DEX DEPLOYMENT SUCCESSFUL! Total Gas: ${totalGas.toString()}`);
  console.log("====================================================");

  return {
    state,
    totalGas,
    factoryAddress,
    routerAddress,
    pairInvxMusdcAddress,
    pairVinvMusdcAddress,
  };
}

// Allow direct CLI execution: hardhat run scripts/deploy_dex.js --network sepolia
if (process.argv[1] && process.argv[1].includes("deploy_dex.js")) {
  runDeployment()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("\n❌ DEPLOYMENT FAILED:", err);
      process.exit(1);
    });
}
