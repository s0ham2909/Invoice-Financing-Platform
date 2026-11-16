// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import {ERC20Votes} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Votes.sol";
import {Nonces} from "@openzeppelin/contracts/utils/Nonces.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title DTEST - DeFiSpace Governance & Test Token
 * @notice Checkpointed ERC20 token with voting and delegation capabilities (ERC20Votes).
 * @dev Uses block-based checkpoints via `getPastVotes(account, timepoint)` where timepoint = block.number.
 */
contract DTEST is ERC20, ERC20Permit, ERC20Votes, Ownable {
    uint256 public constant FAUCET_LIMIT = 50_000 * 1e18;

    /// @notice Flag to toggle public faucet availability
    bool public faucetEnabled = false;
    bool public mintingSealed;
    error MintingSealed();
    /// @notice Irreversibly freeze supply after demo distribution.
    function sealMinting() external onlyOwner { mintingSealed = true; faucetEnabled = false; }

    event FaucetDrawn(address indexed recipient, uint256 amount);
    event FaucetStatusChanged(bool enabled);

    error FaucetDisabled();
    error FaucetAmountExceeded();

    constructor(
        uint256 initialSupply,
        address initialOwner
    )
        ERC20("DeFiSpace Governance Token", "DTEST")
        ERC20Permit("DeFiSpace Governance Token")
        Ownable(initialOwner)
    {
        if (initialSupply > 0) {
            _mint(initialOwner, initialSupply);
            if (delegates(initialOwner) == address(0)) {
                _delegate(initialOwner, initialOwner);
            }
        }
    }

    /**
     * @notice Toggle the faucet availability (owner only).
     */
    function setFaucetEnabled(bool enabled) external onlyOwner {
        if (mintingSealed && enabled) revert MintingSealed();
        faucetEnabled = enabled;
        emit FaucetStatusChanged(enabled);
    }

    /**
     * @notice Mint new tokens (restricted to contract owner).
     */
    function mint(address to, uint256 amount) external onlyOwner {
        if (mintingSealed) revert MintingSealed();
        _mint(to, amount);
        if (delegates(to) == address(0)) {
            _delegate(to, to);
        }
    }

    /**
     * @notice Public faucet for local demo and test accounts.
     * @param to Recipient address.
     * @param amount Amount in wei (capped at FAUCET_LIMIT per call).
     */
    function faucet(address to, uint256 amount) external {
        if (!faucetEnabled) revert FaucetDisabled();
        if (amount > FAUCET_LIMIT) revert FaucetAmountExceeded();

        _mint(to, amount);
        if (delegates(to) == address(0)) {
            _delegate(to, to);
        }
        emit FaucetDrawn(to, amount);
    }

    // ──────────────────────── Overrides required by Solidity ────────────────────────

    function _update(
        address from,
        address to,
        uint256 value
    ) internal override(ERC20, ERC20Votes) {
        super._update(from, to, value);
    }

    function nonces(
        address owner
    ) public view override(ERC20Permit, Nonces) returns (uint256) {
        return super.nonces(owner);
    }
}
