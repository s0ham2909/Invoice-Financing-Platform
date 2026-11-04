import "@nomicfoundation/hardhat-toolbox";
import dotenv from "dotenv";

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
    version: "0.8.24",
    settings: {
      evmVersion: "cancun",
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },
  networks: {
    hardhat: {
      chainId: 31337,
    },
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
