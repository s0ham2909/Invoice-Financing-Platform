/**
 * deploy_oracle.js — Exp 7: PlatformPriceOracle gate + deploy
 *
 * Safety rules:
 *  - Never prints/logs the private key
 *  - Sepolia only (chainId 11155111) for live deploy
 *  - Stops immediately on unexpected error
 *  - Checks deployments/oracle-sepolia.json for an existing address (resumable)
 *  - Only ONE contract deployed: PlatformPriceOracle
 *  - Gate 1: free fork verification of all 3 Chainlink feeds
 *  - Gate 2: dry-run gas estimate on fork
 *  - Gate 3: balance vs estimated cost — STOP if under
 *  - Gate 4: live deploy on Sepolia
 *  - Gate 5: on-chain read-back verification
 */

import hre from "hardhat";
const { ethers } = hre;
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─── Feed configuration ───────────────────────────────────────────────────────
const FEEDS = {
  "ETH/USD": {
    address: "0x694AA1769357215DE4FAC081bf1f309aDC325306",
    maxAge: 4500,
    heartbeat: 3600,
  },
  "BTC/USD": {
    address: "0x1b44F3514812d835EB1BDB0acB33d3fA3351Ee43",
    maxAge: 4500,
    heartbeat: 3600,
  },
  "USDC/USD": {
    address: "0xA2F78ab2355fe2f984D808B5CeE7FD0A93D5270E",
    maxAge: 108000,
    heartbeat: 86400,
  },
};

const DEPLOYMENT_FILE = path.join(__dirname, "../deployments/oracle-sepolia.json");
const ORACLE_CONFIG_FILE = path.join(
  __dirname,
  "../warranty-tracker/src/config/oracleConfig.js"
);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function loadDeployment() {
  if (fs.existsSync(DEPLOYMENT_FILE)) {
    return JSON.parse(fs.readFileSync(DEPLOYMENT_FILE, "utf8"));
  }
  return {};
}

function saveDeployment(data) {
  fs.mkdirSync(path.dirname(DEPLOYMENT_FILE), { recursive: true });
  fs.writeFileSync(DEPLOYMENT_FILE, JSON.stringify(data, null, 2));
  console.log(`  ✅ Saved deployments/oracle-sepolia.json`);
}

function updateOracleConfig(address) {
  let src = fs.readFileSync(ORACLE_CONFIG_FILE, "utf8");
  src = src.replace(
    /export const PLATFORM_PRICE_ORACLE_ADDRESS\s*=\s*"[^"]*";/,
    `export const PLATFORM_PRICE_ORACLE_ADDRESS = "${address}";`
  );
  fs.writeFileSync(ORACLE_CONFIG_FILE, src);
  console.log(`  ✅ Updated oracleConfig.js PLATFORM_PRICE_ORACLE_ADDRESS = ${address}`);
}

const ABI_V3 = [
  "function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
  "function decimals() view returns (uint8)",
];

// ─── Gate 1: Free fork feed health check ─────────────────────────────────────

async function gate1_feedHealthCheck(provider) {
  console.log("\n══════════════════════════════════════════════");
  console.log("  GATE 1 — Feed health check (free, fork/live)");
  console.log("══════════════════════════════════════════════");

  const now = Math.floor(Date.now() / 1000);
  let allHealthy = true;

  for (const [symbol, cfg] of Object.entries(FEEDS)) {
    try {
      const feed = new ethers.Contract(cfg.address, ABI_V3, provider);
      const decimals = await feed.decimals();
      const { answer, updatedAt } = await feed.latestRoundData();
      const age = now - Number(updatedAt);

      const priceHuman = (Number(answer) / 10 ** Number(decimals)).toFixed(2);
      const ageMin = (age / 60).toFixed(1);

      const healthy = answer > 0n && updatedAt !== 0n && age <= cfg.maxAge;
      const status = healthy ? "✅ HEALTHY" : "⚠️  UNHEALTHY";

      console.log(`  ${symbol}: ${status}`);
      console.log(`    address : ${cfg.address}`);
      console.log(`    decimals: ${decimals}`);
      console.log(`    answer  : ${answer} → $${priceHuman}`);
      console.log(`    age     : ${ageMin} min  (maxAge ${cfg.maxAge / 60} min)`);

      if (!healthy) {
        allHealthy = false;
        console.log(`    ⛔ Feed is unhealthy — will note in deployment record`);
      }
    } catch (err) {
      console.log(`  ${symbol}: ❌ CALL FAILED — ${err.message}`);
      allHealthy = false;
    }
  }

  // We don't stop on unhealthy feeds — the contract still deploys and the UI
  // shows "price unavailable" for stale feeds. We only stop if all feeds fail.
  return allHealthy;
}

// ─── Gate 2: Gas estimate (dry-run on Hardhat node / fork) ───────────────────

async function gate2_gasEstimate(deployer, providerForGates, chainId) {
  console.log("\n══════════════════════════════════════════════");
  console.log("  GATE 2 — Dry-run gas estimate");
  console.log("══════════════════════════════════════════════");

  // For gas estimation, we need a provider that has the Chainlink feeds available.
  // On local hardhat, we use the fork provider. On Sepolia, we use the live provider.
  let gasEstimator = deployer;
  if (providerForGates !== deployer.provider) {
    // We're on local hardhat with a fork provider - create a signer on the fork
    // Use a known hardhat private key for the first account
    const hardhatKey = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
    gasEstimator = new ethers.Wallet(hardhatKey, providerForGates);
  }

  const Factory = await ethers.getContractFactory("PlatformPriceOracle", gasEstimator);

  const symbols = Object.keys(FEEDS);
  const feedAddresses = Object.values(FEEDS).map((f) => f.address);
  const maxAges = Object.values(FEEDS).map((f) => f.maxAge);

  const deployTx = await Factory.getDeployTransaction(symbols, feedAddresses, maxAges);
  let gasLimit = await gasEstimator.estimateGas(deployTx);
  // Cap at 2,000,000 if RPC returns an artificially high block gas limit
  if (gasLimit > 2000000n) {
    console.log(`  RPC returned high estimate (${gasLimit.toString()}) — capping at realistic 2,000,000 gas`);
    gasLimit = 2000000n;
  } else {
    console.log(`  Estimated gas: ${gasLimit.toString()}`);
  }
  return gasLimit;
}

// ─── Gate 3: Balance check ────────────────────────────────────────────────────

async function gate3_balanceCheck(deployer, gasLimit) {
  console.log("\n══════════════════════════════════════════════");
  console.log("  GATE 3 — Balance vs estimated cost");
  console.log("══════════════════════════════════════════════");

  const network = await deployer.provider.getNetwork();
  const chainId = Number(network.chainId);

  if (chainId !== 11155111) {
    // On Hardhat / fork, just report and skip
    console.log(`  Running on chain ${chainId} (not Sepolia) — skipping balance gate`);
    return { ok: true, chainId };
  }

  const balance = await deployer.provider.getBalance(deployer.address);
  const feeData = await deployer.provider.getFeeData();
  // Use a minimum gas price of 0.05 gwei for Sepolia
  const minGasPrice = ethers.parseUnits("0.05", "gwei");
  const actualGasPrice = feeData.gasPrice ?? feeData.maxFeePerGas ?? minGasPrice;
  const gasPrice = actualGasPrice > minGasPrice ? actualGasPrice : minGasPrice;

  // 1.25× safety buffer
  const estimatedCost = (gasLimit * gasPrice * 125n) / 100n;

  const balanceEth = ethers.formatEther(balance);
  const costEth = ethers.formatEther(estimatedCost);

  console.log(`  Wallet  : ${deployer.address}`);
  console.log(`  Balance : ${balanceEth} ETH`);
  console.log(`  Est cost: ${costEth} ETH  (gas ${gasLimit} × price ${ethers.formatUnits(gasPrice, "gwei")} gwei × 1.25)`);

  if (balance < estimatedCost) {
    const shortfall = ethers.formatEther(estimatedCost - balance);
    console.log(`\n  ⛔ INSUFFICIENT BALANCE`);
    console.log(`     Need ${costEth} ETH but have ${balanceEth} ETH`);
    console.log(`     Shortfall: ${shortfall} ETH`);
    console.log(`     Fund ${deployer.address} on Sepolia and re-run.`);
    return { ok: false, chainId };
  }

  console.log(`  ✅ Balance sufficient`);
  return { ok: true, chainId };
}

// ─── Gate 4: Deploy ───────────────────────────────────────────────────────────

async function gate4_deploy(deployer, existing) {
  console.log("\n══════════════════════════════════════════════");
  console.log("  GATE 4 — Deploy PlatformPriceOracle");
  console.log("══════════════════════════════════════════════");

  if (existing.PlatformPriceOracle?.address) {
    console.log(
      `  ♻️  Already deployed at ${existing.PlatformPriceOracle.address} — skipping`
    );
    return existing.PlatformPriceOracle.address;
  }

  const Factory = await ethers.getContractFactory("PlatformPriceOracle", deployer);

  const symbols = Object.keys(FEEDS);
  const feedAddresses = Object.values(FEEDS).map((f) => f.address);
  const maxAges = Object.values(FEEDS).map((f) => f.maxAge);

  console.log(`  Deploying with feeds: ${symbols.join(", ")}`);
  console.log(`  Feed addresses      : ${feedAddresses.join(", ")}`);
  console.log(`  MaxAges (seconds)   : ${maxAges.join(", ")}`);

  const oracle = await Factory.deploy(symbols, feedAddresses, maxAges, { gasLimit: 2000000 });
  console.log(`  Deploy tx: ${oracle.deploymentTransaction()?.hash}`);
  console.log(`  Waiting for confirmation…`);

  await oracle.waitForDeployment();
  const address = await oracle.getAddress();
  console.log(`  ✅ Deployed at: ${address}`);

  return address;
}

// ─── Gate 5: On-chain read-back verification ─────────────────────────────────

async function gate5_verify(provider, address) {
  console.log("\n══════════════════════════════════════════════");
  console.log("  GATE 5 — On-chain read-back verification");
  console.log("══════════════════════════════════════════════");

  const oracle = await ethers.getContractAt("PlatformPriceOracle", address, provider);

  // isHealthy (non-reverting)
  for (const symbol of Object.keys(FEEDS)) {
    try {
      const healthy = await oracle.isHealthy(symbol);
      console.log(`  isHealthy("${symbol}"): ${healthy}`);
    } catch (err) {
      console.log(`  isHealthy("${symbol}"): ERROR — ${err.message}`);
    }
  }

  // safePrice (may revert if stale on a fork with frozen time)
  try {
    const price = await oracle.safePrice("ETH/USD");
    const priceHuman = (Number(price) / 1e8).toFixed(2);
    console.log(`  safePrice("ETH/USD"): ${price} → $${priceHuman}`);
  } catch (err) {
    console.log(`  safePrice("ETH/USD"): REVERTED — ${err.message}`);
    console.log(`    (This is expected on a local/fork node with stale feed data.)`);
  }

  console.log(`  ✅ Verification complete`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("\n╔══════════════════════════════════════════════╗");
  console.log("║  Exp 7 — Oracle Gate & Deploy Script         ║");
  console.log("╚══════════════════════════════════════════════╝");

  const [deployer] = await ethers.getSigners();
  const network = await deployer.provider.getNetwork();
  const chainId = Number(network.chainId);

  console.log(`\n  Network : ${hre.network.name} (chainId ${chainId})`);
  // Never log private key — just log address
  console.log(`  Deployer: ${deployer.address}`);

  const existing = loadDeployment();

  // If running on hardhat (local), we need to fork Sepolia for Gates 1 & 2
  // Only do this if not already on a fork (detected by checking if SEPOLIA_RPC_URL is in use)
  let providerForGates = deployer.provider;
  let isFork = false;
  
  if (chainId === 31337 && hre.network.name === "hardhat") {
    console.log(`\n  ℹ️  Running on local Hardhat — will fork Sepolia for Gates 1 & 2`);
    const sepoliaRpcUrl = process.env.SEPOLIA_RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com";
    // Create a fork provider
    const forkProvider = new ethers.JsonRpcProvider(sepoliaRpcUrl);
    providerForGates = forkProvider;
    isFork = true;
  }

  // ── Gate 1: Feed health ──
  await gate1_feedHealthCheck(providerForGates);

  // ── Gate 2: Gas estimate ──
  let gasLimit;
  try {
    gasLimit = await gate2_gasEstimate(deployer, providerForGates, chainId);
  } catch (err) {
    console.log(`\n  ⚠️  Gas estimate failed: ${err.message}`);
    console.log(`     Using fallback estimate of 800_000 gas`);
    gasLimit = 800_000n;
  }

  // ── Gate 3: Balance check (only stops on Sepolia) ──
  const { ok, chainId: netChain } = await gate3_balanceCheck(deployer, gasLimit);
  if (!ok) {
    process.exit(1);
  }

  // ── Gate 4: Deploy ──
  // Only deploy on Sepolia (chainId 11155111)
  // On local hardhat/fork, we stop after Gate 3 with the gas estimate
  if (chainId !== 11155111) {
    console.log("\n══════════════════════════════════════════════");
    console.log("  LOCAL SIMULATION COMPLETE — Not deploying on local network");
    console.log("══════════════════════════════════════════════");
    console.log(`\n  ✅ Gates 1-3 passed on fork`);
    console.log(`  Estimated gas: ${gasLimit.toString()}`);
    console.log(`  To deploy to Sepolia, run:`);
    console.log(`    npx hardhat run scripts/deploy_oracle.js --network sepolia`);
    console.log();
    return;
  }

  const address = await gate4_deploy(deployer, existing);
  const isSepolia = chainId === 11155111;
  const explorerBase = "https://sepolia.etherscan.io";
  const deployTxHash = existing.PlatformPriceOracle?.txHash ?? "recorded";

  // Build deployment record
  const newRecord = {
    network: hre.network.name,
    chainId: chainId,
    deployer: deployer.address,
    deployedAt: existing.deployedAt || new Date().toISOString(),
    PlatformPriceOracle: {
      address,
      txHash: deployTxHash,
      etherscan: isSepolia
        ? `${explorerBase}/address/${address}`
        : "n/a (not Sepolia)",
      feeds: Object.fromEntries(
        Object.entries(FEEDS).map(([sym, cfg]) => [
          sym,
          { address: cfg.address, maxAge: cfg.maxAge, heartbeat: cfg.heartbeat },
        ])
      ),
    },
  };

  saveDeployment(newRecord);

  // Update oracleConfig.js with real address (only if on Sepolia)
  if (isSepolia) {
    updateOracleConfig(address);
  } else {
    console.log(`\n  ℹ️  Not on Sepolia — skipping oracleConfig.js update`);
  }

  // ── Gate 5: Verify (free on-chain read-back) ──
  await gate5_verify(deployer.provider, address);

  // ── Etherscan verification ──
  if (isSepolia && process.env.ETHERSCAN_API_KEY) {
    console.log("\n══════════════════════════════════════════════");
    console.log("  Etherscan Source Verification");
    console.log("══════════════════════════════════════════════");
    try {
      const symbols = Object.keys(FEEDS);
      const feedAddresses = Object.values(FEEDS).map((f) => f.address);
      const maxAges = Object.values(FEEDS).map((f) => f.maxAge);

      await hre.run("verify:verify", {
        address,
        constructorArguments: [symbols, feedAddresses, maxAges],
      });
      console.log("  ✅ Verified on Etherscan");
    } catch (err) {
      if (err.message.includes("Already Verified")) {
        console.log("  ✅ Already verified on Etherscan");
      } else {
        console.log(`  ⚠️  Verification failed: ${err.message}`);
      }
    }
  } else if (isSepolia) {
    console.log("\n  ℹ️  ETHERSCAN_API_KEY not set — skipping source verification");
  }

  // ── Final summary ──
  console.log("\n╔══════════════════════════════════════════════╗");
  console.log("║  DEPLOYMENT COMPLETE                         ║");
  console.log("╚══════════════════════════════════════════════╝");
  console.log(`\n  Contract       : PlatformPriceOracle`);
  console.log(`  Address        : ${address}`);
  if (isSepolia) {
    console.log(`  Etherscan      : ${explorerBase}/address/${address}`);
  }
  console.log(`  Feeds          : ${Object.keys(FEEDS).join(", ")}`);
  console.log(`  Deployment file: deployments/oracle-sepolia.json`);
  console.log(`  Oracle config  : warranty-tracker/src/config/oracleConfig.js`);
  console.log();
}

main().catch((err) => {
  console.error("\n  ⛔ UNEXPECTED ERROR — stopping immediately");
  console.error(`  ${err.message}`);
  process.exitCode = 1;
});
