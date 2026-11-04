// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title MockERC20
 * @notice Standard ERC-20 test token for DeFi Experiment 4 (AMM Liquidity Pool).
 * @dev Deployed twice to represent Token A (TKA) and Token B (TKB).
 */
contract MockERC20 is ERC20 {
    /**
     * @notice Initializes token with custom name and symbol.
     * @param name Name of the token (e.g. "Token A")
     * @param symbol Symbol of the token (e.g. "TKA")
     */
    constructor(string memory name, string memory symbol) ERC20(name, symbol) {
        // Mint initial 100,000 tokens (18 decimals) to deployer
        _mint(msg.sender, 100_000 * 10**decimals());
    }

    /**
     * @notice Allows test accounts to mint tokens for testing liquidity and swaps.
     * @param to Recipient address
     * @param amount Token amount to mint (in wei / 18 decimals)
     */
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
