// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title MockUSDC
 * @notice Mock ERC-20 token for testing the ERC-4626 InvoiceVault on Remix & Sepolia testnet.
 */
contract MockUSDC is ERC20, Ownable {

    constructor()
        ERC20("Mock USD Coin", "mUSDC")
        Ownable(msg.sender)
    {
        // Mint initial 1,000,000 mUSDC to deployer (6 decimals standard)
        _mint(msg.sender, 1_000_000 * 10**6);
    }

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    /**
     * @notice Allows anyone to mint test tokens for testing ERC-4626 Vault deposits.
     * @param to Target address receiving test tokens
     * @param amount Amount to mint (in 6 decimal units)
     */
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
