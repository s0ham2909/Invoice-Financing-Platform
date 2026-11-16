// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
interface IReserveStaking {
    function slashSupplierStake(address supplier, uint256 amount, address recipient) external;
}
interface IInvoicePolicy {
    struct Invoice { string invoiceNumber; address borrower; uint96 amount; address investor; uint64 dueDate; bool isFinanced; }
    function getInvoice(uint256 id) external view returns (Invoice memory);
    function isRepaid(uint256 id) external view returns (bool);
    function setPlatformFeeBps(uint256 bps) external;
}
interface ITierFee { function setBasePlatformFeeBps(uint256 bps) external; }

/// @title Binding DAO actions for the simplified invoice platform.
/// @notice Fee changes and one collateral penalty per unpaid default. No arbitrary calls or refunds.
/// @dev Ownership is transferred to Governance during deployment.
contract PlatformConfig is Ownable {
    uint256 public platformFeeBps = 50;
    uint256 public constant MIN_FEE_BPS = 10;
    uint256 public constant MAX_FEE_BPS = 1000;
    uint256 public constant MAX_PENALTY_PER_PROPOSAL = 50_000 ether;
    IReserveStaking public immutable reserveStaking;
    IInvoicePolicy public immutable invoiceNFT;
    ITierFee public immutable tierGate;
    address public immutable treasury;
    mapping(uint256 => bool) public invoicePenalized;
    mapping(address => uint256) public totalPenaltiesSlashed;
    event PlatformFeeUpdated(uint256 oldFeeBps, uint256 newFeeBps);
    event SupplierPenalized(uint256 indexed invoiceId, address indexed supplier, uint256 amount, string reason);
    error ParameterOutOfBounds(string param, uint256 value, uint256 min, uint256 max);
    error SlashAmountExceedsCap(uint256 requested, uint256 cap);
    error InvoiceNotFinanced(uint256 invoiceId);
    error InvoiceNotOverdue(uint256 invoiceId, uint64 dueDate, uint256 currentTime);
    error SupplierMismatch(uint256 invoiceId, address expectedBorrower, address penalizedSupplier);
    error InvoiceAlreadyRepaid();
    error InvoiceAlreadyPenalized();
    error MissingDependency();
    error ZeroAddress();
    error ZeroAmount();
    constructor(address initialOwner, address staking, address invoices, address gate, address recipient) Ownable(initialOwner) {
        if (recipient == address(0)) revert ZeroAddress();
        reserveStaking = IReserveStaking(staking);
        invoiceNFT = IInvoicePolicy(invoices);
        tierGate = ITierFee(gate);
        treasury = recipient;
    }
    /// @notice Change the fee in the real financing contract; future financing uses it immediately.
    function setPlatformFeeBps(uint256 bps) external onlyOwner {
        if (bps < MIN_FEE_BPS || bps > MAX_FEE_BPS) revert ParameterOutOfBounds("platformFeeBps", bps, MIN_FEE_BPS, MAX_FEE_BPS);
        emit PlatformFeeUpdated(platformFeeBps, bps);
        platformFeeBps = bps;
        if (address(invoiceNFT) != address(0)) invoiceNFT.setPlatformFeeBps(bps);
        if (address(tierGate) != address(0)) tierGate.setBasePlatformFeeBps(bps);
    }
    /// @notice Slash deposited INVX after checking the actual invoice, including invoice zero.
    /// @dev Rechecks repayment at execution and prevents duplicate punishment. All changes revert on failed transfer.
    function applyDefaultPenalty(uint256 invoiceId, address supplier, uint256 amount, string calldata reason) external onlyOwner {
        if (supplier == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        if (amount > MAX_PENALTY_PER_PROPOSAL) revert SlashAmountExceedsCap(amount, MAX_PENALTY_PER_PROPOSAL);
        if (address(invoiceNFT).code.length == 0 || address(reserveStaking).code.length == 0) revert MissingDependency();
        IInvoicePolicy.Invoice memory inv = invoiceNFT.getInvoice(invoiceId);
        if (!inv.isFinanced) revert InvoiceNotFinanced(invoiceId);
        if (inv.borrower != supplier) revert SupplierMismatch(invoiceId, inv.borrower, supplier);
        if (invoiceNFT.isRepaid(invoiceId)) revert InvoiceAlreadyRepaid();
        if (block.timestamp <= inv.dueDate) revert InvoiceNotOverdue(invoiceId, inv.dueDate, block.timestamp);
        if (invoicePenalized[invoiceId]) revert InvoiceAlreadyPenalized();
        invoicePenalized[invoiceId] = true;
        totalPenaltiesSlashed[supplier] += amount;
        reserveStaking.slashSupplierStake(supplier, amount, treasury);
        emit SupplierPenalized(invoiceId, supplier, amount, reason);
    }
}
