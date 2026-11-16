// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
interface IInvoiceCollateral {
    function stakedBalance(address) external view returns (uint256);
    function lockSupplierStake(address, uint256) external;
    function unlockSupplierStake(address) external;
}

/**
 * @title InvoiceNFT
 * @notice Gas-Optimized ERC-721 token contract for an Invoice Discounting & Financing Platform.
 * @dev Anyone can mint invoice NFTs. Investors can finance listed invoices directly via ETH payout.
 */
contract InvoiceNFT is ERC721URIStorage, Ownable, ReentrancyGuard {
    uint256 public platformFeeBps;
    address public treasury;
    IInvoiceCollateral public collateral;
    mapping(uint256 => bool) public isRepaid;
    mapping(address => uint256) public activeLoans;
    event InvoiceRepaid(uint256 indexed tokenId, address indexed borrower, address indexed investor, uint256 amount);
    event PlatformFeeUpdated(uint256 feeBps);
    error InvalidRepayment();
    error CollateralRequired();

    /// @notice Fee changes apply to new financing only. Fees are paid immediately to treasury.
    function setPlatformFeeBps(uint256 bps) external onlyOwner {
        require(bps <= 1000, "Fee above 10%");
        platformFeeBps = bps;
        emit PlatformFeeUpdated(bps);
    }

    /// @notice One-time setup before transferring ownership to PlatformConfig.
    function configureCollateral(address staking, address recipient) external onlyOwner {
        require(address(collateral) == address(0) && staking.code.length > 0 && recipient != address(0), "Invalid setup");
        collateral = IInvoiceCollateral(staking);
        treasury = recipient;
    }

    function financingCost(uint256 tokenId) public view returns (uint256) {
        if (tokenId >= _nextTokenId) revert TokenDoesNotExist();
        return uint256(_invoices[tokenId].amount) * (10000 + platformFeeBps) / 10000;
    }

    /// @notice Repay principal to the recorded investor; all collateral stays locked until all loans are paid.
    function repayInvoice(uint256 tokenId) external payable nonReentrant {
        if (tokenId >= _nextTokenId) revert TokenDoesNotExist();
        Invoice storage inv = _invoices[tokenId];
        if (!inv.isFinanced || isRepaid[tokenId] || msg.sender != inv.borrower || msg.value != inv.amount) revert InvalidRepayment();
        isRepaid[tokenId] = true;
        activeLoans[inv.borrower]--;
        if (address(collateral) != address(0) && activeLoans[inv.borrower] == 0) collateral.unlockSupplierStake(inv.borrower);
        (bool paid,) = payable(inv.investor).call{value: msg.value}("");
        if (!paid) revert TransferFailed();
        emit InvoiceRepaid(tokenId, inv.borrower, inv.investor, msg.value);
    }


    // ──────────────────────────────────────────────
    //  Custom Errors (Gas Optimization)
    // ──────────────────────────────────────────────
    error InvalidAmount();
    error TokenDoesNotExist();
    error AlreadyFinanced();
    error InsufficientETH();
    error CannotFinanceOwnInvoice();
    error TransferFailed();

    // ──────────────────────────────────────────────
    //  Data Structures (Storage Slot Packed)
    // ──────────────────────────────────────────────

    /// @notice Holds metadata and financing status for a single invoice
    /// @dev Storage slots optimized:
    ///      Slot 1: Dynamic string (invoiceNumber)
    ///      Slot 2: borrower (20 bytes) + amount (12 bytes) = 32 bytes
    ///      Slot 3: investor (20 bytes) + dueDate (8 bytes) + isFinanced (1 byte) = 29 bytes
    struct Invoice {
        string invoiceNumber; // Unique reference number for the invoice
        address borrower;     // Address of the borrower/supplier (20 bytes)
        uint96 amount;        // Invoice monetary value in wei (12 bytes - up to 79 Billion ETH)
        address investor;     // Address of the investor who financed (20 bytes)
        uint64 dueDate;      // Payment due timestamp (8 bytes)
        bool isFinanced;      // Financing status flag (1 byte)
    }

    // ──────────────────────────────────────────────
    //  State Variables
    // ──────────────────────────────────────────────

    /// @dev Auto-incrementing token ID counter
    uint256 private _nextTokenId;

    /// @notice Maps each tokenId to its Invoice details
    mapping(uint256 => Invoice) private _invoices;

    // ──────────────────────────────────────────────
    //  Events
    // ──────────────────────────────────────────────

    /// @notice Emitted when a new invoice NFT is minted
    event InvoiceMinted(
        uint256 indexed tokenId,
        address indexed borrower,
        string invoiceNumber,
        uint256 amount,
        uint256 dueDate
    );

    /// @notice Emitted when an investor finances an invoice NFT
    event InvoiceFinanced(
        uint256 indexed tokenId,
        address indexed investor,
        address indexed borrower,
        uint256 amount
    );

    // ──────────────────────────────────────────────
    //  Constructor
    // ──────────────────────────────────────────────

    constructor()
        ERC721("InvoiceNFT", "INFT")
        Ownable(msg.sender)
    {}

    // ──────────────────────────────────────────────
    //  Core Functions
    // ──────────────────────────────────────────────

    /**
     * @notice Mints an invoice NFT (Gas-Optimized).
     * @param borrower      Wallet address of the borrower (defaults to msg.sender if address(0))
     * @param invoiceNumber Unique invoice serial/number string (passed in calldata)
     * @param amount        Invoice monetary value in wei (uint96)
     * @param dueDateDays   Number of days until payment is due
     * @param uri           IPFS or metadata URI (passed in calldata)
     * @return tokenId      The ID of the newly minted NFT
     */
    function mintInvoice(
        address borrower,
        string calldata invoiceNumber,
        uint96 amount,
        uint32 dueDateDays,
        string calldata uri
    ) external returns (uint256 tokenId) {
        if (amount == 0 || dueDateDays == 0 || dueDateDays > 365 || (borrower != address(0) && borrower != msg.sender)) revert InvalidAmount();

        address recipient = borrower == address(0) ? msg.sender : borrower;
        uint64 dueDate;

        unchecked {
            tokenId = _nextTokenId++;
            dueDate = uint64(block.timestamp + (dueDateDays * 1 days));
        }

        _invoices[tokenId] = Invoice({
            invoiceNumber: invoiceNumber,
            borrower: recipient,
            amount: amount,
            investor: address(0),
            dueDate: dueDate,
            isFinanced: false
        });

        _safeMint(recipient, tokenId);
        _setTokenURI(tokenId, uri);

        emit InvoiceMinted(tokenId, recipient, invoiceNumber, amount, dueDate);
    }

    /**
     * @notice Allows an investor to finance an invoice by sending ETH.
     * @dev Payout transferred directly to borrower via low-level call.
     * @param tokenId The ID of the invoice NFT to finance
     */
    function financeInvoice(uint256 tokenId) external payable nonReentrant {
        if (tokenId >= _nextTokenId) revert TokenDoesNotExist();
        
        Invoice storage invoice = _invoices[tokenId];
        
        if (invoice.isFinanced) revert AlreadyFinanced();
        if (msg.value != financingCost(tokenId)) revert InsufficientETH();
        if (block.timestamp >= invoice.dueDate) revert InvalidRepayment();
        if (msg.sender == invoice.borrower) revert CannotFinanceOwnInvoice();

        invoice.isFinanced = true;
        invoice.investor = msg.sender;
        activeLoans[invoice.borrower]++;
        if (address(collateral) != address(0)) {
            uint256 balance = collateral.stakedBalance(invoice.borrower);
            if (balance == 0) revert CollateralRequired();
            collateral.lockSupplierStake(invoice.borrower, balance);
        }
        uint256 fee = msg.value - invoice.amount;
        if (fee > 0) {
            require(treasury != address(0), "Treasury not configured");
            (bool sentFee,) = payable(treasury).call{value: fee}("");
            if (!sentFee) revert TransferFailed();
        }

        // Direct P2P ETH payout to borrower
        (bool success, ) = payable(invoice.borrower).call{value: invoice.amount}("");
        if (!success) revert TransferFailed();

        emit InvoiceFinanced(tokenId, msg.sender, invoice.borrower, msg.value);
    }

    /**
     * @notice Returns full invoice details for a given token ID.
     * @param tokenId The invoice NFT token ID
     * @return The Invoice struct
     */
    function getInvoice(uint256 tokenId) external view returns (Invoice memory) {
        if (tokenId >= _nextTokenId) revert TokenDoesNotExist();
        return _invoices[tokenId];
    }

    /**
     * @notice Returns total count of invoice NFTs minted.
     */
    function totalMinted() external view returns (uint256 count) {
        return _nextTokenId;
    }
}
