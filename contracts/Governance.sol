// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IVotes} from "@openzeppelin/contracts/governance/utils/IVotes.sol";

/**
 * @title Governance - DeFiSpace DAO Core Governance Contract
 * @notice Weighted snapshot voting for financing fees and collateral default penalties.
 * @dev Enforces block-based voting power snapshots via IVotes (DTEST), timelock execution,
 *      target/selector whitelisting, proposal-type constraints, and emergency guardian veto.
 */
contract Governance is ReentrancyGuard, Ownable {
    // ──────────────────────── Enums ────────────────────────

    enum ProposalType {
        DEFAULT_PENALTY, // 0: Penalize defaulting debtor / slash stake
        PARAM_CHANGE,    // 1: Change platform parameters (fees, bounds, duration)
        INVOICE_DISPUTE, // Reserved ABI value; rejected in this simplified implementation
        WHITELIST        // Reserved ABI value; rejected in this simplified implementation
    }

    enum ProposalState {
        Pending,   // Voting delay not yet passed (block.number <= snapshotBlock)
        Active,    // Voting is currently active
        Defeated,  // Quorum not reached OR votesAgainst >= votesFor
        Succeeded, // Passed quorum and majority; ready to queue within queueWindow
        Queued,    // Queued in timelock; waiting for timelock delay to elapse
        Executed,  // Execution completed on target contract
        Cancelled, // Cancelled by proposer (before voting ends) or vetoed by guardian
        Expired    // Passed queueWindow or gracePeriod without being queued/executed
    }

    enum VoteSupport {
        Against, // 0
        For,     // 1
        Abstain  // 2
    }

    // ──────────────────────── Structs ────────────────────────

    struct Proposal {
        uint256 id;
        address proposer;
        ProposalType proposalType;
        string description;
        address target;
        bytes data;
        uint256 snapshotBlock;
        uint256 startTime;
        uint256 deadline;
        uint256 eta;
        uint256 votesFor;
        uint256 votesAgainst;
        uint256 votesAbstain;
        bool canceled;
        bool executed;
    }

    struct GovernanceParams {
        uint256 proposalThreshold;   // Minimum voting power required to submit a proposal
        uint256 votingDelayBlocks;   // Reserved: must be zero; snapshot is the previous completed block
        uint256 votingPeriodSeconds; // Duration of active voting window in seconds
        uint256 quorumBps;           // Quorum in basis points (e.g. 400 = 4% of past total supply)
        uint256 majorityBps;         // Majority requirement in bps (e.g. 5001 = >50%)
        uint256 timelockDelay;       // Execution delay in seconds once queued
        uint256 queueWindow;         // Window after voting deadline to queue a Succeeded proposal
        uint256 gracePeriod;         // Window after timelock during which proposal can be executed
    }

    // ──────────────────────── State Variables ────────────────────────

    IVotes public immutable token;
    GovernanceParams public params;
    bool public permissionsSealed;
    /// @notice Permanently close bootstrap allowlist administration. Guardian veto remains available.
    function sealPermissions() external onlyOwner { permissionsSealed = true; }

    uint256 private _proposalIdTracker;
    mapping(uint256 => Proposal) public proposals;
    mapping(uint256 => mapping(address => bool)) public hasVoted;
    mapping(uint256 => mapping(address => uint256)) public voterWeight;

    /// @notice Whitelisted target contracts: target => allowed
    mapping(address => bool) public whitelistedTargets;

    /// @notice Whitelisted function selectors per target: target => selector => allowed
    mapping(address => mapping(bytes4 => bool)) public allowedSelectors;

    /// @notice Allowed selectors per proposal type: proposalType => selector => allowed
    mapping(address => mapping(bytes4 => mapping(ProposalType => bool))) public typedSelectors;
    mapping(uint256 => GovernanceParams) public proposalParams;

    // ──────────────────────── Events ────────────────────────

    event ProposalCreated(
        uint256 indexed proposalId,
        address indexed proposer,
        ProposalType proposalType,
        address target,
        uint256 snapshotBlock,
        uint256 startTime,
        uint256 deadline,
        string description
    );

    event VoteCast(
        address indexed voter,
        uint256 indexed proposalId,
        VoteSupport support,
        uint256 weight
    );

    event ProposalQueued(uint256 indexed proposalId, uint256 eta);
    event ProposalExecuted(uint256 indexed proposalId);
    event ProposalCancelled(uint256 indexed proposalId);
    event ProposalVetoed(uint256 indexed proposalId, address indexed guardian);
    event GovernanceParamsUpdated(GovernanceParams newParams);
    event TargetWhitelisted(address indexed target, bool allowed);
    event SelectorWhitelisted(
        address indexed target,
        bytes4 indexed selector,
        ProposalType indexed proposalType,
        bool allowed
    );

    // ──────────────────────── Custom Errors ────────────────────────

    error BelowProposalThreshold(uint256 votes, uint256 threshold);
    error InvalidState(ProposalState expected, ProposalState actual);
    error AlreadyVoted(uint256 proposalId, address voter);
    error ZeroVotingPower(address voter, uint256 snapshotBlock);
    error TimelockNotMet(uint256 currentTime, uint256 eta);
    error ProposalExpired(uint256 currentTime, uint256 expirationTime);
    error ExecutionFailed(bytes returnData);
    error TargetNotWhitelisted(address target);
    error TargetHasNoCode(address target);
    error SelectorNotAllowed(address target, bytes4 selector);
    error SelectorTypeMismatch(ProposalType proposalType, bytes4 selector);
    error ProposerCannotCancelAfterVoting();
    error CannotCancelExecuted();
    error EmptyDescription();
    error Unauthorized();
    error InvalidParameters();

    // ──────────────────────── Modifiers ────────────────────────

    modifier onlyGovernance() {
        if (msg.sender != address(this)) revert Unauthorized();
        _;
    }

    // ──────────────────────── Constructor ────────────────────────

    constructor(
        address _token,
        GovernanceParams memory _params,
        address _initialOwner
    ) Ownable(_initialOwner) {
        require(_token != address(0), "Governance: token cannot be zero");
        token = IVotes(_token);
        _validateParams(_params);
        params = _params;
    }

    // ──────────────────────── Target & Selector Whitelisting ────────────────────────

    /**
     * @notice Authorize or revoke a platform contract address as a callable target.
     */
    function setTargetWhitelisted(address target, bool allowed) external {
        if (permissionsSealed) revert Unauthorized();
        if (msg.sender != owner() && msg.sender != address(this)) {
            revert Unauthorized();
        }
        whitelistedTargets[target] = allowed;
        emit TargetWhitelisted(target, allowed);
    }

    /**
     * @notice Authorize a function selector for a specific target and bind it to a ProposalType.
     */
    function setTargetSelector(
        address target,
        bytes4 selector,
        ProposalType proposalType,
        bool allowed
    ) external {
        if (permissionsSealed) revert Unauthorized();
        if (msg.sender != owner() && msg.sender != address(this)) {
            revert Unauthorized();
        }
        allowedSelectors[target][selector] = allowed;
        typedSelectors[target][selector][proposalType] = allowed;
        emit SelectorWhitelisted(target, selector, proposalType, allowed);
    }

    // ──────────────────────── Core Governance Functions ────────────────────────

    /**
     * @notice Propose a governance action.
     * @dev Uses `token.getPastVotes(msg.sender, block.number - 1)` to prevent flash-loan attacks.
     */
    function propose(
        ProposalType proposalType,
        string calldata description,
        address target,
        bytes calldata data
    ) external returns (uint256) {
        if (bytes(description).length == 0) revert EmptyDescription();
        if (bytes(description).length > 2000 || data.length < 4 || data.length > 4096 || uint8(proposalType) > 1) revert InvalidParameters();
        if (!whitelistedTargets[target]) revert TargetNotWhitelisted(target);
        if (target.code.length == 0) revert TargetHasNoCode(target);

        bytes4 selector = bytes4(data);
        if (!allowedSelectors[target][selector]) revert SelectorNotAllowed(target, selector);
        if (!typedSelectors[target][selector][proposalType]) {
            revert SelectorTypeMismatch(proposalType, selector);
        }

        // Flash-loan protection: must have held voting power at block.number - 1
        uint256 proposerPower = token.getPastVotes(msg.sender, block.number - 1);
        if (proposerPower < params.proposalThreshold) {
            revert BelowProposalThreshold(proposerPower, params.proposalThreshold);
        }

        uint256 proposalId = ++_proposalIdTracker;
        uint256 snapshotBlock = block.number - 1;
        proposalParams[proposalId] = params;

        uint256 startTime = block.timestamp;
        uint256 deadline = startTime + params.votingPeriodSeconds;

        Proposal storage p = proposals[proposalId];
        p.id = proposalId;
        p.proposer = msg.sender;
        p.proposalType = proposalType;
        p.description = description;
        p.target = target;
        p.data = data;
        p.snapshotBlock = snapshotBlock;
        p.startTime = startTime;
        p.deadline = deadline;

        emit ProposalCreated(
            proposalId,
            msg.sender,
            proposalType,
            target,
            snapshotBlock,
            startTime,
            deadline,
            description
        );

        return proposalId;
    }

    /**
     * @notice Cast a vote on an active proposal.
     * @dev Voting is only allowed once block.number > proposal.snapshotBlock and block.timestamp <= deadline.
     */
    function castVote(uint256 proposalId, VoteSupport support) external returns (uint256) {
        ProposalState currentState = state(proposalId);
        if (currentState != ProposalState.Active) {
            revert InvalidState(ProposalState.Active, currentState);
        }

        if (hasVoted[proposalId][msg.sender]) {
            revert AlreadyVoted(proposalId, msg.sender);
        }

        Proposal storage proposal = proposals[proposalId];
        uint256 weight = token.getPastVotes(msg.sender, proposal.snapshotBlock);
        if (weight == 0) {
            revert ZeroVotingPower(msg.sender, proposal.snapshotBlock);
        }

        hasVoted[proposalId][msg.sender] = true;
        voterWeight[proposalId][msg.sender] = weight;

        if (support == VoteSupport.Against) {
            proposal.votesAgainst += weight;
        } else if (support == VoteSupport.For) {
            proposal.votesFor += weight;
        } else if (support == VoteSupport.Abstain) {
            proposal.votesAbstain += weight;
        }

        emit VoteCast(msg.sender, proposalId, support, weight);
        return weight;
    }

    /**
     * @notice Queue a succeeded proposal into the timelock.
     */
    function queue(uint256 proposalId) external {
        ProposalState currentState = state(proposalId);
        if (currentState != ProposalState.Succeeded) {
            revert InvalidState(ProposalState.Succeeded, currentState);
        }

        Proposal storage proposal = proposals[proposalId];
        proposal.eta = block.timestamp + proposalParams[proposalId].timelockDelay;

        emit ProposalQueued(proposalId, proposal.eta);
    }

    /**
     * @notice Execute a queued proposal whose timelock delay has elapsed.
     * @dev Re-verifies that target is still whitelisted, selector is allowed, and target has code.
     */
    function execute(uint256 proposalId) external nonReentrant {
        ProposalState currentState = state(proposalId);
        if (currentState != ProposalState.Queued) {
            revert InvalidState(ProposalState.Queued, currentState);
        }

        Proposal storage proposal = proposals[proposalId];
        if (block.timestamp < proposal.eta) {
            revert TimelockNotMet(block.timestamp, proposal.eta);
        }
        if (block.timestamp > proposal.eta + proposalParams[proposalId].gracePeriod) {
            revert ProposalExpired(block.timestamp, proposal.eta + proposalParams[proposalId].gracePeriod);
        }

        // Re-check target and selector at execution time
        if (!whitelistedTargets[proposal.target]) revert TargetNotWhitelisted(proposal.target);
        if (proposal.target.code.length == 0) revert TargetHasNoCode(proposal.target);
        bytes4 selector = bytes4(proposal.data);
        if (!allowedSelectors[proposal.target][selector]) {
            revert SelectorNotAllowed(proposal.target, selector);
        }

        if (!typedSelectors[proposal.target][selector][proposal.proposalType]) {
            revert SelectorTypeMismatch(proposal.proposalType, selector);
        }
        proposal.executed = true;

        (bool success, bytes memory returnData) = proposal.target.call(proposal.data);
        if (!success) {
            revert ExecutionFailed(returnData);
        }

        emit ProposalExecuted(proposalId);
    }

    /**
     * @notice Cancel a proposal.
     * @dev Proposer may only cancel during Pending or Active states (before voting ends).
     *      Contract owner acts as guardian and may veto/cancel at any time prior to execution.
     */
    function cancel(uint256 proposalId) external {
        Proposal storage proposal = proposals[proposalId];
        ProposalState currentState = state(proposalId);

        if (
            currentState == ProposalState.Executed ||
            currentState == ProposalState.Cancelled ||
            currentState == ProposalState.Expired
        ) {
            revert CannotCancelExecuted();
        }

        if (msg.sender == proposal.proposer) {
            if (currentState != ProposalState.Pending && currentState != ProposalState.Active) {
                revert ProposerCannotCancelAfterVoting();
            }
            proposal.canceled = true;
            emit ProposalCancelled(proposalId);
        } else if (msg.sender == owner()) {
            proposal.canceled = true;
            emit ProposalVetoed(proposalId, msg.sender);
            emit ProposalCancelled(proposalId);
        } else {
            revert Unauthorized();
        }
    }

    /**
     * @notice Get current proposal state.
     */
    function state(uint256 proposalId) public view returns (ProposalState) {
        Proposal storage proposal = proposals[proposalId];
        if (proposal.id == 0) revert InvalidParameters();
        if (proposal.canceled) return ProposalState.Cancelled;
        if (proposal.executed) return ProposalState.Executed;

        // Pending until block.number is strictly greater than snapshotBlock
        if (block.number <= proposal.snapshotBlock) {
            return ProposalState.Pending;
        }

        // Active while within voting window
        if (block.timestamp <= proposal.deadline) {
            return ProposalState.Active;
        }

        // Voting window ended: check Queued status
        if (proposal.eta > 0) {
            if (block.timestamp > proposal.eta + proposalParams[proposalId].gracePeriod) {
                return ProposalState.Expired;
            }
            return ProposalState.Queued;
        }

        // Check Quorum and Majority
        uint256 pastTotalSupply = token.getPastTotalSupply(proposal.snapshotBlock);
        uint256 quorumVotes = (pastTotalSupply * proposalParams[proposalId].quorumBps) / 10000;
        uint256 totalParticipated = proposal.votesFor + proposal.votesAgainst + proposal.votesAbstain;

        if (totalParticipated < quorumVotes) {
            return ProposalState.Defeated;
        }

        uint256 nonAbstainVotes = proposal.votesFor + proposal.votesAgainst;
        if (nonAbstainVotes == 0) {
            return ProposalState.Defeated;
        }

        uint256 forRatioBps = (proposal.votesFor * 10000) / nonAbstainVotes;
        if (forRatioBps >= proposalParams[proposalId].majorityBps && proposal.votesFor > proposal.votesAgainst) {
            // Check if queueWindow has elapsed
            if (block.timestamp > proposal.deadline + proposalParams[proposalId].queueWindow) {
                return ProposalState.Expired;
            }
            return ProposalState.Succeeded;
        }

        return ProposalState.Defeated;
    }

    /**
     * @notice Update governance parameters via executed proposal.
     */
    function updateGovernanceParams(GovernanceParams calldata newParams) external onlyGovernance {
        _validateParams(newParams);
        params = newParams;
        emit GovernanceParamsUpdated(newParams);
    }

    function getProposal(uint256 proposalId) external view returns (Proposal memory) {
        return proposals[proposalId];
    }

    function proposalCount() external view returns (uint256) {
        return _proposalIdTracker;
    }

    // ──────────────────────── Internal Validation ────────────────────────

    function _validateParams(GovernanceParams memory p) internal pure {
        if (p.proposalThreshold == 0 || p.proposalThreshold > 100_000_000 * 1e18) revert InvalidParameters();
        if (p.votingDelayBlocks != 0) revert InvalidParameters();
        if (p.votingPeriodSeconds < 10 || p.votingPeriodSeconds > 30 days) revert InvalidParameters();
        if (p.quorumBps < 100 || p.quorumBps > 5000) revert InvalidParameters();
        if (p.majorityBps < 5000 || p.majorityBps > 10000) revert InvalidParameters();
        if (p.timelockDelay < 10 || p.timelockDelay > 14 days) revert InvalidParameters();
        if (p.queueWindow < 60 || p.queueWindow > 30 days) revert InvalidParameters();
        if (p.gracePeriod < 60 || p.gracePeriod > 30 days) revert InvalidParameters();
    }
}
