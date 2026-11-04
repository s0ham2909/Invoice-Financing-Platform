// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IInvoiceNFTCore {
    struct Invoice {
        string invoiceNumber;
        address borrower;
        uint96 amount;
        address investor;
        uint64 dueDate;
        bool isFinanced;
    }
    function getInvoice(uint256 tokenId) external view returns (Invoice memory);
    function financeInvoice(uint256 tokenId) external payable;
}

interface IReserveStakingHook {
    function feeDiscountBps(address supplier) external view returns (uint256);
    function financingLimit(address supplier) external view returns (uint256);
    function getSupplierTier(address supplier) external view returns (uint8);
    function silverThreshold() external view returns (uint256);
    function goldThreshold() external view returns (uint256);
    function lockSupplierStake(address supplier, uint256 minStakeRequired) external;
    function unlockSupplierStake(address supplier) external;
}

/**
 * @title TierGate
 * @notice Thin on-chain adapter that enforces Supplier Tiers and Unstake Locks without altering existing ETH modules.
 * @dev Wraps InvoiceNFT and connects to ReserveStaking:
 *      1. Enforces supplier financing limits on-chain.
 *      2. Applies supplier fee discounts on-chain (refunding any discount surplus to investor or reducing net cost).
 *      3. Calls `lockSupplierStake` upon financing, preventing the supplier from unstaking below their tier threshold.
 *      4. Calls `unlockSupplierStake` when the invoice is marked/settled as repaid.
 *      5. Optional: If `reserveStaking` is address(0), the hook is disabled and standard pass-through behavior occurs.
 */
contract TierGate is Ownable, ReentrancyGuard {

    // ──────────────────────────────────────────────
    //  State Variables
    // ──────────────────────────────────────────────

    /// @notice Target InvoiceNFT contract
    IInvoiceNFTCore public immutable invoiceNFT;

    /// @notice Optional ReserveStaking hook address (address(0) = disabled)
    IReserveStakingHook public reserveStaking;

    /// @notice Base platform fee in basis points (e.g. 300 bps = 3%)
    uint256 public basePlatformFeeBps = 300;

    /// @notice ETH to USD price in 6-decimal units (e.g. 2,500 * 1e6 = $2,500 / ETH)
    uint256 public ethUsdPrice = 2500 * 10**6;

    /// @notice Tracks active financed status inside TierGate for repayment unlocking: tokenId => borrower
    mapping(uint256 => address) public lockedInvoices;

    // ──────────────────────────────────────────────
    //  Events
    // ──────────────────────────────────────────────
    event TierGateFinanced(
        uint256 indexed tokenId,
        address indexed supplier,
        address indexed investor,
        uint256 requestedAmount,
        uint256 feeDiscountBps,
        uint256 netFeePaid
    );
    event TierGateRepaid(uint256 indexed tokenId, address indexed supplier);
    event ReserveStakingHookUpdated(address indexed newHook);
    event BasePlatformFeeUpdated(uint256 newFeeBps);

    // ──────────────────────────────────────────────
    //  Custom Errors
    // ──────────────────────────────────────────────
    error ExceedsTierFinancingLimit(uint256 requestedAmount, uint256 maxLimit);
    error InsufficientFinancingPayment();
    error InvoiceAlreadyLocked();
    error NotFinancedThroughTierGate();
    error TransferFailed();

    // ──────────────────────────────────────────────
    //  Constructor
    // ──────────────────────────────────────────────
    constructor(address _invoiceNFT, address _reserveStaking) Ownable(msg.sender) {
        require(_invoiceNFT != address(0), "Invalid InvoiceNFT");
        invoiceNFT = IInvoiceNFTCore(_invoiceNFT);
        reserveStaking = IReserveStakingHook(_reserveStaking);
    }

    // ──────────────────────────────────────────────
    //  On-Chain Tier & Lock Enforcement
    // ──────────────────────────────────────────────

    /**
     * @notice Finances an invoice through TierGate, enforcing financing limits, fee discounts, and unstake locking.
     * @param tokenId The ID of the invoice NFT to finance
     */
    function financeWithTier(uint256 tokenId) external payable nonReentrant {
        IInvoiceNFTCore.Invoice memory inv = invoiceNFT.getInvoice(tokenId);
        uint256 principal = uint256(inv.amount);
        address supplier = inv.borrower;

        uint256 discountBps = 0;
        uint256 fee = 0;

        // If ReserveStaking hook is configured (non-zero address)
        if (address(reserveStaking) != address(0)) {
            // A. Check Supplier Financing Limit
            // ReserveStaking limits are in 6-decimal units (mUSDC standard, e.g. 50,000 * 1e6 = $50,000).
            // Converting principal (in 18-decimal ETH wei) to USD at ethUsdPrice (e.g. 2,500 USD/ETH):
            // principalUsd6 = (principal * ethUsdPrice) / 1e18;
            uint256 principalUsd6 = (principal * ethUsdPrice) / 1e18;
            uint256 limit = reserveStaking.financingLimit(supplier);
            if (principalUsd6 > limit) {
                revert ExceedsTierFinancingLimit(principalUsd6, limit);
            }

            // B. Calculate Fee Discount
            discountBps = reserveStaking.feeDiscountBps(supplier);

            // C. Lock Supplier Stake according to their Tier threshold
            uint8 tier = reserveStaking.getSupplierTier(supplier);
            uint256 minLock = 0;
            if (tier == 2) {
                minLock = reserveStaking.goldThreshold();
            } else if (tier == 1) {
                minLock = reserveStaking.silverThreshold();
            }
            if (minLock > 0) {
                reserveStaking.lockSupplierStake(supplier, minLock);
            }
            lockedInvoices[tokenId] = supplier;
        }

        // Base fee minus discount
        uint256 effectiveFeeBps = basePlatformFeeBps > discountBps ? basePlatformFeeBps - discountBps : 0;
        fee = (principal * effectiveFeeBps) / 10000;

        uint256 totalRequired = principal + fee;
        if (msg.value < totalRequired) {
            revert InsufficientFinancingPayment();
        }

        // Call the underlying InvoiceNFT.financeInvoice with the exact principal
        invoiceNFT.financeInvoice{value: principal}(tokenId);

        // Refund any excess payment back to the investor
        uint256 excess = msg.value - totalRequired;
        if (excess > 0) {
            (bool refundSuccess, ) = payable(msg.sender).call{value: excess}("");
            if (!refundSuccess) revert TransferFailed();
        }

        emit TierGateFinanced(tokenId, supplier, msg.sender, principal, discountBps, fee);
    }

    /**
     * @notice Settles an invoice repayment and unlocks the supplier's stake in ReserveStaking.
     * @param tokenId The invoice token ID that was repaid
     */
    function settleRepaymentAndUnlock(uint256 tokenId) external nonReentrant {
        address supplier = lockedInvoices[tokenId];
        if (supplier == address(0)) revert NotFinancedThroughTierGate();

        // Ensure caller is the supplier or owner
        require(msg.sender == supplier || msg.sender == owner(), "Unauthorized settlement");

        // Clear local lock record
        delete lockedInvoices[tokenId];

        // Unlock stake in ReserveStaking if hook is active
        if (address(reserveStaking) != address(0)) {
            reserveStaking.unlockSupplierStake(supplier);
        }

        emit TierGateRepaid(tokenId, supplier);
    }

    // ──────────────────────────────────────────────
    //  Admin Configuration
    // ──────────────────────────────────────────────

    function setReserveStakingHook(address _hook) external onlyOwner {
        reserveStaking = IReserveStakingHook(_hook);
        emit ReserveStakingHookUpdated(_hook);
    }

    function setBasePlatformFeeBps(uint256 _feeBps) external onlyOwner {
        require(_feeBps <= 1000, "Fee cannot exceed 10%");
        basePlatformFeeBps = _feeBps;
        emit BasePlatformFeeUpdated(_feeBps);
    }

    function setEthUsdPrice(uint256 _price) external onlyOwner {
        require(_price > 0, "Price > 0");
        ethUsdPrice = _price;
    }

    /// @notice Withdraw accumulated fees
    function withdrawFees(address recipient) external onlyOwner {
        require(recipient != address(0), "Invalid recipient");
        uint256 balance = address(this).balance;
        (bool sent, ) = payable(recipient).call{value: balance}("");
        if (!sent) revert TransferFailed();
    }

    receive() external payable {}
}
