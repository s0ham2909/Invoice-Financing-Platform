// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title SimpleAMM
 * @notice Constant-Product Automated Market Maker (AMM) Liquidity Pool for DeFi Experiment 4.
 * @dev Implements x * y = k formula without swap fees for simplified verification.
 *      Inherits ERC20 to issue and manage LP (Liquidity Provider) share tokens.
 */
contract SimpleAMM is ERC20, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ──────────────────────────────────────────────
    //  State Variables
    // ──────────────────────────────────────────────

    /// @notice Reference to Token A ERC-20 contract
    IERC20 public immutable tokenA;

    /// @notice Reference to Token B ERC-20 contract
    IERC20 public immutable tokenB;

    /// @notice Recorded pool reserve of Token A
    uint256 public reserveA;

    /// @notice Recorded pool reserve of Token B
    uint256 public reserveB;

    // ──────────────────────────────────────────────
    //  Events
    // ──────────────────────────────────────────────

    /// @notice Emitted upon successful liquidity addition
    event LiquidityAdded(
        address indexed provider,
        uint256 amountA,
        uint256 amountB,
        uint256 lpShares
    );

    /// @notice Emitted upon liquidity removal
    event LiquidityRemoved(
        address indexed provider,
        uint256 amountA,
        uint256 amountB,
        uint256 lpShares
    );

    /// @notice Emitted upon every token swap
    event Swap(
        address indexed trader,
        address tokenIn,
        uint256 amountIn,
        address tokenOut,
        uint256 amountOut
    );

    /// @notice Emitted when reserves are updated
    event Sync(uint256 reserveA, uint256 reserveB);

    // ──────────────────────────────────────────────
    //  Constructor
    // ──────────────────────────────────────────────

    /**
     * @notice Initializes the AMM pool with paired token contracts.
     * @param _tokenA Address of Token A contract
     * @param _tokenB Address of Token B contract
     */
    constructor(address _tokenA, address _tokenB) ERC20("Simple AMM LP Token", "SAMM-LP") {
        require(_tokenA != address(0) && _tokenB != address(0), "Invalid token address");
        require(_tokenA != _tokenB, "Identical token addresses");

        tokenA = IERC20(_tokenA);
        tokenB = IERC20(_tokenB);
    }

    // ──────────────────────────────────────────────
    //  External Functions
    // ──────────────────────────────────────────────

    /**
     * @notice Transfers both assets into the pool and issues proportional LP shares.
     * @param amountA Amount of Token A to deposit
     * @param amountB Amount of Token B to deposit
     * @return lpShares Number of LP tokens minted to caller
     */
    function addLiquidity(uint256 amountA, uint256 amountB)
        external
        nonReentrant
        returns (uint256 lpShares)
    {
        require(amountA > 0 && amountB > 0, "Zero liquidity addition");

        // Transfer tokens from liquidity provider into AMM pool
        tokenA.safeTransferFrom(msg.sender, address(this), amountA);
        tokenB.safeTransferFrom(msg.sender, address(this), amountB);

        uint256 _totalSupply = totalSupply();

        if (_totalSupply == 0) {
            // First liquidity provider: geometric mean (square root rule)
            lpShares = _sqrt(amountA * amountB);
            require(lpShares > 0, "Insufficient initial LP minted");
        } else {
            // Subsequent liquidity additions: proportional to minimum reserve contribution
            uint256 sharesA = (amountA * _totalSupply) / reserveA;
            uint256 sharesB = (amountB * _totalSupply) / reserveB;
            lpShares = _min(sharesA, sharesB);
            require(lpShares > 0, "Insufficient LP shares minted");
        }

        // Mint LP-share tokens to liquidity provider
        _mint(msg.sender, lpShares);

        // Update recorded reserves
        reserveA += amountA;
        reserveB += amountB;

        emit LiquidityAdded(msg.sender, amountA, amountB, lpShares);
        emit Sync(reserveA, reserveB);
    }

    /**
     * @notice Burns LP shares and returns caller's proportional share of both pool reserves.
     * @param lpAmount Amount of LP shares to burn
     * @return amountA Quantity of Token A returned to caller
     * @return amountB Quantity of Token B returned to caller
     */
    function removeLiquidity(uint256 lpAmount)
        external
        nonReentrant
        returns (uint256 amountA, uint256 amountB)
    {
        require(lpAmount > 0, "Zero LP amount");
        require(balanceOf(msg.sender) >= lpAmount, "Exceeds LP balance");

        uint256 _totalSupply = totalSupply();
        require(_totalSupply > 0, "No liquidity in pool");

        // Proportional redemption formula: amount = (lpAmount * reserve) / totalSupply
        amountA = (lpAmount * reserveA) / _totalSupply;
        amountB = (lpAmount * reserveB) / _totalSupply;

        require(amountA > 0 && amountB > 0, "Insufficient liquidity returned");

        // Burn LP tokens first (Checks-Effects-Interactions pattern)
        _burn(msg.sender, lpAmount);

        // Update reserves
        reserveA -= amountA;
        reserveB -= amountB;

        // Transfer underlying assets back to provider
        tokenA.safeTransfer(msg.sender, amountA);
        tokenB.safeTransfer(msg.sender, amountB);

        emit LiquidityRemoved(msg.sender, amountA, amountB, lpAmount);
        emit Sync(reserveA, reserveB);
    }

    /**
     * @notice Swaps Token A for Token B using constant-product formula (x * y = k).
     * @param amountAIn Exact quantity of Token A supplied for swap
     * @return amountBOut Quantity of Token B received by caller
     */
    function swapAForB(uint256 amountAIn)
        external
        nonReentrant
        returns (uint256 amountBOut)
    {
        require(amountAIn > 0, "Zero input amount");

        amountBOut = getAmountOut(amountAIn, reserveA, reserveB);
        require(amountBOut > 0, "Insufficient output amount");
        require(amountBOut < reserveB, "Insufficient pool liquidity");

        // Pull Token A from trader
        tokenA.safeTransferFrom(msg.sender, address(this), amountAIn);

        // Update reserves according to x * y = k formula
        reserveA += amountAIn;
        reserveB -= amountBOut;

        // Push Token B to trader
        tokenB.safeTransfer(msg.sender, amountBOut);

        emit Swap(msg.sender, address(tokenA), amountAIn, address(tokenB), amountBOut);
        emit Sync(reserveA, reserveB);
    }

    /**
     * @notice Swaps Token B for Token A using constant-product formula (x * y = k).
     * @param amountBIn Exact quantity of Token B supplied for swap
     * @return amountAOut Quantity of Token A received by caller
     */
    function swapBForA(uint256 amountBIn)
        external
        nonReentrant
        returns (uint256 amountAOut)
    {
        require(amountBIn > 0, "Zero input amount");

        amountAOut = getAmountOut(amountBIn, reserveB, reserveA);
        require(amountAOut > 0, "Insufficient output amount");
        require(amountAOut < reserveA, "Insufficient pool liquidity");

        // Pull Token B from trader
        tokenB.safeTransferFrom(msg.sender, address(this), amountBIn);

        // Update reserves according to x * y = k formula
        reserveB += amountBIn;
        reserveA -= amountAOut;

        // Push Token A to trader
        tokenA.safeTransfer(msg.sender, amountAOut);

        emit Swap(msg.sender, address(tokenB), amountBIn, address(tokenA), amountAOut);
        emit Sync(reserveA, reserveB);
    }

    /**
     * @notice Returns current recorded reserves for Token A and Token B.
     */
    function getReserves() external view returns (uint256 _reserveA, uint256 _reserveB) {
        return (reserveA, reserveB);
    }

    /**
     * @notice Calculates expected swap output before execution (no-fee constant-product model).
     * @dev newReserveIn = reserveIn + amountIn
     *      newReserveOut = (reserveIn * reserveOut) / newReserveIn
     *      amountOut = reserveOut - newReserveOut
     * @param amountIn Amount of input token
     * @param reserveIn Current pool reserve of input token
     * @param reserveOut Current pool reserve of output token
     * @return amountOut Projected output token amount
     */
    function getAmountOut(
        uint256 amountIn,
        uint256 reserveIn,
        uint256 reserveOut
    ) public pure returns (uint256 amountOut) {
        require(amountIn > 0, "Zero input amount");
        require(reserveIn > 0 && reserveOut > 0, "Insufficient pool liquidity");

        uint256 newReserveIn = reserveIn + amountIn;
        uint256 newReserveOut = (reserveIn * reserveOut) / newReserveIn;
        amountOut = reserveOut - newReserveOut;
    }

    // ──────────────────────────────────────────────
    //  Internal Math Helpers
    // ──────────────────────────────────────────────

    /**
     * @dev Calculates the integer square root using the Babylonian method.
     */
    function _sqrt(uint256 y) internal pure returns (uint256 z) {
        if (y > 3) {
            z = y;
            uint256 x = y / 2 + 1;
            while (x < z) {
                z = x;
                x = (y / x + x) / 2;
            }
        } else if (y != 0) {
            z = 1;
        }
    }

    /**
     * @dev Returns minimum of two numbers.
     */
    function _min(uint256 x, uint256 y) internal pure returns (uint256) {
        return x < y ? x : y;
    }
}
