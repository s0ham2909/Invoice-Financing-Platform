// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AggregatorV3Interface} from "@chainlink/contracts/src/v0.8/shared/interfaces/AggregatorV3Interface.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title PlatformPriceOracle
 * @notice Multi-feed Chainlink price oracle consumer for the Invoice Financing Platform.
 *         Generalises Experiment 7's SafePriceConsumer to support multiple feeds with
 *         heartbeat-based maxAge staleness checks, dynamic feed decimal normalisation,
 *         and currency conversions for invoice financing.
 */
contract PlatformPriceOracle is Ownable {

    struct FeedConfig {
        AggregatorV3Interface feed;
        uint256 maxAge; // Allowed staleness in seconds (heartbeat * 1.25)
        uint8 decimals;
        bool exists;
    }

    // Mapping from symbol key (e.g. "ETH/USD", "BTC/USD", "USDC/USD") to FeedConfig
    mapping(string => FeedConfig) public feeds;
    string[] public supportedSymbols;

    event FeedAdded(string indexed symbol, address indexed feedAddress, uint256 maxAge, uint8 decimals);
    event FeedUpdated(string indexed symbol, address indexed feedAddress, uint256 maxAge, uint8 decimals);
    event MaxAgeUpdated(string indexed symbol, uint256 oldMaxAge, uint256 newMaxAge);

    /**
     * @notice Constructor initializes feeds in one atomic step, requiring no subsequent setup transactions.
     * @param symbols Array of symbol strings (e.g. ["ETH/USD", "BTC/USD", "USDC/USD"])
     * @param feedAddresses Array of Chainlink aggregator addresses
     * @param maxAges Array of maximum allowed staleness periods in seconds
     */
    constructor(
        string[] memory symbols,
        address[] memory feedAddresses,
        uint256[] memory maxAges
    ) Ownable(msg.sender) {
        require(
            symbols.length == feedAddresses.length && feedAddresses.length == maxAges.length,
            "Length mismatch"
        );

        for (uint256 i = 0; i < symbols.length; i++) {
            _addOrUpdateFeed(symbols[i], feedAddresses[i], maxAges[i]);
        }
    }

    /**
     * @notice Registers or updates a feed. Owner only.
     */
    function addFeed(string calldata symbol, address feedAddress, uint256 maxAge) external onlyOwner {
        _addOrUpdateFeed(symbol, feedAddress, maxAge);
    }

    /**
     * @notice Updates the maxAge parameter for an existing feed. Owner only.
     */
    function updateMaxAge(string calldata symbol, uint256 newMaxAge) external onlyOwner {
        require(feeds[symbol].exists, "Feed does not exist");
        require(newMaxAge > 0, "Invalid maxAge");
        uint256 oldMaxAge = feeds[symbol].maxAge;
        feeds[symbol].maxAge = newMaxAge;
        emit MaxAgeUpdated(symbol, oldMaxAge, newMaxAge);
    }

    function _addOrUpdateFeed(string memory symbol, address feedAddress, uint256 maxAge) internal {
        require(bytes(symbol).length > 0, "Empty symbol");
        require(feedAddress != address(0), "Zero address feed");
        require(maxAge > 0, "Zero maxAge");

        AggregatorV3Interface feed = AggregatorV3Interface(feedAddress);
        uint8 dec = feed.decimals();

        bool isNew = !feeds[symbol].exists;
        feeds[symbol] = FeedConfig({
            feed: feed,
            maxAge: maxAge,
            decimals: dec,
            exists: true
        });

        if (isNew) {
            supportedSymbols.push(symbol);
            emit FeedAdded(symbol, feedAddress, maxAge, dec);
        } else {
            emit FeedUpdated(symbol, feedAddress, maxAge, dec);
        }
    }

    /**
     * @notice Reads raw price with safety checks from Experiment 7 (answer > 0, updatedAt != 0, freshness).
     * @param symbol Symbol key (e.g. "ETH/USD")
     * @return Raw price in feed's native decimals
     */
    function safePrice(string memory symbol) public view returns (uint256) {
        FeedConfig memory config = feeds[symbol];
        require(config.exists, "Feed does not exist");

        (, int256 answer, , uint256 updatedAt, ) = config.feed.latestRoundData();
        require(answer > 0, "invalid price");
        require(updatedAt != 0 && block.timestamp - updatedAt <= config.maxAge, "stale price");

        return uint256(answer);
    }

    /**
     * @notice Normalises the validated price to 18 decimals, dynamically reading feed.decimals().
     *         Multiplies before dividing to preserve maximum arithmetic precision.
     * @param symbol Symbol key (e.g. "ETH/USD")
     * @return Price scaled to 18 decimals (1e18 = 1.00 USD)
     */
    function safePrice18(string memory symbol) public view returns (uint256) {
        FeedConfig memory config = feeds[symbol];
        uint256 raw = safePrice(symbol);
        uint8 dec = config.decimals;

        if (dec == 18) {
            return raw;
        } else if (dec < 18) {
            return raw * (10 ** (18 - dec));
        } else {
            return raw / (10 ** (dec - 18));
        }
    }

    /**
     * @notice Non-reverting health check for UI circuit breaker.
     * @param symbol Symbol key
     * @return True if feed exists and returns a non-stale, positive price; false otherwise.
     */
    function isHealthy(string memory symbol) public view returns (bool) {
        FeedConfig memory config = feeds[symbol];
        if (!config.exists) return false;

        try config.feed.latestRoundData() returns (
            uint80,
            int256 answer,
            uint256,
            uint256 updatedAt,
            uint80
        ) {
            if (answer <= 0) return false;
            if (updatedAt == 0) return false;
            if (block.timestamp < updatedAt) return false;
            if (block.timestamp - updatedAt > config.maxAge) return false;
            return true;
        } catch {
            return false;
        }
    }

    /**
     * @notice Converts an amount of wei into USD scaled to 18 decimals via ETH/USD feed.
     *         Multiply before divide: (weiAmount * ethPrice18) / 1e18
     * @param weiAmount ETH amount in wei (1e18 = 1 ETH)
     * @return usdAmount18 USD value scaled to 18 decimals (1e18 = $1.00)
     */
    function ethToUsd(uint256 weiAmount) external view returns (uint256 usdAmount18) {
        uint256 ethPrice18 = safePrice18("ETH/USD");
        return (weiAmount * ethPrice18) / 1e18;
    }

    /**
     * @notice Converts a USD amount with 18 decimals into wei via ETH/USD feed.
     *         Multiply before divide: (usdAmount18 * 1e18) / ethPrice18
     * @param usdAmount18 USD value scaled to 18 decimals
     * @return weiAmount Equivalent ETH in wei
     */
    function usdToEth(uint256 usdAmount18) external view returns (uint256 weiAmount) {
        uint256 ethPrice18 = safePrice18("ETH/USD");
        return (usdAmount18 * 1e18) / ethPrice18;
    }

    /**
     * @notice Generic valuation of any token amount using a feed.
     *         Calculates: amount * safePrice() / (10 ** feed.decimals())
     *         Preserves input precision: returns value scaled to amountDecimals.
     * @param symbol Symbol key (e.g. "BTC/USD")
     * @param amount Token amount in token native decimal units
     * @param amountDecimals Decimal precision of token amount
     * @return Value in USD scaled to 18 decimals
     */
    function valueOf(string memory symbol, uint256 amount, uint8 amountDecimals) external view returns (uint256) {
        uint256 price18 = safePrice18(symbol);
        return (amount * price18) / (10 ** amountDecimals);
    }

    /**
     * @notice Returns total number of registered symbols.
     */
    function totalSymbols() external view returns (uint256) {
        return supportedSymbols.length;
    }
}
