import hre from "hardhat";
import { ethers } from "ethers";
import dotenv from "dotenv";

dotenv.config();

// Existing MockUSDC address from warranty-tracker/src/config/contractConfig.js
const EXISTING_MOCK_USDC = "0xb87fF8Dd0B49d578D20df8887f67303A6c95e62e";

async function main() {
  console.log("====================================================");
  console.log("      SEPOLIA PREFLIGHT VERIFICATION SCRIPT         ");
  console.log("====================================================");

  // 1. Validate PRIVATE_KEY in .env
  const rawKey = process.env.PRIVATE_KEY ? process.env.PRIVATE_KEY.trim() : "";
  if (!rawKey) {
    console.error("\n❌ PREFLIGHT ERROR: PRIVATE_KEY is not set in .env!");
    console.error("👉 Action required: Open .env in your editor and paste your wallet private key:");
    console.error("   PRIVATE_KEY=your_private_key_here\n");
    process.exit(1);
  }

  const normalized = rawKey.startsWith("0x") ? rawKey : `0x${rawKey}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(normalized)) {
    console.error("\n❌ PREFLIGHT ERROR: PRIVATE_KEY format is invalid!");
    console.error("👉 Action required: Ensure your private key is a 64-character hex string (32 bytes).");
    console.error("   Never commit or share this key.\n");
    process.exit(1);
  }

  // Derive wallet address strictly from key (NEVER print the key)
  const wallet = new ethers.Wallet(normalized);
  console.log(`\n✅ Private key is valid.`);
  console.log(`📍 Derived Wallet Address: ${wallet.address}`);

  // 2. Connect to Sepolia RPC
  const rpcUrl = process.env.SEPOLIA_RPC_URL && process.env.SEPOLIA_RPC_URL.trim()
    ? process.env.SEPOLIA_RPC_URL.trim()
    : "https://ethereum-sepolia-rpc.publicnode.com";

  console.log(`📡 Connecting to RPC: ${rpcUrl}...`);
  const provider = new ethers.JsonRpcProvider(rpcUrl);

  let network;
  try {
    network = await provider.getNetwork();
  } catch (err) {
    console.error(`\n❌ PREFLIGHT ERROR: Could not connect to Sepolia RPC at ${rpcUrl}!`);
    console.error("👉 Action required: Check your internet connection or update SEPOLIA_RPC_URL in .env (e.g. Infura / Alchemy).");
    console.error(`   Details: ${err.message}\n`);
    process.exit(1);
  }

  const chainId = Number(network.chainId);
  if (chainId !== 11155111) {
    console.error(`\n❌ PREFLIGHT ERROR: RPC returned Chain ID ${chainId}, expected 11155111 (Sepolia)!`);
    console.error("👉 Action required: Update SEPOLIA_RPC_URL in .env to a valid Sepolia endpoint.\n");
    process.exit(1);
  }
  console.log(`✅ RPC connected successfully (Chain ID: ${chainId} - Sepolia).`);

  // 3. Check Sepolia ETH balance
  let balanceWei;
  try {
    balanceWei = await provider.getBalance(wallet.address);
  } catch (err) {
    console.error(`\n❌ PREFLIGHT ERROR: Failed to query ETH balance for ${wallet.address}!`);
    process.exit(1);
  }

  const balanceEth = parseFloat(ethers.formatEther(balanceWei));
  console.log(`💰 Sepolia ETH Balance: ${balanceEth.toFixed(4)} ETH`);

  if (balanceEth < 0.05) {
    console.warn(`\n⚠️  WARNING: Balance is below 0.05 ETH (${balanceEth.toFixed(4)} ETH).`);
    console.warn(`   Deploying 5 smart contracts and wiring transactions will cost ~0.02 - 0.04 ETH.`);
    console.warn(`👉 Action required: Grab free testnet ETH from one of these Sepolia faucets:`);
    console.warn(`   - https://sepoliafaucet.com/ (Alchemy)`);
    console.warn(`   - https://cloud.google.com/application/web3/faucet/ethereum/sepolia (Google Web3)`);
    console.warn(`   - https://faucets.chain.link/sepolia (Chainlink)\n`);
    if (balanceEth < 0.005) {
      console.error("❌ PREFLIGHT ERROR: Insufficient ETH to perform transactions. Fund wallet first!");
      process.exit(1);
    }
  } else {
    console.log(`✅ Sufficient Sepolia ETH balance for deployment.`);
  }

  // 4. Verify existing MockUSDC contract has bytecode on Sepolia
  console.log(`\n🔍 Checking existing MockUSDC contract at ${EXISTING_MOCK_USDC}...`);
  let code;
  try {
    code = await provider.getCode(EXISTING_MOCK_USDC);
  } catch (err) {
    console.error(`\n❌ PREFLIGHT ERROR: Failed to check contract code: ${err.message}`);
    process.exit(1);
  }

  if (!code || code === "0x" || code === "0x0") {
    console.error(`\n❌ PREFLIGHT ERROR: No bytecode found at MockUSDC address ${EXISTING_MOCK_USDC}!`);
    console.error("👉 Action required: Check MOCK_USDC_ADDRESS in warranty-tracker/src/config/contractConfig.js.");
    process.exit(1);
  }
  console.log(`✅ MockUSDC contract verified on Sepolia.`);

  console.log("\n====================================================");
  console.log("🎉 ALL PREFLIGHT CHECKS PASSED! Ready for deployment.");
  console.log("====================================================");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
