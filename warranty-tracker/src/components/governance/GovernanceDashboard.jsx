import { useState } from "react";
import { useGovernance } from "../../hooks/useGovernance";
import { useWallet } from "../../context/WalletContext";
import { GOVERNANCE_CHAIN_ID, GOVERNANCE_DEPLOYMENT } from "../../config/governanceConfig";
import ProposalCard from "./ProposalCard";
import CreateProposalForm from "./CreateProposalForm";
import DelegatePanel from "./DelegatePanel";
import GovernedInvoices from "./GovernedInvoices";

export default function GovernanceDashboard() {
  const { account, chainId, contracts, data, error, actionError, status, actionPending, run, refetch } = useGovernance();
  const { switchNetwork } = useWallet();
  const [tab, setTab] = useState("proposals");
  const [switchError, setSwitchError] = useState("");
  async function switchChain() { try { await switchNetwork(GOVERNANCE_CHAIN_ID); } catch (err) { setSwitchError(err.message); } }
  return <section className="max-w-6xl mx-auto p-4 md:p-8 space-y-5">
    <div className="bg-indigo-950 text-white rounded-2xl p-6">
      <h2 className="text-3xl font-bold">DeFiSpace DAO</h2>
      <p className="mt-2">Vote on financing fees and collateral penalties. DTEST gives voting power; INVX is supplier collateral.</p>
      <p className="mt-2 text-sm">Network: {GOVERNANCE_CHAIN_ID === 31337 ? "Local Hardhat" : "Sepolia"} · Voting window: 3 minutes · Execution delay: {data?.timelockDelay ?? 60} seconds</p>
    </div>
    {chainId !== GOVERNANCE_CHAIN_ID ? <div className="border rounded-xl bg-amber-50 p-6 space-y-3"><p>Your wallet is on chain {chainId ?? "unknown"}. This DAO workspace uses chain {GOVERNANCE_CHAIN_ID}.</p><button onClick={switchChain} className="bg-indigo-600 text-white rounded px-4 py-2">Switch to DAO network</button>{switchError && <p role="alert">{switchError}</p>}</div> : <>
      <div className="flex flex-wrap gap-3">{[["proposals", "Proposals"], ["create", "Create proposal"], ["delegate", "Voting power"], ["invoices", "Invoices & collateral"]].map(([key, text]) => <button key={key} onClick={() => setTab(key)} className={`rounded px-4 py-2 ${key === tab ? "bg-indigo-600 text-white" : "bg-white border"}`}>{text}</button>)}<button onClick={refetch} disabled={actionPending} className="rounded border px-4 py-2">Refresh</button></div>
      {(error || actionError) && <p role="alert" className="bg-red-50 border border-red-200 text-red-800 rounded p-4 break-words">{error || actionError}</p>}
      {status && <p role="status" className="bg-blue-50 rounded p-4 break-all">{status}</p>}
      {!data && !error && <p>Loading verified DAO contracts. If not deployed, run npm run deploy:gov.</p>}
      {data && <>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">{[["Your voting power", `${data.votingPower} DTEST`], ["Current quorum", `${data.quorum} votes`], ["Financing fee", `${data.fee / 100}%`], ["Proposals", data.proposals.length]].map(([title, value]) => <div className="bg-white rounded border p-4" key={title}><p className="text-sm text-gray-500">{title}</p><strong>{value}</strong></div>)}</div>
        {tab === "proposals" && (data.proposals.length ? data.proposals.map(p => <ProposalCard key={p.id} proposal={p} account={account} guardian={data.guardian} blockTimestamp={data.blockTimestamp} actionPending={actionPending || !!error}
          castVote={(id, support) => run(contracts.gov, "castVote", [id, support])} queue={id => run(contracts.gov, "queue", [id])} execute={id => run(contracts.gov, "execute", [id])} cancel={id => run(contracts.gov, "cancel", [id])} />) : <p>No proposals yet. Create a fee-change proposal to try voting.</p>)}
        {tab === "create" && <CreateProposalForm data={data} contracts={contracts} run={run} disabled={actionPending || !!error} onSuccess={() => setTab("proposals")} />}
        {tab === "delegate" && <DelegatePanel account={account} tokenBalance={data.tokenBalance} votingPower={data.votingPower} delegatee={data.delegatee} actionPending={actionPending || !!error} delegate={address => run(contracts.token, "delegate", [address])} />}
        {tab === "invoices" && <GovernedInvoices data={data} contracts={contracts} account={account} run={run} disabled={actionPending || !!error} />}
        <details className="border rounded p-4 text-sm"><summary>Demo wallets and rules</summary><p>Quorum counts For, Against and Abstain. For must exceed Against. A proposal needs a queue transaction and, after the delay, an execution transaction. Fees go to treasury; a penalty transfers deposited INVX to treasury. Refunds, issuer/token whitelists and interest changes are outside this simplified DAO.</p><p className="mt-2">The deployer retains 91% of DTEST and acts as a cancellation guardian. This is a controlled academic demo.</p>{GOVERNANCE_DEPLOYMENT.members.map((member, i) => <p key={member} className="break-all">Member {i + 1}: {member} ({i === 0 ? "50,000" : "20,000"} DTEST)</p>)}</details>
      </>}
    </>}
  </section>;
}
