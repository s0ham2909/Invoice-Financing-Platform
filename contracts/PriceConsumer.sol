// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AggregatorV3Interface} from "@chainlink/contracts/src/v0.8/shared/interfaces/AggregatorV3Interface.sol";

/**
 * @title PriceConsumer
 * @notice Basic price consumer referencing Experiment 7 specification (Step 2).
 *         Used for reference and educational comparison.
 */
contract PriceConsumer {
    AggregatorV3Interface internal feed;

    constructor(address feedAddress) {
        feed = AggregatorV3Interface(feedAddress);
    }

    function latestPrice() public view returns (int256) {
        (, int256 answer, , , ) = feed.latestRoundData();
        return answer;
    }
}
