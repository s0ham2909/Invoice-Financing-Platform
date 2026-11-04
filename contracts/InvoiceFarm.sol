// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title InvoiceFarm
 * @notice Yield Farming Mechanism for Invoice Vault Shares (vINV).
 * @dev Corresponds to DeFi Experiment 5 - Part 1 (SimpleYieldFarm traceability).
 *
 * LAB SPECIFICATION MAPPING:
 *  - Staking Token (LPT in doc): `vINV` (InvoiceVault ERC-4626 share token).
 *  - Reward Token (RWD in doc):  `INVX` (Platform Protocol Token).
 *  - Core Functions: `stake`, `earned`, `harvest`, `withdraw`, `exit`.
 *  - Core Events:    `Staked(user, amount)`, `RewardPaid(user, reward)`, `Withdrawn(user, amount)`.
 *  - Core Checks:    Zero-value stake rejection, allowance/balance checks,
 *                    cannot withdraw > stake, update rewards before balances,
 *                    sufficient reward balance before transfer.
 *
 * REAL FEATURE ENHANCEMENTS:
 *  - Uses Synthetix StakingRewards global accumulator (rewardPerTokenStored)
 *    so total emissions are bounded and independent of fluctuating TVL.
 *  - Utilization-aware emissions: dynamically adjust reward emission rate based on
 *    idle vault liquidity (higher incentive to farm when idle liquidity is high).
 *  - Fund rewards via `notifyRewardAmount(amount, duration)` (owner only).
 */
contract InvoiceFarm is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ──────────────────────────────────────────────
    //  State Variables (Doc Traceability)
    // ──────────────────────────────────────────────

    /// @notice Staking token reference (vINV vault shares)
    IERC20 public immutable stakingToken;

    /// @notice Reward token reference (INVX platform token)
    IERC20 public immutable rewardToken;

    /// @notice Total amount of staking tokens currently deposited in farm
    uint256 public totalStaked;

    /// @notice User staked balance mapping: user => amount
    mapping(address => uint256) public stakedBalance;

    /// @notice Last timestamp when global reward accumulator was updated
    uint256 public lastUpdateTime;

    /// @notice Timestamp when the current reward period finishes
    uint256 public periodFinish;

    /// @notice Current reward emission rate in reward tokens per second
    uint256 public rewardRate;

    /// @notice Base reward rate configured by owner
    uint256 public baseRewardRate;

    /// @notice Accumulated reward per token stored, scaled by 1e18
    uint256 public rewardPerTokenStored;

    /// @notice User's snapshot of rewardPerTokenStored: user => value
    mapping(address => uint256) public userRewardPerTokenPaid;

    /// @notice Accumulated but unclaimed rewards: user => pending
    mapping(address => uint256) public pendingReward;

    /// @notice Utilization multiplier in basis points (10,000 = 1.0x, 15,000 = 1.5x)
    uint256 public utilizationMultiplierBps = 10000;

    /// @notice Maximum utilization boost allowed (e.g. 25,000 = 2.5x cap)
    uint256 public constant MAX_BOOST_BPS = 25000;

    // ──────────────────────────────────────────────
    //  Events (Per Document)
    // ──────────────────────────────────────────────
    event Staked(address indexed user, uint256 amount);
    event RewardPaid(address indexed user, uint256 reward);
    event Withdrawn(address indexed user, uint256 amount);
    event RewardAdded(uint256 reward, uint256 duration);
    event UtilizationAdjusted(uint256 utilizationBps, uint256 newMultiplierBps);

    // ──────────────────────────────────────────────
    //  Custom Errors
    // ──────────────────────────────────────────────
    error ZeroAmount();
    error InsufficientStake();
    error InsufficientFarmRewardBalance();
    error RewardPeriodActive();

    // ──────────────────────────────────────────────
    //  Modifiers
    // ──────────────────────────────────────────────
    modifier updateReward(address account) {
        rewardPerTokenStored = rewardPerToken();
        lastUpdateTime = lastTimeRewardApplicable();
        if (account != address(0)) {
            pendingReward[account] = earned(account);
            userRewardPerTokenPaid[account] = rewardPerTokenStored;
        }
        _;
    }

    // ──────────────────────────────────────────────
    //  Constructor
    // ──────────────────────────────────────────────
    constructor(address _stakingToken, address _rewardToken) Ownable(msg.sender) {
        require(_stakingToken != address(0) && _rewardToken != address(0), "Invalid token address");
        stakingToken = IERC20(_stakingToken);
        rewardToken = IERC20(_rewardToken);
    }

    // ──────────────────────────────────────────────
    //  Reward Calculations (Accumulator Pattern)
    // ──────────────────────────────────────────────

    function lastTimeRewardApplicable() public view returns (uint256) {
        return block.timestamp < periodFinish ? block.timestamp : periodFinish;
    }

    function rewardPerToken() public view returns (uint256) {
        if (totalStaked == 0) {
            return rewardPerTokenStored;
        }
        return
            rewardPerTokenStored +
            (((lastTimeRewardApplicable() - lastUpdateTime) * rewardRate * 1e18) / totalStaked);
    }

    /**
     * @notice Returns total calculated reward earned by user (unclaimed + newly accrued).
     * @param user Target account address
     */
    function earned(address user) public view returns (uint256) {
        return
            ((stakedBalance[user] * (rewardPerToken() - userRewardPerTokenPaid[user])) / 1e18) +
            pendingReward[user];
    }

    // ──────────────────────────────────────────────
    //  Core Farming Functions
    // ──────────────────────────────────────────────

    /**
     * @notice Deposits approved vINV vault shares into the farm.
     * @param amount Amount of staking tokens to stake
     */
    function stake(uint256 amount) external nonReentrant updateReward(msg.sender) {
        if (amount == 0) revert ZeroAmount();

        totalStaked += amount;
        stakedBalance[msg.sender] += amount;

        stakingToken.safeTransferFrom(msg.sender, address(this), amount);
        emit Staked(msg.sender, amount);
    }

    /**
     * @notice Withdraws a specific amount of staked vINV shares from the farm.
     * @param amount Amount to withdraw
     */
    function withdraw(uint256 amount) public nonReentrant updateReward(msg.sender) {
        if (amount == 0) revert ZeroAmount();
        if (amount > stakedBalance[msg.sender]) revert InsufficientStake();

        totalStaked -= amount;
        stakedBalance[msg.sender] -= amount;

        stakingToken.safeTransfer(msg.sender, amount);
        emit Withdrawn(msg.sender, amount);
    }

    /**
     * @notice Harvests accumulated INVX rewards and sends them to the caller.
     */
    function harvest() public nonReentrant updateReward(msg.sender) returns (uint256 reward) {
        reward = pendingReward[msg.sender];
        if (reward > 0) {
            pendingReward[msg.sender] = 0;

            uint256 availableReward = rewardToken.balanceOf(address(this));
            if (reward > availableReward) revert InsufficientFarmRewardBalance();

            rewardToken.safeTransfer(msg.sender, reward);
            emit RewardPaid(msg.sender, reward);
        }
    }

    /**
     * @notice Convenience function to withdraw entire stake and claim all pending rewards in one call.
     */
    function exit() external {
        withdraw(stakedBalance[msg.sender]);
        harvest();
    }

    // ──────────────────────────────────────────────
    //  Admin & Utilization Management
    // ──────────────────────────────────────────────

    /**
     * @notice Notifies the farm of a new reward amount over a specific duration (Synthetix style).
     * @dev Caller must transfer `amount` of rewardToken to this contract before or with this call.
     * @param amount   Total reward tokens to distribute
     * @param duration Duration in seconds over which rewards are emitted
     */
    function notifyRewardAmount(uint256 amount, uint256 duration)
        external
        onlyOwner
        updateReward(address(0))
    {
        require(duration > 0, "Duration must be > 0");

        if (block.timestamp >= periodFinish) {
            baseRewardRate = amount / duration;
        } else {
            uint256 remaining = periodFinish - block.timestamp;
            uint256 leftover = remaining * rewardRate;
            baseRewardRate = (amount + leftover) / duration;
        }

        rewardRate = (baseRewardRate * utilizationMultiplierBps) / 10000;

        uint256 balance = rewardToken.balanceOf(address(this));
        require(rewardRate * duration <= balance, "Provided reward > contract balance");

        lastUpdateTime = block.timestamp;
        periodFinish = block.timestamp + duration;

        emit RewardAdded(amount, duration);
    }

    /**
     * @notice Adjusts farming emission rate based on vault utilization.
     * @dev When vault utilization is low (high idle cash), multiplier increases up to MAX_BOOST_BPS
     *      to incentivize suppliers/investors to deposit and stake vINV.
     * @param vaultUtilizationBps Current vault utilization in basis points (0 to 10,000)
     */
    function setUtilizationIncentive(uint256 vaultUtilizationBps)
        external
        onlyOwner
        updateReward(address(0))
    {
        require(vaultUtilizationBps <= 10000, "Invalid bps");

        // If utilization is low (e.g. 20% = 2,000 bps), idle liquidity is 80% (8,000 bps).
        // Boost is proportional to idle liquidity: 10,000 + (10,000 - vaultUtilizationBps)
        uint256 idleBps = 10000 - vaultUtilizationBps;
        uint256 newMultiplier = 10000 + (idleBps / 2); // Up to 15,000 bps (1.5x)

        if (newMultiplier > MAX_BOOST_BPS) {
            newMultiplier = MAX_BOOST_BPS;
        }

        utilizationMultiplierBps = newMultiplier;
        rewardRate = (baseRewardRate * utilizationMultiplierBps) / 10000;

        emit UtilizationAdjusted(vaultUtilizationBps, newMultiplier);
    }

    /**
     * @notice Set manual reward rate directly (for classroom/lab testing matching doc's 0.001 rate).
     * @param _rewardRate Tokens per second in wei
     * @param _duration Duration in seconds
     */
    function setRewardRateDirect(uint256 _rewardRate, uint256 _duration)
        external
        onlyOwner
        updateReward(address(0))
    {
        baseRewardRate = _rewardRate;
        rewardRate = (_rewardRate * utilizationMultiplierBps) / 10000;
        lastUpdateTime = block.timestamp;
        periodFinish = block.timestamp + _duration;
    }
}
