// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {DTEST} from "../DTEST.sol";
import {Governance} from "../Governance.sol";

contract FlashLoanAttacker {
    DTEST public immutable token;
    Governance public immutable governance;

    constructor(address _token, address _governance) {
        token = DTEST(_token);
        governance = Governance(_governance);
    }

    /**
     * @notice Simulates a flash-loan: attacker receives tokens in this block,
     * delegates, and attempts to submit a proposal within the same transaction.
     */
    function executeFlashLoanAndPropose(address target) external {
        // Self-delegate in the current block
        token.delegate(address(this));

        // Attempt to create a proposal in the same block/transaction
        governance.propose(
            Governance.ProposalType.DEFAULT_PENALTY,
            "Flash loan attack",
            target,
            hex"12345678"
        );
    }
}
