import { useState } from "react";
import { ethers } from "ethers";

export default function CreateProposalForm({ data, contracts, run, disabled, onSuccess }) {
  const [type, setType] = useState("fee");
  const [description, setDescription] = useState("");
  const [fee, setFee] = useState("150");
  const [invoiceId, setInvoiceId] = useState("");
  const [amount, setAmount] = useState("300");
  const [error, setError] = useState("");
  async function submit(e) {
    e.preventDefault(); setError("");
    try {
      if (!description.trim()) throw new Error("Explain the proposal.");
      if (ethers.toUtf8Bytes(description.trim()).length > 2000) throw new Error("Please shorten the proposal reason (maximum 2,000 UTF-8 bytes).");
      let args;
      if (type === "fee") {
        if (!/^\d+$/.test(fee) || Number(fee) < 10 || Number(fee) > 1000) throw new Error("Fee must be 10–1000 basis points (0.1%–10%).");
        args = [1, contracts.config.interface.encodeFunctionData("setPlatformFeeBps", [BigInt(fee)])];
      } else {
        const inv = data.invoices.find(i => String(i.id) === invoiceId);
        if (!inv || !inv.financed || inv.repaid || inv.penalized || inv.dueDate >= data.blockTimestamp) throw new Error("Select an overdue, unpaid, unpenalized invoice.");
        const wei = ethers.parseEther(amount);
        if (wei <= 0n || wei > ethers.parseEther("50000")) throw new Error("Penalty must be greater than zero and at most 50,000 INVX.");
        const stake = await contracts.staking.stakedBalance(inv.borrower);
        if (wei > stake) throw new Error("Penalty exceeds the supplier's deposited collateral.");
        args = [0, contracts.config.interface.encodeFunctionData("applyDefaultPenalty", [inv.id, inv.borrower, wei, description.trim()])];
      }
      if (await run(contracts.gov, "propose", [args[0], description.trim(), contracts.config.target, args[1]])) { setDescription(""); onSuccess(); }
    } catch (err) { setError(err.shortMessage || err.message); }
  }
  return <form onSubmit={submit} className="space-y-4 rounded-xl bg-white border p-6">
    <h3 className="text-xl font-bold">Create a proposal</h3>
    <p>Requires {data.proposalThreshold} delegated DTEST votes from a completed block.</p>
    <label className="block">Action<select aria-label="Action" className="block border rounded p-2 w-full" value={type} onChange={e => setType(e.target.value)}><option value="fee">Change financing fee</option><option value="penalty">Penalize an unpaid default</option></select></label>
    {type === "fee" ? <label className="block">New fee in basis points (100 = 1%)<input className="block border rounded p-2" type="number" min="10" max="1000" value={fee} onChange={e => setFee(e.target.value)} required /></label>
      : <><label className="block">Overdue invoice<select aria-label="Overdue invoice" className="block border rounded p-2 w-full" value={invoiceId} onChange={e => setInvoiceId(e.target.value)} required><option value="">Select invoice</option>{data.invoices.filter(i => i.financed && !i.repaid && !i.penalized && i.dueDate < data.blockTimestamp).map(i => <option key={i.id} value={i.id}>#{i.id} — {i.number} — {i.borrower}</option>)}</select></label><label className="block">Penalty (INVX)<input className="block border rounded p-2" value={amount} onChange={e => setAmount(e.target.value)} required /></label></>}
    <label className="block">Reason<textarea maxLength={2000} className="block border rounded p-2 w-full" value={description} onChange={e => setDescription(e.target.value)} required /></label>
    {error && <p role="alert" className="text-red-700">{error}</p>}
    <button className="bg-indigo-600 text-white rounded px-5 py-2 disabled:opacity-40" disabled={disabled || ethers.parseEther(data.votingPower) < ethers.parseEther(data.proposalThreshold)}>Submit proposal</button>
  </form>;
}
