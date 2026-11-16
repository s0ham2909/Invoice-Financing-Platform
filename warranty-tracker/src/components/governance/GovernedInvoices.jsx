import { useState } from "react";
import { ethers } from "ethers";

export default function GovernedInvoices({ data, contracts, account, run, disabled }) {
  const [number, setNumber] = useState("");
  const [amount, setAmount] = useState("0.01");
  const [days, setDays] = useState("1");
  const [error, setError] = useState("");
  const same = address => address.toLowerCase() === account.toLowerCase();
  async function mint(e) {
    e.preventDefault(); setError("");
    try {
      if (!/^\d+$/.test(days) || Number(days) < 1 || Number(days) > 365) throw new Error("Choose 1–365 days.");
      if (ethers.parseEther(amount) <= 0n) throw new Error("Invoice amount must be positive.");
      if (await run(contracts.invoices, "mintInvoice", [account, number.trim(), ethers.parseEther(amount), Number(days), ""])) setNumber("");
    } catch (err) { setError(err.shortMessage || err.message); }
  }
  async function stake() {
    if (await run(contracts.invx, "approve", [contracts.staking.target, ethers.parseEther("1000")])) {
      await run(contracts.staking, "stake", [ethers.parseEther("1000")]);
    }
  }
  return <div className="space-y-5">
    <div className="bg-white border rounded-xl p-5 space-y-3">
      <h3 className="text-xl font-bold">Invoice financing controlled by this DAO</h3>
      <p>Financing fee: <strong>{data.fee / 100}%</strong>. Borrowers receive principal and repay principal. Investors pay the fee separately to the treasury.</p>
      <p>Your balance: {data.invxBalance} INVX · Deposited collateral: {data.stake} INVX</p>
      <p className="text-sm text-gray-600">Deposit collateral before an investor finances your invoice. Deposited collateral stays locked until all your loans are repaid. A DAO penalty deducts INVX; it does not repay an ETH loan.</p>
      <div className="flex flex-wrap gap-3">
        <button disabled={disabled || ethers.parseEther(data.invxBalance) < ethers.parseEther("1000")} onClick={stake} className="bg-indigo-600 text-white rounded px-4 py-2 disabled:opacity-40">Approve and deposit 1,000 INVX (2 transactions)</button>
        <button disabled={disabled || ethers.parseEther(data.stake) === 0n} onClick={() => run(contracts.staking, "unstake", [ethers.parseEther(data.stake)])} className="border rounded px-4 py-2 disabled:opacity-40">Withdraw deposited collateral</button>
      </div>
    </div>
    <form onSubmit={mint} className="bg-white border rounded-xl p-5 flex flex-wrap items-end gap-4">
      <label>Invoice reference<input className="block border rounded p-2" value={number} onChange={e => setNumber(e.target.value)} maxLength={100} required /></label>
      <label>Principal (ETH)<input className="block border rounded p-2" value={amount} onChange={e => setAmount(e.target.value)} required /></label>
      <label>Due in days<input className="block border rounded p-2" type="number" min="1" max="365" value={days} onChange={e => setDays(e.target.value)} required /></label>
      <button disabled={disabled} className="bg-indigo-600 text-white rounded px-4 py-2 disabled:opacity-40">Create invoice</button>
      {error && <p className="text-red-700 w-full" role="alert">{error}</p>}
    </form>
    {data.invoices.length === 0 && <p>No invoices yet. Create one using a borrower wallet.</p>}
    {data.invoices.map(inv => <div key={inv.id} className="border rounded-xl bg-white p-5 space-y-2">
      <h4 className="font-bold">#{inv.id} · {inv.number} · {ethers.formatEther(inv.amount)} ETH</h4>
      <p className="break-all text-sm">Borrower: {inv.borrower}</p>
      {inv.financed && <p className="break-all text-sm">Investor: {inv.investor}</p>}
      <p>Due: {new Date(inv.dueDate * 1000).toLocaleString()} · {inv.repaid ? "Repaid" : inv.financed ? (inv.dueDate < data.blockTimestamp ? "Overdue and unpaid" : "Awaiting repayment") : "Awaiting financing"}{inv.penalized ? " · Collateral penalty executed" : ""}</p>
      {!inv.financed && !same(inv.borrower) && inv.dueDate > data.blockTimestamp && <button disabled={disabled} onClick={() => run(contracts.invoices, "financeInvoice", [inv.id, { value: inv.cost }])} className="bg-green-700 text-white rounded px-4 py-2 disabled:opacity-40">Finance for {ethers.formatEther(inv.cost)} ETH including fee</button>}
      {inv.financed && !inv.repaid && same(inv.borrower) && <button disabled={disabled} onClick={() => run(contracts.invoices, "repayInvoice", [inv.id, { value: inv.amount }])} className="bg-amber-600 text-white rounded px-4 py-2 disabled:opacity-40">Repay {ethers.formatEther(inv.amount)} ETH</button>}
    </div>)}
  </div>;
}
