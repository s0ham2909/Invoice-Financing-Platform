// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IInvoiceNFT {
    struct Invoice {
        string invoiceNumber;
        address borrower;
        uint96 amount;
        address investor;
        uint64 dueDate;
        bool isFinanced;
    }
    function getInvoice(uint256 tokenId) external view returns (Invoice memory);
    function totalMinted() external view returns (uint256);
    function financeInvoice(uint256 tokenId) external payable;
}

/**
 * @title InvoiceLiquidityPool
 * @notice ETH-based shared liquidity pool for the P2P Invoice Financing Platform.
 *
 * ROLES
 * ─────
 *  Investor  → depositLiquidity()   Send ETH, receive IPS (Invoice Pool Share) tokens.
 *  Supplier  → requestPoolFinancing() Ask pool to finance their listed invoice NFT.
 *  Supplier  → repayInvoice()        Repay principal + 5 % interest back to pool.
 *  Investor  → withdrawLiquidity()   Burn IPS tokens, receive proportional ETH + yield.
 *
 * ECONOMICS
 * ─────────
 *  Share price = totalPoolETH / totalSupply(IPS)
 *  Interest (5%) stays in pool → share price rises → investors earn yield passively.
 *  Utilization = financedETH / totalPoolETH  (keeps pool healthy, capped at 80%)
 */
contract InvoiceLiquidityPool is ERC20, ReentrancyGuard {

    // ────────────────────────── State ──────────────────────────

    IInvoiceNFT public immutable invoiceContract;

    /// @notice Total pool assets: idle ETH plus outstanding principal receivables.
    uint256 public totalPoolETH;

    /// @notice ETH actively lent out to suppliers (not yet repaid)
    uint256 public totalFinancedETH;

    /// @notice Maximum utilization before pool refuses new financing (80 %)
    uint256 public constant MAX_UTILIZATION_BPS = 8000; // basis points: 8000 = 80%

    /// @notice Fixed interest rate charged on repayment (5 %)
    uint256 public constant INTEREST_RATE_BPS = 500; // 500 = 5%

    struct LoanRecord {
        uint256 principal;     // ETH amount sent to supplier
        uint256 repayAmount;   // principal + interest
        address borrower;      // supplier address
        bool    repaid;
    }

    /// @notice tokenId => loan details
    mapping(uint256 => LoanRecord) public loans;

    /// @notice tokenIds financed by this pool
    uint256[] public financedTokenIds;

    // ────────────────────────── Events ──────────────────────────

    event LiquidityDeposited(address indexed investor, uint256 ethAmount, uint256 ipsShares);
    event LiquidityWithdrawn(address indexed investor, uint256 ethAmount, uint256 ipsShares);
    event InvoiceFinancedByPool(uint256 indexed tokenId, address indexed borrower, uint256 principal);
    event InvoiceRepaid(uint256 indexed tokenId, address indexed borrower, uint256 totalRepaid, uint256 interest);

    // ────────────────────────── Constructor ──────────────────────────

    constructor(address _invoiceContract)
        ERC20("Invoice Pool Share", "IPS")
    {
        require(_invoiceContract != address(0), "Invalid invoice contract");
        invoiceContract = IInvoiceNFT(_invoiceContract);
    }

    // ────────────────────────── Investor Functions ──────────────────────────

    /**
     * @notice Deposit ETH into the pool and receive IPS share tokens.
     * @dev Share price = totalPoolETH / totalSupply. First depositor sets the price.
     */
    function depositLiquidity() external payable nonReentrant returns (uint256 shares) {
        require(msg.value > 0, "Must deposit ETH");

        uint256 _totalSupply = totalSupply();
        if (_totalSupply == 0 || totalPoolETH == 0) {
            // First depositor: 1 share per wei
            shares = msg.value;
        } else {
            // Subsequent: proportional to current pool size
            shares = (msg.value * _totalSupply) / totalPoolETH;
        }

        require(shares > 0, "Zero shares minted");
        totalPoolETH += msg.value;
        _mint(msg.sender, shares);

        emit LiquidityDeposited(msg.sender, msg.value, shares);
    }

    /**
     * @notice Burn IPS shares and withdraw proportional ETH + accrued yield.
     * @param shares Number of IPS tokens to redeem.
     */
    function withdrawLiquidity(uint256 shares) external nonReentrant returns (uint256 ethAmount) {
        require(shares > 0, "Zero shares");
        require(balanceOf(msg.sender) >= shares, "Insufficient IPS balance");

        uint256 _totalSupply = totalSupply();
        require(_totalSupply > 0, "No shares exist");

        // ETH owed = shares * totalPoolETH / totalSupply
        ethAmount = (shares * totalPoolETH) / _totalSupply;
        require(ethAmount > 0, "Zero ETH returned");

        uint256 availableETH = totalPoolETH - totalFinancedETH;
        require(ethAmount <= availableETH, "Insufficient idle liquidity - loans outstanding");

        // Burn shares first (CEI pattern)
        _burn(msg.sender, shares);
        totalPoolETH -= ethAmount;

        (bool sent, ) = payable(msg.sender).call{value: ethAmount}("");
        require(sent, "ETH transfer failed");

        emit LiquidityWithdrawn(msg.sender, ethAmount, shares);
    }

    // ────────────────────────── Supplier Functions ──────────────────────────

    /**
     * @notice Request pool financing for an uploaded invoice NFT.
     * @param tokenId The NFT token ID of the invoice to finance.
     *
     * Checks:
     *  - Invoice exists and belongs to msg.sender
     *  - Invoice is not yet financed
     *  - Pool utilization will not exceed 80% after this financing
     */
    function requestPoolFinancing(uint256 tokenId) external nonReentrant {
        IInvoiceNFT.Invoice memory inv = invoiceContract.getInvoice(tokenId);

        require(inv.borrower == msg.sender, "Not your invoice");
        require(!inv.isFinanced, "Already financed");
        require(inv.amount > 0, "Invalid invoice amount");
        require(loans[tokenId].principal == 0, "Loan already recorded");

        uint256 principal = inv.amount;
        uint256 availableETH = totalPoolETH - totalFinancedETH;

        // Utilization check: (financedETH + principal) / totalPoolETH <= 80%
        require(
            (totalFinancedETH + principal) * 10000 <= totalPoolETH * MAX_UTILIZATION_BPS,
            "Pool utilization cap reached (80%)"
        );
        require(availableETH >= principal, "Insufficient pool liquidity");

        // Calculate repay amount: principal + 5% interest
        uint256 interest = (principal * INTEREST_RATE_BPS) / 10000;
        uint256 repayAmount = principal + interest;

        // Record loan
        loans[tokenId] = LoanRecord({
            principal:   principal,
            repayAmount: repayAmount,
            borrower:    msg.sender,
            repaid:      false
        });
        financedTokenIds.push(tokenId);

        // Update pool accounting BEFORE external call (CEI)
        totalFinancedETH += principal;

        // Call financeInvoice on the NFT contract (marks it as financed on-chain)
        invoiceContract.financeInvoice{value: principal}(tokenId);

        emit InvoiceFinancedByPool(tokenId, msg.sender, principal);
    }

    /**
     * @notice Supplier repays the pool (principal + 5% interest).
     * @param tokenId Invoice token ID being repaid.
     */
    function repayInvoice(uint256 tokenId) external payable nonReentrant {
        LoanRecord storage loan = loans[tokenId];

        require(loan.principal > 0, "No loan found for this invoice");
        require(!loan.repaid, "Loan already repaid");
        require(loan.borrower == msg.sender, "Not your loan");
        require(msg.value >= loan.repayAmount, "Insufficient repayment (include 5% interest)");

        loan.repaid = true;
        totalFinancedETH -= loan.principal;

        uint256 interest = loan.repayAmount - loan.principal;
        // Full repayment (principal + interest) flows back into pool
        totalPoolETH += interest; // Principal was already included as an outstanding receivable.

        // Refund any overpayment
        if (msg.value > loan.repayAmount) {
            (bool refunded, ) = payable(msg.sender).call{value: msg.value - loan.repayAmount}("");
            require(refunded, "Overpayment refund failed");
        }

        emit InvoiceRepaid(tokenId, msg.sender, loan.repayAmount, interest);
    }

    // ────────────────────────── View Functions ──────────────────────────

    /// @notice Current idle (available) ETH in pool
    function availableLiquidity() external view returns (uint256) {
        return totalPoolETH - totalFinancedETH;
    }

    /// @notice Pool utilization in basis points (e.g., 4500 = 45%)
    function utilizationBps() external view returns (uint256) {
        if (totalPoolETH == 0) return 0;
        return (totalFinancedETH * 10000) / totalPoolETH;
    }

    /// @notice Current ETH value of 1 IPS share (in wei)
    function sharePriceWei() external view returns (uint256) {
        uint256 _totalSupply = totalSupply();
        if (_totalSupply == 0 || totalPoolETH == 0) return 1e18; // 1 ETH default
        return (totalPoolETH * 1e18) / _totalSupply;
    }

    /// @notice Get loan details for a specific invoice
    function getLoan(uint256 tokenId) external view returns (LoanRecord memory) {
        return loans[tokenId];
    }

    /// @notice All token IDs financed by this pool
    function getFinancedTokenIds() external view returns (uint256[] memory) {
        return financedTokenIds;
    }

    /// @notice Allow contract to receive plain ETH (needed for test/fallback)
    receive() external payable {
        totalPoolETH += msg.value;
    }
}
