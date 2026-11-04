import { BrowserProvider, Contract } from "ethers";
import { CONTRACT_ADDRESS, CONTRACT_ABI } from "../config/contractConfig";

// Sepolia chain ID in hex
const SEPOLIA_CHAIN_ID = "0xaa36a7";

/**
 * Connect to MetaMask wallet and switch to Sepolia network.
 * Returns the connected account address.
 */
export async function connectWallet() {
  if (!window.ethereum) {
    throw new Error("MetaMask is not installed. Please install MetaMask to continue.");
  }

  // Request account access
  const accounts = await window.ethereum.request({
    method: "eth_requestAccounts",
  });

  // Switch to Sepolia
  try {
    await window.ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: SEPOLIA_CHAIN_ID }],
    });
  } catch (switchError) {
    // If Sepolia is not added to MetaMask, add it
    if (switchError.code === 4902) {
      await window.ethereum.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: SEPOLIA_CHAIN_ID,
            chainName: "Sepolia Testnet",
            nativeCurrency: { name: "SepoliaETH", symbol: "ETH", decimals: 18 },
            rpcUrls: ["https://rpc.sepolia.org"],
            blockExplorerUrls: ["https://sepolia.etherscan.io"],
          },
        ],
      });
    } else {
      throw switchError;
    }
  }

  return accounts[0];
}

/**
 * Returns an ethers BrowserProvider connected to MetaMask.
 */
export function getProvider() {
  if (!window.ethereum) {
    throw new Error("MetaMask is not installed.");
  }
  return new BrowserProvider(window.ethereum);
}

/**
 * Returns an ethers Contract instance connected to the signer (for write ops)
 * or to the provider (for read-only ops).
 */
export async function getContract(signerOrProvider) {
  return new Contract(CONTRACT_ADDRESS, CONTRACT_ABI, signerOrProvider);
}
