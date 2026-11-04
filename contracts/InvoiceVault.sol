// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title InvoiceVault
 * @notice ERC-4626 Tokenized Vault for Invoice Financing & Credit Guarantee Liquidity.
 * @dev Investors deposit underlying tokens (e.g. USDC/mUSDC) into this Vault and receive yield-bearing `vINV` share tokens.
 *      Pooled liquidity is allocated to finance listed Invoice NFTs, and repayments generate automated yield for all vault share holders.
 *
 * PREREQUISITE FIX:
 *  `totalAssets()` accounts for both idle cash (token balance) AND outstanding receivables from allocated invoices.
 *  This prevents the share price from dropping when liquidity is disbursed to suppliers.
 */
contract InvoiceVault is ERC4626, Ownable {
    using SafeERC20 for IERC20;

    // ──────────────────────────────────────────────
    //  State Variables
    // ──────────────────────────────────────────────

    /// @notice Total principal currently disbursed to suppliers and awaiting repayment
    uint256 public outstandingReceivables;

    // ──────────────────────────────────────────────
    //  Custom Errors & Events
    // ──────────────────────────────────────────────
    error InsufficientVaultLiquidity();
    error ZeroAmount();

    event LiquidityAllocated(address indexed invoiceBorrower, uint256 amount);
    event RepaymentReceived(address indexed borrower, uint256 amount, uint256 interestAccrued);

    // ──────────────────────────────────────────────
    //  Constructor
    // ──────────────────────────────────────────────

    /**
     * @notice Initializes ERC-4626 Vault with an underlying ERC-20 asset token.
     * @param asset_ Address of the underlying ERC-20 token (e.g. MockUSDC)
     */
    constructor(IERC20 asset_)
        ERC20("Invoice Vault Share Token", "vINV")
        ERC4626(asset_)
        Ownable(msg.sender)
    {}

    // ──────────────────────────────────────────────
    //  ERC-4626 Overrides
    // ──────────────────────────────────────────────

    /**
     * @notice Returns total assets managed by the vault: idle cash + outstanding receivables.
     * @dev Overridden so allocating funds to an invoice does not reduce the vINV share exchange rate.
     */
    function totalAssets() public view virtual override returns (uint256) {
        return IERC20(asset()).balanceOf(address(this)) + outstandingReceivables;
    }

    // ──────────────────────────────────────────────
    //  Vault Management Functions
    // ──────────────────────────────────────────────

    /**
     * @notice Allocates liquidity from the Vault pool to finance an Invoice NFT.
     * @dev Only contract owner / financing manager can call this.
     * @param borrower Target supplier address receiving the invoice financing funds
     * @param amount   Amount of underlying ERC-20 assets to disburse
     */
    function allocateToInvoice(address borrower, uint256 amount) external onlyOwner {
        if (amount == 0) revert ZeroAmount();

        uint256 idleBalance = IERC20(asset()).balanceOf(address(this));
        if (amount > idleBalance) revert InsufficientVaultLiquidity();

        outstandingReceivables += amount;

        IERC20(asset()).safeTransfer(borrower, amount);
        emit LiquidityAllocated(borrower, amount);
    }

    /**
     * @notice Receives invoice repayments (principal + interest) back into the Vault pool.
     * @dev Decreases `outstandingReceivables` and increases idle balance.
     *      Any interest in excess of principal increases `totalAssets()`, boosting the vINV share price!
     * @param amount Total amount of underlying tokens returned (Principal + Interest)
     */
    function receiveRepayment(uint256 amount) external {
        if (amount == 0) revert ZeroAmount();

        uint256 interest = 0;
        if (amount <= outstandingReceivables) {
            outstandingReceivables -= amount;
        } else {
            interest = amount - outstandingReceivables;
            outstandingReceivables = 0;
        }

        IERC20(asset()).safeTransferFrom(msg.sender, address(this), amount);
        emit RepaymentReceived(msg.sender, amount, interest);
    }
}
