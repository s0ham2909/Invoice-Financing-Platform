// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title MockFeed
 * @notice Mock Chainlink AggregatorV3 feed for local Hardhat and unit testing.
 *         Implements the exact mock structure from Experiment 7 Step 6,
 *         plus roundId and answeredInRound fields to conform to AggregatorV3Interface.
 */
contract MockFeed {
    uint8 public decimals = 8;
    string public description = "Mock Aggregator Feed";
    int256 public answer;
    uint256 public updatedAt;
    uint80 public roundId = 1;

    constructor() {}

    function setDecimals(uint8 _decimals) external {
        decimals = _decimals;
    }

    function set(int256 newAnswer, uint256 newUpdatedAt) external {
        answer = newAnswer;
        updatedAt = newUpdatedAt;
        roundId++;
    }

    function setFresh(int256 newAnswer) external {
        answer = newAnswer;
        updatedAt = block.timestamp;
        roundId++;
    }

    function latestRoundData()
        external
        view
        returns (
            uint80,
            int256,
            uint256,
            uint256,
            uint80
        )
    {
        return (roundId, answer, updatedAt, updatedAt, roundId);
    }
}
