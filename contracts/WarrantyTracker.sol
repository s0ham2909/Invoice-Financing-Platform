// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title WarrantyTracker
 * @notice Gas-optimized ERC-721 warranty contract for tracking physical product warranties on Sepolia.
 * @dev Only the contract owner (manufacturer) can mint warranty NFTs.
 */
contract WarrantyTracker is ERC721URIStorage, Ownable {

    // ──────────────────────────────────────────────
    //  Custom Errors (Gas Optimization)
    // ──────────────────────────────────────────────
    error TokenDoesNotExist();
    error InvalidRecipient();
    error InvalidDuration();

    // ──────────────────────────────────────────────
    //  Data Structures (Storage Packed)
    // ──────────────────────────────────────────────

    /// @notice Holds warranty metadata for a single product
    /// @dev purchaseDate & expiryDate packed in a single 16-byte storage slot
    struct Warranty {
        string serialNumber;   // Unique product serial number (Dynamic string)
        uint64 purchaseDate;   // Timestamp when warranty was minted (8 bytes)
        uint64 expiryDate;     // Timestamp when warranty expires (8 bytes)
    }

    // ──────────────────────────────────────────────
    //  State Variables
    // ──────────────────────────────────────────────

    /// @dev Auto-incrementing token ID counter
    uint256 private _nextTokenId;

    /// @notice Maps each tokenId to its Warranty details
    mapping(uint256 => Warranty) private _warranties;

    // ──────────────────────────────────────────────
    //  Events
    // ──────────────────────────────────────────────

    /// @notice Emitted when a new warranty NFT is minted
    event WarrantyMinted(
        uint256 indexed tokenId,
        address indexed to,
        string serialNumber,
        uint256 purchaseDate,
        uint256 expiryDate
    );

    // ──────────────────────────────────────────────
    //  Constructor
    // ──────────────────────────────────────────────

    constructor()
        ERC721("WarrantyTracker", "WTK")
        Ownable(msg.sender)
    {}

    // ──────────────────────────────────────────────
    //  Core Functions
    // ──────────────────────────────────────────────

    /**
     * @notice Mints a new warranty NFT to a customer address (Gas Optimized).
     * @param to             Customer wallet address receiving the warranty
     * @param serialNumber   Unique product serial number (passed via calldata to save gas)
     * @param durationInDays Warranty duration in days
     * @param uri            Token metadata URI (passed via calldata to save gas)
     */
    function mintWarranty(
        address to,
        string calldata serialNumber,
        uint256 durationInDays,
        string calldata uri
    ) external onlyOwner {
        if (to == address(0)) revert InvalidRecipient();
        if (durationInDays == 0) revert InvalidDuration();

        uint256 tokenId;
        uint64 purchaseDate = uint64(block.timestamp);
        uint64 expiryDate;

        unchecked {
            tokenId = _nextTokenId++;
            expiryDate = uint64(block.timestamp + (durationInDays * 1 days));
        }

        // Store warranty metadata
        _warranties[tokenId] = Warranty({
            serialNumber: serialNumber,
            purchaseDate: purchaseDate,
            expiryDate: expiryDate
        });

        // Mint the NFT and set metadata URI
        _safeMint(to, tokenId);
        _setTokenURI(tokenId, uri);

        emit WarrantyMinted(tokenId, to, serialNumber, purchaseDate, expiryDate);
    }

    /**
     * @notice Checks whether a warranty is still valid for the caller.
     * @param tokenId Warranty NFT token ID
     */
    function checkValidity(uint256 tokenId) external view returns (bool isValid) {
        if (tokenId >= _nextTokenId) revert TokenDoesNotExist();

        address tokenOwner = ownerOf(tokenId);
        uint64 expiry = _warranties[tokenId].expiryDate;

        isValid = (msg.sender == tokenOwner) && (block.timestamp < expiry);
    }

    /**
     * @notice Returns full warranty details for a given token.
     * @param tokenId Warranty NFT token ID
     */
    function getWarranty(uint256 tokenId) external view returns (Warranty memory) {
        if (tokenId >= _nextTokenId) revert TokenDoesNotExist();
        return _warranties[tokenId];
    }

    /**
     * @notice Returns total number of warranty NFTs minted.
     */
    function totalMinted() external view returns (uint256 count) {
        return _nextTokenId;
    }
}
