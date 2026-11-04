import { useState } from "react";
import TransferModal from "./TransferModal";

export default function WarrantyCard({ tokenId, warranty, account, contract, onTransferred }) {
  const [showTransfer, setShowTransfer] = useState(false);
  const [validityResult, setValidityResult] = useState(null);
  const [checking, setChecking] = useState(false);

  const formatDate = (timestamp) => {
    return new Date(Number(timestamp) * 1000).toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  };

  const isExpired = Date.now() / 1000 > Number(warranty.expiryDate);

  const handleCheckValidity = async () => {
    setChecking(true);
    setValidityResult(null);
    try {
      const valid = await contract.checkValidity(BigInt(tokenId));
      setValidityResult(valid);
    } catch (err) {
      setValidityResult(false);
    } finally {
      setChecking(false);
    }
  };

  return (
    <>
      <div className="bg-white rounded-2xl shadow-md border border-gray-100 p-6 flex flex-col gap-3">
        {/* Header */}
        <div className="flex items-center justify-between">
          <span className="text-xs font-mono text-gray-400">Token #{tokenId}</span>
          <span
            className={`text-xs font-semibold px-2 py-1 rounded-full ${
              isExpired
                ? "bg-red-100 text-red-700"
                : "bg-green-100 text-green-700"
            }`}
          >
            {isExpired ? "Expired" : "Active"}
          </span>
        </div>

        {/* Details */}
        <div className="space-y-2">
          <div>
            <p className="text-xs text-gray-400">Serial Number</p>
            <p className="font-semibold text-gray-800">{warranty.serialNumber}</p>
          </div>
          <div className="flex gap-4">
            <div>
              <p className="text-xs text-gray-400">Purchase Date</p>
              <p className="text-sm text-gray-700">{formatDate(warranty.purchaseDate)}</p>
            </div>
            <div>
              <p className="text-xs text-gray-400">Expiry Date</p>
              <p className="text-sm text-gray-700">{formatDate(warranty.expiryDate)}</p>
            </div>
          </div>
        </div>

        {/* Validity result */}
        {validityResult !== null && (
          <div
            className={`text-sm p-2 rounded-lg ${
              validityResult
                ? "bg-green-100 text-green-800"
                : "bg-red-100 text-red-800"
            }`}
          >
            {validityResult
              ? "✅ Warranty is valid — eligible for repair claim."
              : "❌ Warranty is invalid or expired."}
          </div>
        )}

        {/* Action buttons */}
        <div className="flex gap-2 mt-2">
          <button
            onClick={handleCheckValidity}
            disabled={checking}
            className="flex-1 py-2 text-sm border border-indigo-300 text-indigo-600 rounded-lg hover:bg-indigo-50 disabled:opacity-50 transition-colors"
          >
            {checking ? "Checking..." : "Check Validity"}
          </button>
          <button
            onClick={() => setShowTransfer(true)}
            className="flex-1 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors"
          >
            Transfer
          </button>
        </div>
      </div>

      {showTransfer && (
        <TransferModal
          tokenId={tokenId}
          account={account}
          contract={contract}
          onClose={() => setShowTransfer(false)}
          onTransferred={onTransferred}
        />
      )}
    </>
  );
}
