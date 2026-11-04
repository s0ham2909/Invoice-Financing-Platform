import hre from "hardhat";
const { ethers: hardhatEthers } = hre;
import { ethers } from "ethers";
import dotenv from "dotenv";
import { runDeployment } from "./deploy_dex.js";

dotenv.config();

async function main() {
  console.log("====================================================");
  console.log("       EXPERIMENT 6: DEX FORK DRY-RUN & GATE        ");
  console.log("====================================================\n");

  const rawKey = process.env.PRIVATE_KEY ? process.env.PRIVATE_KEY.trim() : "";
  if (!rawKey) {
    console.error("❌ ERROR: PRIVATE_KEY is not set in .env!");
    process.exit(1);
  }
  const normalizedKey = rawKey.startsWith("0x") ? rawKey : `0x${rawKey}`;
  const realWallet = new ethers.Wallet(normalizedKey);
  const deployerAddress = realWallet.address;

  const sepoliaRpcUrl =
    process.env.SEPOLIA_RPC_URL && process.env.SEPOLIA_RPC_URL.trim()
      ? process.env.SEPOLIA_RPC_URL.trim()
      : "https://ethereum-sepolia-rpc.publicnode.com";

  console.log(`📡 Connecting to Sepolia via ${sepoliaRpcUrl}...`);
  const sepoliaProvider = new ethers.JsonRpcProvider(sepoliaRpcUrl);

  const realBalanceWei = await sepoliaProvider.getBalance(deployerAddress);
  const feeData = await sepoliaProvider.getFeeData();
  const gasPrice = feeData.gasPrice || feeData.maxFeePerGas || ethers.parseUnits("15", "gwei");

  console.log(`📍 Deployer Address: ${deployerAddress}`);
  console.log(`💰 Real Sepolia Balance: ${ethers.formatEther(realBalanceWei)} ETH`);
  console.log(`⛽ Current Sepolia Gas Price: ${ethers.formatUnits(gasPrice, "gwei")} Gwei`);

  // ─── STEP 1: Fork Sepolia in Hardhat ───────────────────────────────────────
  console.log("\n🍴 Initializing local Sepolia Fork for simulation...");
  await hre.network.provider.request({
    method: "hardhat_reset",
    params: [
      {
        forking: {
          jsonRpcUrl: sepoliaRpcUrl,
        },
      },
    ],
  });

  // Fund deployer with 10 ETH on the fork for gas simulation
  await hre.network.provider.send("hardhat_setBalance", [
    deployerAddress,
    "0x8AC7230489E80000", // 10 ETH in hex
  ]);

  // Impersonate deployer on fork
  await hre.network.provider.request({
    method: "hardhat_impersonateAccount",
    params: [deployerAddress],
  });

  const forkSigner = await hardhatEthers.getSigner(deployerAddress);
  console.log("✅ Fork active. Running dry-run deployment to measure exact gas...");

  // ─── STEP 2: Run dry-run deployment on fork ──────────────────────────────
  const dryRunResult = await runDeployment({
    isDryRun: true,
    customSigner: forkSigner,
  });

  const totalGasUsed = dryRunResult.totalGas;
  console.log(`\n📊 MEASURED GAS USAGE ACROSS ALL STEPS: ${totalGasUsed.toString()} gas units`);

  // Calculate required ETH with 25% safety buffer
  // estimatedEthNeeded = (totalGas * gasPrice * 125) / 100
  const estimatedEthWei = (totalGasUsed * gasPrice * 125n) / 100n;
  const estimatedEth = ethers.formatEther(estimatedEthWei);
  const realBalanceEth = ethers.formatEther(realBalanceWei);

  console.log("\n====================================================");
  console.log("               SEPOLIA BUDGET ASSESSMENT            ");
  console.log("====================================================");
  console.log(`  Measured Gas Total:       ${totalGasUsed.toString()} units`);
  console.log(`  Gas Price Applied:        ${ethers.formatUnits(gasPrice, "gwei")} Gwei`);
  console.log(`  Estimated ETH (with +25%): ${estimatedEth} ETH`);
  console.log(`  Current Wallet Balance:   ${realBalanceEth} ETH`);

  if (realBalanceWei < estimatedEthWei) {
    const shortfallWei = estimatedEthWei - realBalanceWei;
    const shortfallEth = ethers.formatEther(shortfallWei);

    console.log(`  Status:                   ❌ INSUFFICIENT BALANCE`);
    console.log(`  Exact Shortfall:          ${shortfallEth} ETH`);
    console.log("====================================================\n");
    console.error("🛑 CRITICAL GATE HALT: Wallet balance is below estimated deployment cost!");
    console.error("   To prevent partial deployment failures, NO TRANSACTIONS HAVE BEEN SENT TO REAL SEPOLIA.");
    console.error(`\n👉 PLEASE SEND TESTNET ETH TO THIS ADDRESS:`);
    console.error(`   ${deployerAddress}`);
    console.error(`   Required minimum: ${estimatedEth} ETH (short by ${shortfallEth} ETH)`);
    console.error(`\nOnce funded, you can execute the real deployment with:`);
    console.error(`   npx hardhat run scripts/dex_gate_and_deploy.js --network sepolia\n`);
    process.exit(2);
  }

  console.log(`  Status:                   ✅ SUFFICIENT BALANCE`);
  console.log("====================================================\n");
  console.log("🚀 Balance check passed! Proceeding to execute real Sepolia deployment...");

  // If we are already connected to sepolia network via CLI, run live deployment
  // Otherwise prompt user to execute on sepolia network.
  if (hre.network.name === "sepolia") {
    console.log("Executing live deployment on Sepolia...");
    await runDeployment({ isDryRun: false });
  } else {
    console.log("Simulation complete! To deploy on Sepolia, run:");
    console.log("npx hardhat run scripts/deploy_dex.js --network sepolia");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
