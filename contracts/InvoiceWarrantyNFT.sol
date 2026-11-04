// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title InvoiceWarrantyNFT
 * @notice Combined Invoice Financing & Optional Warranty Protection Contract.
 * @dev Suppliers mint invoices. When an investor finances an invoice, they can optionally opt-in to activate and receive warranty protection for the underlying asset.
 */
contract InvoiceWarrantyNFT is ERC721URIStorage, Ownable {

    // ──────────────────────────────────────────────
    //  Custom Errors (Gas Optimized)
    // ──────────────────────────────────────────────
    error InvalidAmount();
    error TokenDoesNotExist();
    error AlreadyFinanced();
    error InsufficientETH();
    error CannotFinanceOwnInvoice();
    error TransferFailed();
    error InvalidRecipient();

    // ──────────────────────────────────────────────
    //  Data Structures (Storage Packed)
    // ──────────────────────────────────────────────

    /// @notice Combined Invoice & Optional Warranty record
    struct InvoiceAsset {
        string invoiceNumber;   // Reference invoice / serial number (Dynamic string)
        address borrower;       // Supplier / seller who listed the invoice (20 bytes)
        uint96 amount;          // Principal invoice financing amount in wei (12 bytes)
        address investor;       // Investor who financed the invoice (20 bytes)
        uint96 warrantyFee;     // Optional fee to activate warranty coverage in wei (12 bytes)
        address warrantyHolder; // Beneficiary holding active warranty protection (20 bytes)
        uint64 warrantyExpiry;  // Expiration timestamp if warranty is activated (8 bytes)
        uint32 invoiceDueDate;  // Due timestamp for invoice payment (4 bytes)
        uint32 warrantyDays;    // Coverage duration in days (4 bytes)
        bool isFinanced;        // Financing status flag (1 byte)
        bool hasWarranty;       // Indicates if warranty protection was activated (1 byte)
    }

    // ──────────────────────────────────────────────
    //  State Variables
    // ──────────────────────────────────────────────

    uint256 private _nextTokenId;
    mapping(uint256 => InvoiceAsset) private _invoices;

    // ──────────────────────────────────────────────
    //  Events
    // ──────────────────────────────────────────────

    event InvoiceListed(
        uint256 indexed tokenId,
        address indexed borrower,
        string invoiceNumber,
        uint256 amount,
        uint256 warrantyFee,
        uint256 dueDate
    );

    event InvoiceFinanced(
        uint256 indexed tokenId,
        address indexed investor,
        address indexed borrower,
        uint256 totalPaid,
        bool warrantyActivated,
        uint256 warrantyExpiry
    );

    event WarrantyTransferred(
        uint256 indexed tokenId,
        address indexed previousHolder,
        address indexed newHolder
    );

    // ──────────────────────────────────────────────
    //  Constructor
    // ──────────────────────────────────────────────

    constructor()
        ERC721("InvoiceWarrantyNFT", "IWINFT")
        Ownable(msg.sender)
    {}

    // ──────────────────────────────────────────────
    //  Core Functions
    // ──────────────────────────────────────────────

    /**
     * @notice Lists a new invoice for financing with an optional warranty add-on.
     * @param borrower       Wallet address of the supplier/borrower (defaults to msg.sender)
     * @param invoiceNumber  Unique invoice reference or serial number
     * @param amount         Principal financing value in wei
     * @param warrantyFee    Optional additional fee to activate warranty coverage (in wei)
     * @param invoiceDueDays Days until invoice payment is due
     * @param warrantyDays   Duration of warranty coverage in days
     * @param uri            IPFS metadata URI
     */
    function listInvoice(
        address borrower,
        string calldata invoiceNumber,
        uint96 amount,
        uint96 warrantyFee,
        uint32 invoiceDueDays,
        uint32 warrantyDays,
        string calldata uri
    ) external returns (uint256 tokenId) {
        if (amount == 0) revert InvalidAmount();

        address supplier = borrower == address(0) ? msg.sender : borrower;
        uint32 iDueDate;

        unchecked {
            tokenId = _nextTokenId++;
            iDueDate = uint32(block.timestamp + (invoiceDueDays * 1 days));
        }

        _invoices[tokenId] = InvoiceAsset({
            invoiceNumber: invoiceNumber,
            borrower: supplier,
            amount: amount,
            investor: address(0),
            warrantyFee: warrantyFee,
            warrantyHolder: address(0),
            warrantyExpiry: 0,
            invoiceDueDate: iDueDate,
            warrantyDays: warrantyDays,
            isFinanced: false,
            hasWarranty: false
        });

        // Mint NFT token representing the invoice asset to the supplier
        _safeMint(supplier, tokenId);
        _setTokenURI(tokenId, uri);

        emit InvoiceListed(tokenId, supplier, invoiceNumber, amount, warrantyFee, iDueDate);
    }

    /**
     * @notice Allows an investor to finance an invoice and OPTIONALLY activate warranty protection.
     * @param tokenId       ID of the invoice NFT to finance
     * @param optInWarranty Pass `true` to pay `amount + warrantyFee` and receive active warranty coverage
     */
    function financeInvoice(uint256 tokenId, bool optInWarranty) external payable {
        if (tokenId >= _nextTokenId) revert TokenDoesNotExist();

        InvoiceAsset storage invoice = _invoices[tokenId];

        if (invoice.isFinanced) revert AlreadyFinanced();
        if (msg.sender == invoice.borrower) revert CannotFinanceOwnInvoice();

        // Calculate total ETH required based on whether investor opts in to warranty
        uint256 totalCost = invoice.amount;
        if (optInWarranty) {
            totalCost += invoice.warrantyFee;
        }

        if (msg.value < totalCost) revert InsufficientETH();

        invoice.isFinanced = true;
        invoice.investor = msg.sender;

        uint64 wExpiry = 0;
        if (optInWarranty) {
            invoice.hasWarranty = true;
            invoice.warrantyHolder = msg.sender; // Investor receives warranty coverage
            unchecked {
                wExpiry = uint64(block.timestamp + (uint256(invoice.warrantyDays) * 1 days));
            }
            invoice.warrantyExpiry = wExpiry;
        }

        // Direct P2P ETH transfer to supplier/borrower
        (bool success, ) = payable(invoice.borrower).call{value: msg.value}("");
        if (!success) revert TransferFailed();

        emit InvoiceFinanced(tokenId, msg.sender, invoice.borrower, msg.value, optInWarranty, wExpiry);
    }

    /**
     * @notice Allows the current warranty holder to transfer warranty coverage to a new buyer.
     * @param tokenId   Invoice NFT token ID
     * @param newHolder Wallet address of the new warranty beneficiary
     */
    function transferWarranty(uint256 tokenId, address newHolder) external {
        if (tokenId >= _nextTokenId) revert TokenDoesNotExist();
        if (newHolder == address(0)) revert InvalidRecipient();

        InvoiceAsset storage invoice = _invoices[tokenId];

        require(invoice.hasWarranty, "Warranty is not active for this invoice");
        require(msg.sender == invoice.warrantyHolder || msg.sender == ownerOf(tokenId), "Caller is not warranty holder");

        address prevHolder = invoice.warrantyHolder;
        invoice.warrantyHolder = newHolder;

        emit WarrantyTransferred(tokenId, prevHolder, newHolder);
    }

    /**
     * @notice Checks if the warranty for a token ID is currently active and unexpired.
     * @param tokenId Invoice NFT token ID
     */
    function checkWarrantyValidity(uint256 tokenId) external view returns (bool isValid) {
        if (tokenId >= _nextTokenId) revert TokenDoesNotExist();
        InvoiceAsset storage invoice = _invoices[tokenId];
        
        return invoice.hasWarranty && (block.timestamp < invoice.warrantyExpiry);
    }

    /**
     * @notice Returns full invoice & warranty asset details.
     */
    function getInvoiceAsset(uint256 tokenId) external view returns (InvoiceAsset memory) {
        if (tokenId >= _nextTokenId) revert TokenDoesNotExist();
        return _invoices[tokenId];
    }

    /**
     * @notice Returns total number of listed invoice assets.
     */
    function totalMinted() external view returns (uint256 count) {
        return _nextTokenId;
    }
}
