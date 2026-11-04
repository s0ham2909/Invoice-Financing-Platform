// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title INVX
 * @notice Protocol utility & governance token for the Invoice Financing Platform.
 * @dev Reusable MockERC20 pattern per Experiment 5 specifications.
 *      Minting is restricted to owner (with an optional test faucet for testnet experimentation).
 */
contract INVX is ERC20, Ownable {

    constructor() ERC20("InvoiceX Protocol Token", "INVX") Ownable(msg.sender) {
        // Mint initial supply of 10,000,000 INVX to deployer
        _mint(msg.sender, 10_000_000 * 10**18);
    }

    /**
     * @notice Mint tokens to target address, restricted to contract owner.
     * @param to Recipient address
     * @param amount Token amount in wei
     */
    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }

    /**
     * @notice Testnet faucet allowing test accounts to claim a fixed batch of INVX for demo purposes.
     * @param to Target address
     */
    function faucet(address to, uint256 amount) external {
        require(amount <= 10_000 * 10**18, "Exceeds faucet max limit");
        _mint(to, amount);
    }
}
