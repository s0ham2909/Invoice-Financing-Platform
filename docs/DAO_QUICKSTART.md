# DeFiSpace DAO: launch and demonstration

## What this version does

The DAO supports two binding actions:

1. Change the ETH invoice financing fee (0.1% to 10%).
2. Deduct deposited INVX collateral from an overdue, unpaid supplier, once per invoice.

Use **DAO Governance → Invoices & collateral** for invoices controlled by the DAO. These use newly deployed contracts. The older Invoice Financing, Vault, Warranty, AMM and oracle experiments keep their existing Sepolia addresses and are separate. They are not silently migrated or governed by these new contracts.

Refunds, dispute settlement, issuer/token whitelists, advance-rate changes and interest-rate governance have been removed from this DAO to keep the implementation small and honest. DAO loans repay principal; investors pay a separate financing fee to the treasury. A collateral penalty transfers INVX, not ETH, and does not repay the loan.

## 1. Start a persistent local blockchain

Open a PowerShell terminal in the project:

```powershell
Set-Location 'E:\Desktop\CBD minproject'
npm.cmd run node:local
```

Leave this terminal open. It should report a JSON-RPC server at `http://127.0.0.1:8545`. The demo configuration mines blocks every second, allowing voting and timelock countdowns to progress even without transactions.

The terminal lists local test accounts and their private keys. Only use these keys for this local demo. They are publicly known Hardhat test accounts; never fund them with real assets or import them as your normal wallet.

If port 8545 is already occupied by a local Hardhat node, use that node or stop it before launching this one. Avoid running two local nodes on different ports accidentally.

## 2. Deploy the DAO and its invoice contracts

Open a **second** PowerShell terminal:

```powershell
Set-Location 'E:\Desktop\CBD minproject'
npm.cmd run deploy:gov
```

Wait for `Deployment verified`. The command deploys fresh DTEST, INVX, MockUSDC, ReserveStaking, InvoiceNFT, Governance and PlatformConfig contracts on the local chain. It verifies ownership, collateral permissions, matching fees, deployed code, and sealed voting-token supply before exporting addresses and ABIs.

It does not use or overwrite the existing Sepolia experiment deployment. Local configuration is written to `warranty-tracker/src/config/governanceDeployment.json` and `deployments/governance-local.json`.

Do not run the deployment script without `--network localhost`: a temporary in-process deployment would disappear when the command exits. The npm command already supplies the correct network.

## 3. Start the frontend

Open a **third** PowerShell terminal:

```powershell
Set-Location 'E:\Desktop\CBD minproject\warranty-tracker'
npm.cmd run dev -- --host 127.0.0.1
```

Open the URL printed by Vite. It is normally `http://127.0.0.1:5173`, but Vite chooses another port if that one is occupied. Leave this terminal open too.

If dependencies are missing after copying the project to another computer, first run `npm.cmd ci` in both the project root and `warranty-tracker`. This requires internet access. Solidity compilation uses the pinned local npm solc compiler (0.8.26, compatible with the contracts' `^0.8.24` pragma), so it does not need to download a compiler separately.

## 4. Set up MetaMask

1. Open MetaMask and add a custom network with these values:

   | Field | Value |
   |---|---|
   | Network name | DeFiSpace Local |
   | RPC URL | `http://127.0.0.1:8545` |
   | Chain ID | `31337` |
   | Currency symbol | `ETH` |
   | Block explorer | Leave blank |

2. Import the keys for Hardhat **Account #1, Account #2 and Account #3** from the blockchain terminal into a dedicated test wallet/profile. Account numbering begins at #0.
3. Rename the imported accounts Alice, Bob and Charlie for clarity.
4. Open the app, choose **Connect MetaMask**, and allow those test accounts to connect. Account switching only reaches the app if the selected account has permission to connect to the site.
5. Select Alice and open **DAO Governance**. If asked, use **Switch to DAO network**.

| Role | Hardhat account | Address | Initial DTEST | Initial INVX |
|---|---|---|---:|---:|
| Alice: proposer / borrower | #1 | `0x70997970C51812dc3A010C7d01b50e0d17dc79C8` | 50,000 | 2,000 |
| Bob: voter / investor | #2 | `0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC` | 20,000 | 2,000 |
| Charlie: voter | #3 | `0x90F79bf6EB2c4f870365E785982E1f101E93b906` | 20,000 | 2,000 |

Local members are already self-delegated. The **Voting power** tab lets you inspect or change delegation. Tokens transferred after deployment do not automatically delegate; a new holder should self-delegate before a future proposal is created.

## 5. Demonstrate a fee proposal

1. As Alice, select **Create proposal**.
2. Choose **Change financing fee**. Enter `150` basis points, which means 1.5%.
3. Enter a reason, such as `Change the platform financing fee to 1.5 percent`.
4. Submit and confirm in MetaMask. The app returns to the proposal list.
5. Vote **For** as Alice and confirm. The card shows that Alice has voted, with 50,000 snapshot votes. Voting buttons disappear for Alice.
6. Switch MetaMask to Bob. Allow a few seconds for the app to refresh. Bob has 20,000 snapshot votes. Vote **Against**, or **Abstain**, and confirm.
7. After the three-minute voting deadline, the proposal should show **Succeeded**: Alice's 50,000 For votes exceed Bob's 20,000 Against votes and meet the 40,000 quorum.
8. Click **Queue in Timelock** and confirm. This is a separate transaction.
9. Wait 60 seconds. The execution button is disabled until the on-chain timelock ends.
10. Click **Execute Proposal on Blockchain** and confirm. The card becomes **Executed**, and the financing fee changes to **1.5%**.

For a faster LOCAL demonstration only, use the following in another PowerShell terminal instead of waiting three minutes:

```powershell
Set-Location 'E:\Desktop\CBD minproject'
$env:DEMO_SECONDS = '181'
npm.cmd run demo:default
Remove-Item Env:DEMO_SECONDS
```

Queue the proposal, then repeat with `DEMO_SECONDS = '61'` to advance its timelock. Click **Refresh** if the screen has not updated. These commands refuse to run on Sepolia.

## 6. Demonstrate financing, default and penalty

Finish the fee demonstration first, so advancing a day does not expire a proposal you are still using.

1. Switch to Alice and open **Invoices & collateral**.
2. Click **Approve and deposit 1,000 INVX**. Confirm **two transactions**: token approval, then staking. Wait for deposited collateral to show 1,000 INVX.
3. Create an invoice:
   - Reference: `INV-DEMO-001`
   - Principal: `0.01` ETH
   - Due in days: `1`
4. Switch to Bob. Click **Finance for ... ETH including fee** and confirm. Alice receives 0.01 ETH; the fee is sent separately to the treasury. Alice's collateral is now locked.
5. Switch back to Alice. Trying **Withdraw deposited collateral** while the loan is unpaid should produce `StakeIsLocked` without changing balances.
6. Simulate the default using the root terminal:

```powershell
Set-Location 'E:\Desktop\CBD minproject'
npm.cmd run demo:default
```

With no `DEMO_SECONDS` override, this advances the LOCAL chain by 86,401 seconds. The invoice should become **Overdue and unpaid**.

7. As Alice, select **Create proposal → Penalize an unpaid default**.
8. Select the overdue invoice (the first invoice has ID **0**). Enter `300` INVX and a reason.
9. Submit, vote For, wait or advance 181 seconds, queue, wait or advance 61 seconds, then execute.
10. Under **Invoices & collateral**, Alice's deposited collateral should now be **700 INVX**, and the invoice should show **Collateral penalty executed**. The treasury received 300 INVX.
11. The invoice remains unpaid. Repay its 0.01 ETH principal as Alice to demonstrate repayment and unlocking the remaining collateral. Bob receives the repayment.

An invoice can be penalized only once. Repayment before a penalty executes makes execution fail, even if the proposal passed. A passed vote cannot override the unpaid-default checks.

## 7. Suggested screenshots

1. DAO summary with voting power, current fee and quorum.
2. Proposal showing the exact executable action and Alice's vote.
3. Bob's Against vote and the weighted totals.
4. Queued proposal with disabled timelock button.
5. Executed proposal and updated 1.5% fee.
6. Financed invoice and 1,000 INVX deposited collateral.
7. Executed default penalty and remaining 700 INVX.
8. Repaid invoice and successful collateral withdrawal.

## 8. Checks and troubleshooting

```powershell
Set-Location 'E:\Desktop\CBD minproject'
npm.cmd run compile
npm.cmd test
Set-Location '.\warranty-tracker'
npm.cmd run lint
npm.cmd run build
```

- **Missing contracts / deployment mismatch:** restarting the local node clears its state. Run `npm.cmd run deploy:gov` again, then reload the frontend. Never use addresses from the previous node session.
- **Nonce too high / pending transactions after restarting the node:** use MetaMask's activity/nonce reset for the imported LOCAL test account, then reconnect. Do not reset or replace your real wallet.
- **No voting power:** select a seeded account. If using a new account, obtain DTEST from an existing member and self-delegate before creating the proposal. Delegation after a proposal's snapshot only affects future proposals.
- **No overdue invoice in proposal form:** first finance an invoice, leave it unpaid, and advance the LOCAL chain beyond its due date. Empty or unfinanced invoices cannot be penalized.
- **ExecutionFailed:** inspect the decoded error. The invoice may have been repaid, already penalized, or the requested amount may exceed remaining collateral. No partial penalty is recorded if execution fails.
- **Earlier experiments unavailable locally:** they use the original Sepolia contracts. Use their network-switch button; keep the DAO invoice demonstration in the DAO workspace.

## Optional: deploy this DAO workspace to Sepolia

Local demonstration requires no Sepolia ETH. Sepolia is a separate optional deployment; no public-network transactions were sent while implementing this change.

1. Prepare three distinct Sepolia wallet addresses that you control. Each needs a little Sepolia ETH to delegate and transact.
2. Configure the deployer credentials locally in your existing `.env` (`PRIVATE_KEY` and `SEPOLIA_RPC_URL`). Do not paste any private key or recovery phrase into chat or commit `.env`.
3. Set the members in PowerShell. Replace the example labels with your actual public addresses:

```powershell
Set-Location 'E:\Desktop\CBD minproject'
$env:GOVERNANCE_MEMBERS = '["ALICE_PUBLIC_ADDRESS","BOB_PUBLIC_ADDRESS","CHARLIE_PUBLIC_ADDRESS"]'
npm.cmd run deploy:gov:sepolia
Remove-Item Env:GOVERNANCE_MEMBERS
```

4. Wait for verified deployment, then restart/reload Vite. Its DAO configuration now points to the new Sepolia contracts. Existing experiment addresses are unchanged.
5. Connect each member wallet on Sepolia and select **Voting power → Activate / Self-Delegate Votes**. Unlike the local accounts, the script cannot sign delegation transactions for your personal wallets.
6. Use the new DAO workspace to create invoices and proposals. Actual Sepolia time must pass; the local time-advance helper cannot be used there. A one-day invoice default requires waiting for its due date.

The deployer retains 91% of DTEST and acts as a cancellation guardian. Voting-token minting, execution permissions and collateral authorization are sealed after deployment. INVX remains a faucet-enabled test token. The demo requires positive deposited collateral but does not value it against the ETH loan or enforce a loan-to-value ratio. These are transparent academic-demo assumptions, not a production deployment or security audit.
