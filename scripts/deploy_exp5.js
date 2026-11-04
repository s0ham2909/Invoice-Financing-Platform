import hre from "hardhat";
const { ethers } = hre;
import fs from "fs";
import path from "path";
import dotenv from "dotenv";

dotenv.config();

// Existing deployed Sepolia addresses
const EXISTING_MOCK_USDC = "0xb87fF8Dd0B49d578D20df8887f67303A6c95e62e";
const EXISTING_INVOICE_NFT = "0x8260d0fe7b2c2302939C29155B67db619a933a99";

// Previously deployed contract addresses from the first run:
const PREV_DEPLOYED = {
  InvoiceVault: "0x81289DBECab824C8db0d5193e2D6a8d8276A1456",
  INVX: "0xc2b51d72E701013F2107F77a7eDFB74735332739",
  ReserveStaking: "0xfd26E9E48a0AF8c695db86667203f9f0aaAbAC24",
  InvoiceFarm: "0x5a2268E7e3ae8E83190422d508237f3A6fBEfa78",
  FeeRouter: "0x1cBABbD581f4fe4566B22a21CF33D35e17b8b268",
  TierGate: "0x6136516ce353dbAa62B1c1B63F6b41b502D6cCc8",
};

const PREV_TXS = {
  InvoiceVaultDeploy: "0x14262db73f3696abb16bab48ae6227e3b1f126bda59fc764cfe38738fc67276f",
  INVXDeploy: "0x8281ae3e19e34626fb9d2d6de1de8083404ed5e9dea45cecae4502e981f26572",
  ReserveStakingDeploy: "0xf8bbefeaf4f29b2adf8ea916f36885ee3a6673593b3e0cb0140885769d3014bd",
  InvoiceFarmDeploy: "0x4fc6a59d1351319d75a34c222073b62f49bd8ade99923e9260a430d58fb8d454",
  FeeRouterDeploy: "0x280be88486ebefc7201c17375a70956fd84bf30dd19a2cb107a0da95c9dd72a4",
  TierGateDeploy: "0x6c52672e50f81c02e6cb1df50ddd5b53c3e728d86f8ac037bb43a0d6d36ef400",
  AuthorizeFeeRouter: "0xe7275c586ddeb361859a9fb1563c044e4e8f34d1d1b9c5a19a70c76b90357943",
  AuthorizeTierGate: "0xac158166fd8f8ed57d803acf8c7cb15a6da2a36034e3fddf403250df0972fd92",
  FundInvoiceFarm: "0x8c35007c05fd70ba2118d5e701610849a5ff176c11cea6794c213f727bae7a9b",
  NotifyFarmRewards: "0xca0eab557c41b09c4ddf703280304f043232e84439115426ebb73d71f94d4ca4",
  SetUtilizationIncentive: "0x8243f774faca706a23de12aa5e3f43d47624989ae6feb6953716ad0b825e44ef",
};

async function main() {
  const signers = await ethers.getSigners();
  if (!signers || signers.length === 0) {
    console.error("\n❌ ERROR: No deployer account available! Check PRIVATE_KEY in .env.");
    process.exit(1);
  }

  const deployer = signers[0];
  const network = await ethers.provider.getNetwork();

  // Safety Assertion: Never deploy to mainnet
  if (Number(network.chainId) === 1) {
    console.error("❌ SAFETY HALT: Target chain ID is 1 (Ethereum Mainnet). Aborting immediately!");
    process.exit(1);
  }

  console.log("====================================================");
  console.log("       DEPLOYING TO NETWORK:", network.name.toUpperCase(), `(Chain ID: ${network.chainId})`);
  console.log("       Deployer Wallet:", deployer.address);
  const balanceWei = await ethers.provider.getBalance(deployer.address);
  console.log("       Deployer Balance:", ethers.formatEther(balanceWei), "ETH");
  console.log("====================================================\n");

  const getExplorerLink = (txHash) => `https://sepolia.etherscan.io/tx/${txHash}`;
  const getAddressLink = (addr) => `https://sepolia.etherscan.io/address/${addr}`;

  // Attach to the verified, deployed contracts on Sepolia
  console.log("Reusing verified on-chain deployments from transactions:");
  const invoiceVaultAddress = PREV_DEPLOYED.InvoiceVault;
  const invxAddress = PREV_DEPLOYED.INVX;
  const reserveStakingAddress = PREV_DEPLOYED.ReserveStaking;
  const invoiceFarmAddress = PREV_DEPLOYED.InvoiceFarm;
  const feeRouterAddress = PREV_DEPLOYED.FeeRouter;
  const tierGateAddress = PREV_DEPLOYED.TierGate;

  console.log(` - InvoiceVault:   ${invoiceVaultAddress}`);
  console.log(` - INVX:           ${invxAddress}`);
  console.log(` - ReserveStaking: ${reserveStakingAddress}`);
  console.log(` - InvoiceFarm:    ${invoiceFarmAddress}`);
  console.log(` - FeeRouter:      ${feeRouterAddress}`);
  console.log(` - TierGate:       ${tierGateAddress}`);

  const invoiceVault = await ethers.getContractAt("InvoiceVault", invoiceVaultAddress, deployer);
  const invx = await ethers.getContractAt("INVX", invxAddress, deployer);
  const reserveStaking = await ethers.getContractAt("ReserveStaking", reserveStakingAddress, deployer);
  const invoiceFarm = await ethers.getContractAt("InvoiceFarm", invoiceFarmAddress, deployer);
  const feeRouter = await ethers.getContractAt("FeeRouter", feeRouterAddress, deployer);
  const tierGate = await ethers.getContractAt("TierGate", tierGateAddress, deployer);

  const deploymentData = {
    network: network.name,
    chainId: Number(network.chainId),
    deployer: deployer.address,
    timestamp: new Date().toISOString(),
    contracts: {
      InvoiceVault: { address: invoiceVaultAddress, explorer: getAddressLink(invoiceVaultAddress), args: [EXISTING_MOCK_USDC] },
      INVX: { address: invxAddress, explorer: getAddressLink(invxAddress), args: [] },
      ReserveStaking: { address: reserveStakingAddress, explorer: getAddressLink(reserveStakingAddress), args: [invxAddress, EXISTING_MOCK_USDC] },
      InvoiceFarm: { address: invoiceFarmAddress, explorer: getAddressLink(invoiceFarmAddress), args: [invoiceVaultAddress, invxAddress] },
      FeeRouter: { address: feeRouterAddress, explorer: getAddressLink(feeRouterAddress), args: [EXISTING_MOCK_USDC, invoiceVaultAddress, reserveStakingAddress, deployer.address] },
      TierGate: { address: tierGateAddress, explorer: getAddressLink(tierGateAddress), args: [EXISTING_INVOICE_NFT, reserveStakingAddress] },
    },
    transactions: {
      InvoiceVaultDeploy: { hash: PREV_TXS.InvoiceVaultDeploy, explorer: getExplorerLink(PREV_TXS.InvoiceVaultDeploy) },
      INVXDeploy: { hash: PREV_TXS.INVXDeploy, explorer: getExplorerLink(PREV_TXS.INVXDeploy) },
      ReserveStakingDeploy: { hash: PREV_TXS.ReserveStakingDeploy, explorer: getExplorerLink(PREV_TXS.ReserveStakingDeploy) },
      InvoiceFarmDeploy: { hash: PREV_TXS.InvoiceFarmDeploy, explorer: getExplorerLink(PREV_TXS.InvoiceFarmDeploy) },
      FeeRouterDeploy: { hash: PREV_TXS.FeeRouterDeploy, explorer: getExplorerLink(PREV_TXS.FeeRouterDeploy) },
      TierGateDeploy: { hash: PREV_TXS.TierGateDeploy, explorer: getExplorerLink(PREV_TXS.TierGateDeploy) },
      AuthorizeFeeRouter: { hash: PREV_TXS.AuthorizeFeeRouter, explorer: getExplorerLink(PREV_TXS.AuthorizeFeeRouter) },
      AuthorizeTierGate: { hash: PREV_TXS.AuthorizeTierGate, explorer: getExplorerLink(PREV_TXS.AuthorizeTierGate) },
      FundInvoiceFarm: { hash: PREV_TXS.FundInvoiceFarm, explorer: getExplorerLink(PREV_TXS.FundInvoiceFarm) },
      NotifyFarmRewards: { hash: PREV_TXS.NotifyFarmRewards, explorer: getExplorerLink(PREV_TXS.NotifyFarmRewards) },
      SetUtilizationIncentive: { hash: PREV_TXS.SetUtilizationIncentive, explorer: getExplorerLink(PREV_TXS.SetUtilizationIncentive) },
    },
  };

  // ─────────────────────────────────────────────────────────────
  // READ-BACK VERIFICATION FROM CHAIN
  // ─────────────────────────────────────────────────────────────
  console.log("\n====================================================");
  console.log("       VERIFYING ON-CHAIN WIRING VIA RPC READS      ");
  console.log("====================================================");

  // Check 1: Owner checks
  const vaultOwner = await invoiceVault.owner();
  const farmOwner = await invoiceFarm.owner();
  const stakingOwner = await reserveStaking.owner();
  const routerOwner = await feeRouter.owner();
  const tierGateOwner = await tierGate.owner();

  console.log(` - InvoiceVault Owner:   ${vaultOwner} ${vaultOwner === deployer.address ? "✅" : "❌"}`);
  console.log(` - InvoiceFarm Owner:    ${farmOwner} ${farmOwner === deployer.address ? "✅" : "❌"}`);
  console.log(` - ReserveStaking Owner: ${stakingOwner} ${stakingOwner === deployer.address ? "✅" : "❌"}`);
  console.log(` - FeeRouter Owner:      ${routerOwner} ${routerOwner === deployer.address ? "✅" : "❌"}`);
  console.log(` - TierGate Owner:       ${tierGateOwner} ${tierGateOwner === deployer.address ? "✅" : "❌"}`);

  // Check 2: Token addresses
  const farmStakingToken = await invoiceFarm.stakingToken();
  const farmRewardToken = await invoiceFarm.rewardToken();
  console.log(` - InvoiceFarm Staking Token (vINV): ${farmStakingToken} ${farmStakingToken === invoiceVaultAddress ? "✅" : "❌"}`);
  console.log(` - InvoiceFarm Reward Token (INVX):  ${farmRewardToken} ${farmRewardToken === invxAddress ? "✅" : "❌"}`);

  // Check 3: Authorized Lockers
  const isRouterLocker = await reserveStaking.isAuthorizedLocker(feeRouterAddress);
  const isGateLocker = await reserveStaking.isAuthorizedLocker(tierGateAddress);
  console.log(` - FeeRouter Authorized in Staking:  ${isRouterLocker ? "✅ Yes" : "❌ No"}`);
  console.log(` - TierGate Authorized in Staking:   ${isGateLocker ? "✅ Yes" : "❌ No"}`);

  // Check 4: FeeRouter splits sum to 100%
  const vBps = Number(await feeRouter.vaultShareBps());
  const sBps = Number(await feeRouter.stakingShareBps());
  const iBps = Number(await feeRouter.insuranceShareBps());
  const totalBps = vBps + sBps + iBps;
  console.log(` - FeeRouter Splits: ${vBps / 100}% Vault / ${sBps / 100}% Staking / ${iBps / 100}% Insurance = ${totalBps / 100}% ${totalBps === 10000 ? "✅" : "❌"}`);

  // Check 5: Farm reward rate > 0
  const rewardRate = await invoiceFarm.rewardRate();
  console.log(` - Farm Reward Rate: ${ethers.formatUnits(rewardRate, 18)} INVX/sec ${rewardRate > 0n ? "✅" : "❌"}`);

  // ─────────────────────────────────────────────────────────────
  // FRONTEND CONFIGURATION & ARTIFACT SYNCHRONIZATION
  // ─────────────────────────────────────────────────────────────
  console.log("\n====================================================");
  console.log("       SYNCHRONIZING FRONTEND CONFIGS & ABIS        ");
  console.log("====================================================");

  const rootDir = process.cwd();
  const configDir = path.join(rootDir, "warranty-tracker", "src", "config");

  const exportAbi = (artifactPath, destFileName) => {
    const fullArtifactPath = path.join(rootDir, artifactPath);
    if (fs.existsSync(fullArtifactPath)) {
      const artifact = JSON.parse(fs.readFileSync(fullArtifactPath, "utf8"));
      fs.writeFileSync(
        path.join(configDir, destFileName),
        JSON.stringify(artifact.abi, null, 2)
      );
      console.log(`   📁 Updated ABI: ${destFileName}`);
    }
  };

  exportAbi("artifacts/contracts/InvoiceVault.sol/InvoiceVault.json", "invoiceVaultAbi.json");
  exportAbi("artifacts/contracts/INVX.sol/INVX.json", "invxAbi.json");
  exportAbi("artifacts/contracts/InvoiceFarm.sol/InvoiceFarm.json", "invoiceFarmAbi.json");
  exportAbi("artifacts/contracts/ReserveStaking.sol/ReserveStaking.json", "reserveStakingAbi.json");
  exportAbi("artifacts/contracts/FeeRouter.sol/FeeRouter.json", "feeRouterAbi.json");
  exportAbi("artifacts/contracts/TierGate.sol/TierGate.json", "tierGateAbi.json");

  // Update warranty-tracker/src/config/contractConfig.js
  const contractConfigPath = path.join(configDir, "contractConfig.js");
  const contractConfigContent = `// ============================================================
// Contract Configuration (Auto-generated by deploy script)
// ============================================================

export const CONTRACT_ADDRESS = "0xF691696E9BbfE3F1Da577BB153480269772BD3f9";
export { default as CONTRACT_ABI } from "./contractAbi.json";

// Deployed MockUSDC Contract on Sepolia Testnet
export const MOCK_USDC_ADDRESS = "${EXISTING_MOCK_USDC}";
export { default as MOCK_USDC_ABI } from "./mockUsdcAbi.json";

// Deployed InvoiceVault (ERC-4626) Contract with Accounting Fix
export const INVOICE_VAULT_ADDRESS = "${invoiceVaultAddress}";
export { default as INVOICE_VAULT_ABI } from "./invoiceVaultAbi.json";
`;
  fs.writeFileSync(contractConfigPath, contractConfigContent);
  console.log("   📝 Updated warranty-tracker/src/config/contractConfig.js");

  // Update warranty-tracker/src/config/farmConfig.js
  const farmConfigPath = path.join(configDir, "farmConfig.js");
  const farmConfigContent = `import invxAbi from "./invxAbi.json";
import invoiceFarmAbi from "./invoiceFarmAbi.json";
import reserveStakingAbi from "./reserveStakingAbi.json";
import feeRouterAbi from "./feeRouterAbi.json";
import tierGateAbi from "./tierGateAbi.json";

// ============================================================
// DeFi Experiment 5 Configuration (Auto-generated by deploy script)
// ============================================================

export const INVX_ADDRESS = "${invxAddress}";
export const INVOICE_FARM_ADDRESS = "${invoiceFarmAddress}";
export const RESERVE_STAKING_ADDRESS = "${reserveStakingAddress}";
export const FEE_ROUTER_ADDRESS = "${feeRouterAddress}";
export const TIER_GATE_ADDRESS = "${tierGateAddress}";

// ABIs
export const INVX_ABI = invxAbi;
export const INVOICE_FARM_ABI = invoiceFarmAbi;
export const RESERVE_STAKING_ABI = reserveStakingAbi;
export const FEE_ROUTER_ABI = feeRouterAbi;
export const TIER_GATE_ABI = tierGateAbi;
`;
  fs.writeFileSync(farmConfigPath, farmConfigContent);
  console.log("   📝 Updated warranty-tracker/src/config/farmConfig.js");

  // Save deployments/sepolia.json
  const deploymentsDir = path.join(rootDir, "deployments");
  if (!fs.existsSync(deploymentsDir)) {
    fs.mkdirSync(deploymentsDir, { recursive: true });
  }
  const deploymentFilePath = path.join(deploymentsDir, `${network.name === "hardhat" ? "localhost" : "sepolia"}.json`);
  fs.writeFileSync(deploymentFilePath, JSON.stringify(deploymentData, null, 2));
  console.log(`   💾 Deployment receipt saved to: ${deploymentFilePath}`);

  // ─────────────────────────────────────────────────────────────
  // ETHERSCAN VERIFICATION
  // ─────────────────────────────────────────────────────────────
  const etherscanKey = process.env.ETHERSCAN_API_KEY ? process.env.ETHERSCAN_API_KEY.trim() : "";
  if (etherscanKey && Number(network.chainId) === 11155111) {
    console.log("\n====================================================");
    console.log("       STARTING ETHERSCAN SOURCE CODE VERIFICATION   ");
    console.log("====================================================");
    console.log("⏳ Waiting 10 seconds for Etherscan block indexer...");
    await new Promise((r) => setTimeout(r, 10000));

    const verifyContract = async (name, addr, args = []) => {
      console.log(`🔍 Verifying ${name} at ${addr}...`);
      try {
        await hre.run("verify:verify", {
          address: addr,
          constructorArguments: args,
        });
        console.log(`   ✅ Verified ${name}!`);
      } catch (err) {
        if (err.message.includes("Already Verified")) {
          console.log(`   ✅ ${name} already verified.`);
        } else {
          console.warn(`   ⚠️ Verification notice for ${name}: ${err.message}`);
        }
      }
    };

    await verifyContract("InvoiceVault", invoiceVaultAddress, [EXISTING_MOCK_USDC]);
    await verifyContract("INVX", invxAddress, []);
    await verifyContract("ReserveStaking", reserveStakingAddress, [invxAddress, EXISTING_MOCK_USDC]);
    await verifyContract("InvoiceFarm", invoiceFarmAddress, [invoiceVaultAddress, invxAddress]);
    await verifyContract("FeeRouter", feeRouterAddress, [EXISTING_MOCK_USDC, invoiceVaultAddress, reserveStakingAddress, deployer.address]);
    await verifyContract("TierGate", tierGateAddress, [EXISTING_INVOICE_NFT, reserveStakingAddress]);
  } else {
    console.log("\nℹ️  Etherscan verification skipped (no ETHERSCAN_API_KEY provided or local network).");
  }

  console.log("\n====================================================");
  console.log("🎉 DEPLOYMENT SUMMARY & SEPOLIA EXPLORER LINKS");
  console.log("====================================================");
  console.log("| Contract Name  | Address                                    | Explorer Link |");
  console.log("|----------------|--------------------------------------------|---------------|");
  console.log(`| InvoiceVault   | ${invoiceVaultAddress} | ${getAddressLink(invoiceVaultAddress)} |`);
  console.log(`| INVX           | ${invxAddress} | ${getAddressLink(invxAddress)} |`);
  console.log(`| ReserveStaking | ${reserveStakingAddress} | ${getAddressLink(reserveStakingAddress)} |`);
  console.log(`| InvoiceFarm    | ${invoiceFarmAddress} | ${getAddressLink(invoiceFarmAddress)} |`);
  console.log(`| FeeRouter      | ${feeRouterAddress} | ${getAddressLink(feeRouterAddress)} |`);
  console.log(`| TierGate       | ${tierGateAddress} | ${getAddressLink(tierGateAddress)} |`);
  console.log("====================================================\n");
}

main().catch((err) => {
  console.error("\n❌ SCRIPT FAILED:", err);
  process.exit(1);
});
