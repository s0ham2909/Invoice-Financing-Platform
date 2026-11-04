// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title InvoiceRepaymentWarrantyNFT
 * @notice DeFi Invoice Financing with Credit Default Warranty & Repayment Guarantee.
 * @dev Investors can finance invoices and opt-in to Repayment Protection Warranty.
 *      If the borrower defaults past the due date, the insured investor can claim 100% repayment from the Insurance Guarantee Pool.
 */
contract InvoiceRepaymentWarrantyNFT is ERC721URIStorage, Ownable {

    // ──────────────────────────────────────────────
    //  Custom Errors (Gas Optimized)
    // ──────────────────────────────────────────────
    error InvalidAmount();
    error TokenDoesNotExist();
    error AlreadyFinanced();
    error AlreadyRepaid();
    error InsufficientETH();
    error CannotFinanceOwnInvoice();
    error TransferFailed();
    error NotDueDateYet();
    error NotInsured();
    error WarrantyAlreadyClaimed();
    error InsufficientInsurancePool();
    error OnlyInvestorCanClaim();

    // ──────────────────────────────────────────────
    //  Data Structures
    // ──────────────────────────────────────────────

    /// @notice Invoice asset with repayment status & credit default warranty protection
    struct InvoiceAsset {
        string invoiceNumber;       // Invoice reference / serial number (Dynamic string)
        address borrower;           // Supplier / Borrower address (20 bytes)
        uint96 amount;              // Principal financing amount requested in wei (12 bytes)
        address investor;           // Investor who financed the invoice (20 bytes)
        uint96 repaymentAmount;     // Total amount borrower must repay (principal + interest) in wei (12 bytes)
        uint96 warrantyPremium;     // Credit protection insurance fee in wei (12 bytes)
        uint64 dueDate;             // Repayment deadline timestamp (8 bytes)
        bool isFinanced;            // Financing status flag (1 byte)
        bool isRepaid;              // Repayment completed flag (1 byte)
        bool hasRepaymentWarranty;  // Investor opted-in to default protection (1 byte)
        bool isWarrantyClaimed;     // Insurance payout claimed status (1 byte)
    }

    // ──────────────────────────────────────────────
    //  State Variables
    // ──────────────────────────────────────────────

    uint256 private _nextTokenId;
    mapping(uint256 => InvoiceAsset) private _invoices;

    /// @notice Pool of accumulated warranty premiums and guarantor funds to pay out default claims
    uint256 public insurancePoolBalance;

    // ──────────────────────────────────────────────
    //  Events
    // ──────────────────────────────────────────────

    event InvoiceListed(
        uint256 indexed tokenId,
        address indexed borrower,
        string invoiceNumber,
        uint256 amount,
        uint256 repaymentAmount,
        uint256 warrantyPremium,
        uint256 dueDate
    );

    event InvoiceFinanced(
        uint256 indexed tokenId,
        address indexed investor,
        address indexed borrower,
        uint256 amountPaid,
        bool insuredWithWarranty
    );

    event InvoiceRepaid(
        uint256 indexed tokenId,
        address indexed borrower,
        address indexed investor,
        uint256 amountRepaid
    );

    event RepaymentWarrantyClaimed(
        uint256 indexed tokenId,
        address indexed investor,
        uint256 payoutAmount
    );

    event InsurancePoolFunded(address indexed funder, uint256 amount);

    // ──────────────────────────────────────────────
    //  Constructor
    // ──────────────────────────────────────────────

    constructor()
        ERC721("InvoiceRepaymentWarrantyNFT", "IRWNFT")
        Ownable(msg.sender)
    {}

    // ──────────────────────────────────────────────
    //  Core Functions
    // ──────────────────────────────────────────────

    /**
     * @notice Funds the insurance reserve pool (used by platform / guarantors).
     */
    function fundInsurancePool() external payable {
        if (msg.value == 0) revert InvalidAmount();
        insurancePoolBalance += msg.value;
        emit InsurancePoolFunded(msg.sender, msg.value);
    }

    /**
     * @notice Lists a new invoice seeking financing.
     * @param borrower         Supplier address
     * @param invoiceNumber    Reference invoice serial string
     * @param amount           Principal financing amount in wei
     * @param repaymentAmount  Total repayment due (principal + interest) in wei
     * @param warrantyPremium  Insurance premium fee for default protection in wei
     * @param dueDateDays      Days until repayment deadline
     * @param uri              IPFS metadata URI
     */
    function listInvoice(
        address borrower,
        string calldata invoiceNumber,
        uint96 amount,
        uint96 repaymentAmount,
        uint96 warrantyPremium,
        uint32 dueDateDays,
        string calldata uri
    ) external returns (uint256 tokenId) {
        if (amount == 0 || repaymentAmount < amount) revert InvalidAmount();

        address supplier = borrower == address(0) ? msg.sender : borrower;
        uint64 due;

        unchecked {
            tokenId = _nextTokenId++;
            due = uint64(block.timestamp + (dueDateDays * 1 days));
        }

        _invoices[tokenId] = InvoiceAsset({
            invoiceNumber: invoiceNumber,
            borrower: supplier,
            amount: amount,
            investor: address(0),
            repaymentAmount: repaymentAmount,
            warrantyPremium: warrantyPremium,
            dueDate: due,
            isFinanced: false,
            isRepaid: false,
            hasRepaymentWarranty: false,
            isWarrantyClaimed: false
        });

        _safeMint(supplier, tokenId);
        _setTokenURI(tokenId, uri);

        emit InvoiceListed(tokenId, supplier, invoiceNumber, amount, repaymentAmount, warrantyPremium, due);
    }

    /**
     * @notice Investor finances an invoice and optionally purchases Repayment Default Warranty.
     * @param tokenId                    ID of the invoice to fund
     * @param optInRepaymentWarranty     Pass `true` to pay `amount + warrantyPremium` for 100% default protection
     */
    function financeInvoice(uint256 tokenId, bool optInRepaymentWarranty) external payable {
        if (tokenId >= _nextTokenId) revert TokenDoesNotExist();

        InvoiceAsset storage invoice = _invoices[tokenId];

        if (invoice.isFinanced) revert AlreadyFinanced();
        if (msg.sender == invoice.borrower) revert CannotFinanceOwnInvoice();

        uint256 totalCost = invoice.amount;
        if (optInRepaymentWarranty) {
            totalCost += invoice.warrantyPremium;
        }

        if (msg.value < totalCost) revert InsufficientETH();

        invoice.isFinanced = true;
        invoice.investor = msg.sender;

        if (optInRepaymentWarranty) {
            invoice.hasRepaymentWarranty = true;
            insurancePoolBalance += invoice.warrantyPremium; // Add premium to insurance reserve pool
        }

        // Transfer principal funding directly to borrower/supplier
        (bool success, ) = payable(invoice.borrower).call{value: invoice.amount}("");
        if (!success) revert TransferFailed();

        emit InvoiceFinanced(tokenId, msg.sender, invoice.borrower, msg.value, optInRepaymentWarranty);
    }

    /**
     * @notice Borrower/supplier repays the invoice (Principal + Interest).
     * @param tokenId ID of the invoice being repaid
     */
    function repayInvoice(uint256 tokenId) external payable {
        if (tokenId >= _nextTokenId) revert TokenDoesNotExist();

        InvoiceAsset storage invoice = _invoices[tokenId];

        require(invoice.isFinanced, "Invoice is not financed yet");
        if (invoice.isRepaid) revert AlreadyRepaid();
        if (msg.value < invoice.repaymentAmount) revert InsufficientETH();

        invoice.isRepaid = true;

        // Payout repayment directly to the investor
        (bool success, ) = payable(invoice.investor).call{value: msg.value}("");
        if (!success) revert TransferFailed();

        emit InvoiceRepaid(tokenId, msg.sender, invoice.investor, msg.value);
    }

    /**
     * @notice Insured Investor claims Default Protection Warranty if borrower defaults past due date.
     * @dev Payouts principal amount directly from the Insurance Guarantee Pool.
     * @param tokenId ID of the defaulted invoice
     */
    function claimRepaymentWarranty(uint256 tokenId) external {
        if (tokenId >= _nextTokenId) revert TokenDoesNotExist();

        InvoiceAsset storage invoice = _invoices[tokenId];

        if (msg.sender != invoice.investor) revert OnlyInvestorCanClaim();
        if (!invoice.hasRepaymentWarranty) revert NotInsured();
        if (invoice.isRepaid) revert AlreadyRepaid();
        if (invoice.isWarrantyClaimed) revert WarrantyAlreadyClaimed();
        if (block.timestamp <= invoice.dueDate) revert NotDueDateYet();

        uint256 payoutAmount = invoice.amount;
        if (insurancePoolBalance < payoutAmount) revert InsufficientInsurancePool();

        invoice.isWarrantyClaimed = true;
        insurancePoolBalance -= payoutAmount;

        // Pay out default guarantee to the insured investor
        (bool success, ) = payable(invoice.investor).call{value: payoutAmount}("");
        if (!success) revert TransferFailed();

        emit RepaymentWarrantyClaimed(tokenId, msg.sender, payoutAmount);
    }

    /**
     * @notice Returns full invoice & default protection details.
     */
    function getInvoiceAsset(uint256 tokenId) external view returns (InvoiceAsset memory) {
        if (tokenId >= _nextTokenId) revert TokenDoesNotExist();
        return _invoices[tokenId];
    }

    /**
     * @notice Returns total number of listed invoices.
     */
    function totalMinted() external view returns (uint256 count) {
        return _nextTokenId;
    }
}
