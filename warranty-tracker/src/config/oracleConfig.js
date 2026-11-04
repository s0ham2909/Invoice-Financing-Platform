import platformPriceOracleAbi from "./platformPriceOracleAbi.json";

// ============================================================
// DeFi Experiment 7: Chainlink Price Feed & Oracle Configuration
// ============================================================

// PlatformPriceOracle contract address (updated on deployment)
export const PLATFORM_PRICE_ORACLE_ADDRESS = "0x0000000000000000000000000000000000000000";

// Fallback Chainlink Aggregator addresses on Sepolia (used for direct fallback reads before or alongside oracle)
export const CHAINLINK_SEPOLIA_FEEDS = {
  "ETH/USD": {
    address: "0x694AA1769357215DE4FAC081bf1f309aDC325306",
    decimals: 8,
    heartbeat: 3600, // 1 hour
    maxAge: 4500,    // 3600 * 1.25
    name: "Ethereum / US Dollar"
  },
  "BTC/USD": {
    address: "0x1b44F3514812d835EB1BDB0acB33d3fA3351Ee43",
    decimals: 8,
    heartbeat: 3600, // 1 hour
    maxAge: 4500,    // 3600 * 1.25
    name: "Bitcoin / US Dollar"
  },
  "USDC/USD": {
    address: "0xA2F78ab2355fe2f984D808B5CeE7FD0A93D5270E",
    decimals: 8,
    heartbeat: 86400, // 24 hours
    maxAge: 108000,   // 86400 * 1.25
    name: "USD Coin / US Dollar"
  }
};

// Chainlink Aggregator Minimal ABI for direct fallback
export const AGGREGATOR_V3_ABI = [
  "function decimals() external view returns (uint8)",
  "function description() external view returns (string)",
  "function latestRoundData() external view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)"
];

// Oracle Contract ABI
export const PLATFORM_PRICE_ORACLE_ABI = platformPriceOracleAbi;
