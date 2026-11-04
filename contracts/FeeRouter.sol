// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IInvoiceVault {
    function receiveRepayment(uint256 amount) external;
}

interface IReserveStaking {
    function notifyRewardAmount(uint256 amount, uint256 duration) external;
}

/**
 * @title FeeRouter
 * @notice Distributes invoice interest repayments and warranty fees across platform stakeholders.
 * @dev Splits incoming mUSDC interest/fees according to configurable percentage splits:
 *      - 70% to InvoiceVault (via receiveRepayment, directly boosting vINV share price)
 *      - 20% to ReserveStaking (rewarding INVX stakers with real stablecoin yield)
 *      - 10% to Insurance / Warranty Reserve pool
 *
 * Configurable by contract owner; percentages must strictly sum to 100%.
 */
contract FeeRouter is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ──────────────────────────────────────────────
    //  State Variables
    // ──────────────────────────────────────────────

    /// @notice Underlying asset token (mUSDC)
    IERC20 public immutable paymentToken;

    /// @notice InvoiceVault reference
    IInvoiceVault public invoiceVault;

    /// @notice ReserveStaking reference
    IReserveStaking public reserveStaking;

    /// @notice Insurance/Warranty reserve recipient address
    address public insuranceReserve;

    /// @notice Percentage shares in basis points (100% = 10,000 bps)
    uint256 public vaultShareBps     = 7000; // 70%
    uint256 public stakingShareBps   = 2000; // 20%
    uint256 public insuranceShareBps = 1000; // 10%

    /// @notice Duration over which ReserveStaking distributes each reward notification
    uint256 public rewardDistributionDuration = 7 days;

    // ──────────────────────────────────────────────
    //  Events
    // ──────────────────────────────────────────────
    event RepaymentRouted(
        uint256 totalAmount,
        uint256 principalToVault,
        uint256 vaultInterestShare,
        uint256 stakingInterestShare,
        uint256 insuranceShare
    );
    event FeeRouted(
        uint256 feeAmount,
        uint256 vaultShare,
        uint256 stakingShare,
        uint256 insuranceShare
    );
    event SplitsUpdated(uint256 vaultShareBps, uint256 stakingShareBps, uint256 insuranceShareBps);

    // ──────────────────────────────────────────────
    //  Constructor
    // ──────────────────────────────────────────────
    constructor(
        address _paymentToken,
        address _invoiceVault,
        address _reserveStaking,
        address _insuranceReserve
    ) Ownable(msg.sender) {
        require(_paymentToken != address(0), "Invalid payment token");
        require(_insuranceReserve != address(0), "Invalid insurance reserve");

        paymentToken = IERC20(_paymentToken);
        invoiceVault = IInvoiceVault(_invoiceVault);
        reserveStaking = IReserveStaking(_reserveStaking);
        insuranceReserve = _insuranceReserve;
    }

    // ──────────────────────────────────────────────
    //  Routing Functions
    // ──────────────────────────────────────────────

    /**
     * @notice Routes a full repayment (principal + interest) from a supplier.
     * @param principal Principal portion returning to the vault
     * @param interest  Interest portion to be split across stakeholders
     */
    function routeRepayment(uint256 principal, uint256 interest) external nonReentrant {
        uint256 total = principal + interest;
        require(total > 0, "Zero repayment amount");

        // Pull total repayment tokens from caller
        paymentToken.safeTransferFrom(msg.sender, address(this), total);

        // Calculate interest split
        uint256 vaultInterest = (interest * vaultShareBps) / 10000;
        uint256 stakingInterest = (interest * stakingShareBps) / 10000;
        uint256 insuranceInterest = interest - vaultInterest - stakingInterest;

        // 1. Send principal + vault's interest share to InvoiceVault
        uint256 totalVaultAllocation = principal + vaultInterest;
        if (totalVaultAllocation > 0 && address(invoiceVault) != address(0)) {
            paymentToken.forceApprove(address(invoiceVault), totalVaultAllocation);
            invoiceVault.receiveRepayment(totalVaultAllocation);
        }

        // 2. Notify ReserveStaking of real yield for INVX stakers
        if (stakingInterest > 0 && address(reserveStaking) != address(0)) {
            paymentToken.forceApprove(address(reserveStaking), stakingInterest);
            reserveStaking.notifyRewardAmount(stakingInterest, rewardDistributionDuration);
        }

        // 3. Send insurance share
        if (insuranceInterest > 0) {
            paymentToken.safeTransfer(insuranceReserve, insuranceInterest);
        }

        emit RepaymentRouted(total, principal, vaultInterest, stakingInterest, insuranceInterest);
    }

    /**
     * @notice Routes an isolated fee or warranty premium across platform splits.
     * @param feeAmount Total fee in mUSDC
     */
    function routeFee(uint256 feeAmount) external nonReentrant {
        require(feeAmount > 0, "Zero fee amount");

        paymentToken.safeTransferFrom(msg.sender, address(this), feeAmount);

        uint256 vaultShare = (feeAmount * vaultShareBps) / 10000;
        uint256 stakingShare = (feeAmount * stakingShareBps) / 10000;
        uint256 insuranceShare = feeAmount - vaultShare - stakingShare;

        if (vaultShare > 0 && address(invoiceVault) != address(0)) {
            paymentToken.forceApprove(address(invoiceVault), vaultShare);
            invoiceVault.receiveRepayment(vaultShare);
        }

        if (stakingShare > 0 && address(reserveStaking) != address(0)) {
            paymentToken.forceApprove(address(reserveStaking), stakingShare);
            reserveStaking.notifyRewardAmount(stakingShare, rewardDistributionDuration);
        }

        if (insuranceShare > 0) {
            paymentToken.safeTransfer(insuranceReserve, insuranceShare);
        }

        emit FeeRouted(feeAmount, vaultShare, stakingShare, insuranceShare);
    }

    // ──────────────────────────────────────────────
    //  Admin Configuration
    // ──────────────────────────────────────────────

    /**
     * @notice Configures split percentages. Must sum to 10,000 (100%).
     */
    function setSplits(
        uint256 _vaultShareBps,
        uint256 _stakingShareBps,
        uint256 _insuranceShareBps
    ) external onlyOwner {
        require(
            _vaultShareBps + _stakingShareBps + _insuranceShareBps == 10000,
            "Splits must sum to 10,000 (100%)"
        );
        vaultShareBps = _vaultShareBps;
        stakingShareBps = _stakingShareBps;
        insuranceShareBps = _insuranceShareBps;
        emit SplitsUpdated(_vaultShareBps, _stakingShareBps, _insuranceShareBps);
    }

    function setInvoiceVault(address _invoiceVault) external onlyOwner {
        invoiceVault = IInvoiceVault(_invoiceVault);
    }

    function setReserveStaking(address _reserveStaking) external onlyOwner {
        reserveStaking = IReserveStaking(_reserveStaking);
    }

    function setInsuranceReserve(address _insuranceReserve) external onlyOwner {
        require(_insuranceReserve != address(0), "Invalid address");
        insuranceReserve = _insuranceReserve;
    }

    function setRewardDistributionDuration(uint256 _duration) external onlyOwner {
        require(_duration > 0, "Duration > 0");
        rewardDistributionDuration = _duration;
    }
}
