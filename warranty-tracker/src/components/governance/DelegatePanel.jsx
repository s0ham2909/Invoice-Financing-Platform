import { useState } from "react";
import { ethers } from "ethers";

export default function DelegatePanel({
  account,
  tokenBalance,
  votingPower,
  delegatee,
  delegate,
  actionPending,
}) {
  const [customDelegatee, setCustomDelegatee] = useState("");


  const isDelegatedToSelf =
    account && delegatee.toLowerCase() === account.toLowerCase();

  const handleSelfDelegate = async () => {
    if (!account) return;
    try {
      if (!await delegate(account)) return;
      alert("Successfully self-delegated voting power!");
    } catch (err) {
      alert("Delegation failed: " + (err.reason || err.message));
    }
  };

  const handleCustomDelegate = async (e) => {
    e.preventDefault();
    if (!ethers.isAddress(customDelegatee)) {
      alert("Invalid Ethereum address.");
      return;
    }
    try {
      if (!await delegate(customDelegatee)) return;
      alert("Successfully delegated to " + customDelegatee);
      setCustomDelegatee("");
    } catch (err) {
      alert("Delegation failed: " + (err.reason || err.message));
    }
  };

  return (
    <div className="bg-white rounded-2xl p-6 border border-gray-100 shadow-sm space-y-6">
      <div className="flex items-center justify-between border-b border-gray-100 pb-4">
        <div>
          <h3 className="text-lg font-bold text-gray-900">🗳️ Voting Power & Delegation</h3>
          <p className="text-sm text-gray-500">
            Checkpointed voting power requires active delegation (self or representative).
          </p>
        </div>
        <span
          className={`px-3 py-1 rounded-full text-xs font-semibold ${
            isDelegatedToSelf
              ? "bg-green-100 text-green-700"
              : delegatee !== ethers.ZeroAddress
              ? "bg-blue-100 text-blue-700"
              : "bg-yellow-100 text-yellow-700"
          }`}
        >
          {isDelegatedToSelf
            ? "Self-Delegated"
            : delegatee !== ethers.ZeroAddress
            ? "Delegated to Representative"
            : "Undelegated (0 Votes)"}
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="p-4 bg-gray-50 rounded-xl">
          <p className="text-xs font-medium text-gray-400 uppercase">DTEST Balance</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">
            {Number(tokenBalance).toLocaleString(undefined, { maximumFractionDigits: 2 })}{" "}
            <span className="text-xs text-gray-500">DTEST</span>
          </p>
        </div>

        <div className="p-4 bg-indigo-50 rounded-xl">
          <p className="text-xs font-medium text-indigo-500 uppercase">Active Voting Power</p>
          <p className="text-2xl font-bold text-indigo-900 mt-1">
            {Number(votingPower).toLocaleString(undefined, { maximumFractionDigits: 2 })}{" "}
            <span className="text-xs text-indigo-500">Votes</span>
          </p>
        </div>

        <div className="p-4 bg-gray-50 rounded-xl">
          <p className="text-xs font-medium text-gray-400 uppercase">Current Delegatee</p>
          <p className="text-sm font-mono text-gray-700 mt-2 truncate">
            {delegatee === ethers.ZeroAddress
              ? "None (Inactive)"
              : `${delegatee.slice(0, 8)}...${delegatee.slice(-6)}`}
          </p>
        </div>
      </div>

      {/* Delegation Actions */}
      <div className="pt-2 flex flex-col md:flex-row gap-4">
        <button
          onClick={handleSelfDelegate}
          disabled={actionPending || isDelegatedToSelf || Number(tokenBalance) === 0}
          className={`flex-1 py-3 px-4 rounded-xl font-medium transition-all shadow-sm ${
            isDelegatedToSelf
              ? "bg-gray-100 text-gray-400 cursor-not-allowed"
              : "bg-indigo-600 hover:bg-indigo-700 text-white active:scale-98"
          }`}
        >
          {actionPending ? "Processing..." : "⚡ Activate / Self-Delegate Votes"}
        </button>

        <form onSubmit={handleCustomDelegate} className="flex-2 flex gap-2">
          <input
            type="text"
            placeholder="Delegate to representative (0x...)"
            value={customDelegatee}
            onChange={(e) => setCustomDelegatee(e.target.value)}
            className="flex-1 px-4 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono"
          />
          <button
            type="submit"
            disabled={actionPending || !customDelegatee}
            className="px-5 py-2 bg-gray-800 hover:bg-gray-900 text-white rounded-xl text-sm font-medium transition-all"
          >
            Delegate
          </button>
        </form>
      </div>
    </div>
  );
}
