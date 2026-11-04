// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title ReserveStaking
 * @notice Protocol Token (INVX) Staking Mechanism with Real mUSDC Repayment Yield & Supplier Tiers.
 * @dev Corresponds to DeFi Experiment 5 - Part 2 (SimpleStaking traceability).
 *
 * LAB SPECIFICATION MAPPING:
 *  - Staking Token (ABC in doc): `INVX` (Protocol Token).
 *  - Reward Token (RWD in doc):  `mUSDC` (Real interest yield routed from invoice repayments).
 *  - Core Functions: `stake`, `earned`, `claimReward`, `unstake`, `exit`.
 *  - Core Events:    `Staked(user, amount)`, `RewardClaimed(user, reward)`, `Unstaked(user, amount)`.
 *  - Core Checks:    Zero-value stake rejected, allowance/balance checks,
 *                    cannot unstake > stake, update rewards before balances,
 *                    sufficient reward balance before transfer.
 *
 * REAL FEATURE ENHANCEMENTS:
 *  - Rewards paid in mUSDC from FeeRouter (real yield, not inflation).
 *  - Global Synthetix accumulator pattern for bounded emissions.
 *  - Supplier Tiers:
 *      * Bronze: 0 - 999 INVX        -> 0 bps fee discount, 10,000 mUSDC limit
 *      * Silver: 1,000 - 4,999 INVX  -> 100 bps (1%) discount, 50,000 mUSDC limit
 *      * Gold:   5,000+ INVX         -> 250 bps (2.5%) discount, 200,000 mUSDC limit
 *  - Unstake Lock Rule:
 *      * Authorized invoice contract can call `lockSupplierStake(supplier, minStakeRequired)`.
 *      * While an invoice is active, supplier cannot unstake below their locked tier threshold.
 *      * Once repaid, `unlockSupplierStake(supplier)` removes the restriction.
 */
contract ReserveStaking is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ──────────────────────────────────────────────
    //  State Variables (Doc Traceability)
    // ──────────────────────────────────────────────

    /// @notice Staking token reference (INVX protocol token)
    IERC20 public immutable stakingToken;

    /// @notice Reward token reference (mUSDC stablecoin)
    IERC20 public immutable rewardToken;

    /// @notice Total INVX staked in the contract
    uint256 public totalStaked;

    /// @notice Staked balance per user: user => amount
    mapping(address => uint256) public stakedBalance;

    /// @notice Last timestamp when reward accumulator was updated
    uint256 public lastUpdateTime;

    /// @notice Timestamp when current reward distribution period ends
    uint256 public periodFinish;

    /// @notice Current reward emission rate in mUSDC per second
    uint256 public rewardRate;

    /// @notice Accumulated reward per token stored, scaled by 1e18
    uint256 public rewardPerTokenStored;

    /// @notice User snapshot of rewardPerTokenStored: user => value
    mapping(address => uint256) public userRewardPerTokenPaid;

    /// @notice Pending claimable mUSDC rewards: user => amount
    mapping(address => uint256) public pendingReward;

    // ──────────────────────────────────────────────
    //  Supplier Tiers & Unstake Lock State
    // ──────────────────────────────────────────────

    /// @notice Authorized contracts allowed to lock/unlock supplier stakes (e.g. TierGate, InvoiceLiquidityPool, FeeRouter)
    mapping(address => bool) public isAuthorizedLocker;

    /// @notice Backward-compatible single getter
    address public authorizedLocker;

    /// @notice Minimum stake locked per supplier: supplier => lockedAmount
    mapping(address => uint256) public lockedStake;

    /// @notice Supplier Tier thresholds (in INVX, 18 decimals)
    uint256 public silverThreshold = 1_000 * 10**18;
    uint256 public goldThreshold   = 5_000 * 10**18;

    /// @notice Financing limits per tier (in mUSDC, 6 decimals)
    uint256 public bronzeLimit = 10_000 * 10**6;
    uint256 public silverLimit = 50_000 * 10**6;
    uint256 public goldLimit   = 200_000 * 10**6;

    // ──────────────────────────────────────────────
    //  Events (Per Document)
    // ──────────────────────────────────────────────
    event Staked(address indexed user, uint256 amount);
    event RewardClaimed(address indexed user, uint256 reward);
    event Unstaked(address indexed user, uint256 amount);
    event RewardAdded(uint256 reward, uint256 duration);
    event StakeLocked(address indexed supplier, uint256 minRequired);
    event StakeUnlocked(address indexed supplier);
    event TierThresholdsUpdated(uint256 silverThreshold, uint256 goldThreshold);
    event AuthorizedLockerUpdated(address indexed locker, bool authorized);

    // ──────────────────────────────────────────────
    //  Custom Errors
    // ──────────────────────────────────────────────
    error ZeroAmount();
    error InsufficientStake();
    error InsufficientStakingRewardBalance();
    error StakeIsLocked(uint256 currentStake, uint256 lockedMinimum);
    error Unauthorized();

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

    modifier onlyAuthorized() {
        if (!isAuthorizedLocker[msg.sender] && msg.sender != authorizedLocker && msg.sender != owner()) {
            revert Unauthorized();
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
     * @notice Returns total calculated mUSDC reward earned by user.
     * @param user Target account address
     */
    function earned(address user) public view returns (uint256) {
        return
            ((stakedBalance[user] * (rewardPerToken() - userRewardPerTokenPaid[user])) / 1e18) +
            pendingReward[user];
    }

    // ──────────────────────────────────────────────
    //  Core Staking Functions
    // ──────────────────────────────────────────────

    /**
     * @notice Stakes INVX tokens into the contract.
     * @param amount Amount of INVX to stake
     */
    function stake(uint256 amount) external nonReentrant updateReward(msg.sender) {
        if (amount == 0) revert ZeroAmount();

        totalStaked += amount;
        stakedBalance[msg.sender] += amount;

        stakingToken.safeTransferFrom(msg.sender, address(this), amount);
        emit Staked(msg.sender, amount);
    }

    /**
     * @notice Unstakes a specific amount of INVX.
     * @dev Enforces the Unstake Lock Rule: cannot unstake below `lockedStake[msg.sender]`
     *      while the supplier has an active, unpaid financed invoice.
     * @param amount Amount of INVX to unstake
     */
    function unstake(uint256 amount) public nonReentrant updateReward(msg.sender) {
        if (amount == 0) revert ZeroAmount();
        if (amount > stakedBalance[msg.sender]) revert InsufficientStake();

        uint256 remaining = stakedBalance[msg.sender] - amount;
        if (remaining < lockedStake[msg.sender]) {
            revert StakeIsLocked(remaining, lockedStake[msg.sender]);
        }

        totalStaked -= amount;
        stakedBalance[msg.sender] = remaining;

        stakingToken.safeTransfer(msg.sender, amount);
        emit Unstaked(msg.sender, amount);
    }

    /**
     * @notice Claims accumulated mUSDC rewards and sends them to caller.
     */
    function claimReward() public nonReentrant updateReward(msg.sender) returns (uint256 reward) {
        reward = pendingReward[msg.sender];
        if (reward > 0) {
            pendingReward[msg.sender] = 0;

            uint256 availableReward = rewardToken.balanceOf(address(this));
            if (reward > availableReward) revert InsufficientStakingRewardBalance();

            rewardToken.safeTransfer(msg.sender, reward);
            emit RewardClaimed(msg.sender, reward);
        }
    }

    /**
     * @notice Convenience function to unstake maximum unlocked INVX and claim all pending mUSDC.
     */
    function exit() external {
        uint256 withdrawable = stakedBalance[msg.sender] > lockedStake[msg.sender]
            ? stakedBalance[msg.sender] - lockedStake[msg.sender]
            : 0;
        if (withdrawable > 0) {
            unstake(withdrawable);
        }
        claimReward();
    }

    // ──────────────────────────────────────────────
    //  FeeRouter Reward Inflow Hook
    // ──────────────────────────────────────────────

    /**
     * @notice Receives mUSDC real-yield interest from FeeRouter and notifies reward stream.
     * @param amount mUSDC reward amount
     * @param duration Duration in seconds over which the reward is distributed
     */
    function notifyRewardAmount(uint256 amount, uint256 duration)
        external
        nonReentrant
        updateReward(address(0))
    {
        require(amount > 0, "Zero reward amount");
        require(duration > 0, "Zero duration");

        // Pull tokens from sender if sender is FeeRouter/owner
        rewardToken.safeTransferFrom(msg.sender, address(this), amount);

        if (block.timestamp >= periodFinish) {
            rewardRate = amount / duration;
        } else {
            uint256 remaining = periodFinish - block.timestamp;
            uint256 leftover = remaining * rewardRate;
            rewardRate = (amount + leftover) / duration;
        }

        lastUpdateTime = block.timestamp;
        periodFinish = block.timestamp + duration;

        emit RewardAdded(amount, duration);
    }

    // ──────────────────────────────────────────────
    //  Supplier Tier Views & Lock Hooks
    // ──────────────────────────────────────────────

    /**
     * @notice Returns the supplier's active tier based on their staked INVX.
     * @return 0 = Bronze, 1 = Silver, 2 = Gold
     */
    function getSupplierTier(address supplier) public view returns (uint8) {
        uint256 bal = stakedBalance[supplier];
        if (bal >= goldThreshold) return 2;
        if (bal >= silverThreshold) return 1;
        return 0;
    }

    /**
     * @notice Returns fee discount in basis points for a supplier.
     *         Bronze = 0 bps, Silver = 100 bps (1%), Gold = 250 bps (2.5%)
     */
    function feeDiscountBps(address supplier) external view returns (uint256) {
        uint8 tier = getSupplierTier(supplier);
        if (tier == 2) return 250;
        if (tier == 1) return 100;
        return 0;
    }

    /**
     * @notice Returns maximum financing limit allowed for the supplier.
     */
    function financingLimit(address supplier) external view returns (uint256) {
        uint8 tier = getSupplierTier(supplier);
        if (tier == 2) return goldLimit;
        if (tier == 1) return silverLimit;
        return bronzeLimit;
    }

    /**
     * @notice Locks a supplier's stake so they cannot unstake below their tier while an invoice is active.
     * @dev Only callable by authorized contract (e.g. Invoice contract) or owner.
     */
    function lockSupplierStake(address supplier, uint256 minStakeRequired) external onlyAuthorized {
        if (stakedBalance[supplier] < minStakeRequired) revert InsufficientStake();
        lockedStake[supplier] = minStakeRequired;
        emit StakeLocked(supplier, minStakeRequired);
    }

    /**
     * @notice Unlocks a supplier's stake once the active invoice is repaid.
     */
    function unlockSupplierStake(address supplier) external onlyAuthorized {
        lockedStake[supplier] = 0;
        emit StakeUnlocked(supplier);
    }

    // ──────────────────────────────────────────────
    //  Admin Configuration
    // ──────────────────────────────────────────────

    function setAuthorizedLocker(address _locker) external onlyOwner {
        authorizedLocker = _locker;
        isAuthorizedLocker[_locker] = true;
        emit AuthorizedLockerUpdated(_locker, true);
    }

    function setAuthorizedLockerStatus(address _locker, bool _authorized) external onlyOwner {
        isAuthorizedLocker[_locker] = _authorized;
        if (!_authorized && authorizedLocker == _locker) {
            authorizedLocker = address(0);
        }
        emit AuthorizedLockerUpdated(_locker, _authorized);
    }

    function setTierThresholds(
        uint256 _silverThreshold,
        uint256 _goldThreshold,
        uint256 _bronzeLimit,
        uint256 _silverLimit,
        uint256 _goldLimit
    ) external onlyOwner {
        silverThreshold = _silverThreshold;
        goldThreshold = _goldThreshold;
        bronzeLimit = _bronzeLimit;
        silverLimit = _silverLimit;
        goldLimit = _goldLimit;
        emit TierThresholdsUpdated(_silverThreshold, _goldThreshold);
    }

    /**
     * @notice Direct reward rate setter for lab/testing simulation (e.g. 0.001 rate over 60s).
     */
    function setRewardRateDirect(uint256 _rewardRate, uint256 _duration)
        external
        onlyOwner
        updateReward(address(0))
    {
        rewardRate = _rewardRate;
        lastUpdateTime = block.timestamp;
        periodFinish = block.timestamp + _duration;
    }
}
