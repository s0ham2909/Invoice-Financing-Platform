import "@nomicfoundation/hardhat-toolbox";
import dotenv from "dotenv";
import { subtask } from "hardhat/config.js";
import { TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD } from "hardhat/builtin-tasks/task-names.js";
import { createRequire } from "node:module";

// Use the pinned npm compiler, including when the compiler download service is unavailable.
const require = createRequire(import.meta.url);
subtask(TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD).setAction(async ({ solcVersion }, _hre, runSuper) => {
  if (solcVersion !== "0.8.26") return runSuper();
  return { compilerPath: require.resolve("solc/soljson.js"), isSolcJs: true,
    version: solcVersion, longVersion: require("solc").version() };
});

dotenv.config();

// Helper to sanitize and normalize private key
function getAccounts() {
  const rawKey = process.env.PRIVATE_KEY ? process.env.PRIVATE_KEY.trim() : "";
  if (!rawKey) return [];
  const normalized = rawKey.startsWith("0x") ? rawKey : `0x${rawKey}`;
  // 32-byte hex = 64 characters + "0x" = 66
  if (/^0x[0-9a-fA-F]{64}$/.test(normalized)) {
    return [normalized];
  }
  return [];
}

const accounts = getAccounts();
const sepoliaRpcUrl =
  process.env.SEPOLIA_RPC_URL && process.env.SEPOLIA_RPC_URL.trim()
    ? process.env.SEPOLIA_RPC_URL.trim()
    : "https://ethereum-sepolia-rpc.publicnode.com";

/** @type import('hardhat/config').HardhatUserConfig */
const config = {
  solidity: {
    version: "0.8.26",
    settings: {
      evmVersion: "cancun",
      optimizer: {
        enabled: true,
        runs: 200,
      },
      viaIR: true,
    },
  },
  networks: {
    hardhat: {
      chainId: 31337,
      mining: { auto: true, interval: process.env.LOCAL_DEMO_MINING === "true" ? 1000 : 0 },
    },
    localhost: { url: "http://127.0.0.1:8545", chainId: 31337 },
    sepolia: {
      url: sepoliaRpcUrl,
      chainId: 11155111,
      accounts: accounts,
    },
  },
  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts",
  },
};

// Add Etherscan verification config only if API key is provided
if (process.env.ETHERSCAN_API_KEY && process.env.ETHERSCAN_API_KEY.trim().length > 0) {
  config.etherscan = {
    apiKey: process.env.ETHERSCAN_API_KEY.trim(),
  };
}

export default config;
