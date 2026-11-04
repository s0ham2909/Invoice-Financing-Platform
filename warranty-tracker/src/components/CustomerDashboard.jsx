import { useState, useEffect, useCallback } from "react";
import WarrantyCard from "./WarrantyCard";

export default function CustomerDashboard({ account, contract }) {
  const [warranties, setWarranties] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const fetchWarranties = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const total = await contract.totalMinted();
      const count = Number(total);
      const owned = [];

      for (let i = 0; i < count; i++) {
        try {
          const owner = await contract.ownerOf(BigInt(i));
          if (owner.toLowerCase() === account.toLowerCase()) {
            const warranty = await contract.getWarranty(BigInt(i));
            owned.push({ tokenId: i, warranty });
          }
        } catch {
          // Token may have been burned — skip
        }
      }

      setWarranties(owned);
    } catch (err) {
      setError(err?.reason || err?.message || "Failed to fetch warranties");
    } finally {
      setLoading(false);
    }
  }, [account, contract]);

  useEffect(() => {
    fetchWarranties();
  }, [fetchWarranties]);

  if (loading) {
    return (
      <div className="flex justify-center items-center py-20">
        <p className="text-gray-500 text-lg">Loading your warranties...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-lg mx-auto mt-10 bg-red-50 text-red-700 p-4 rounded-xl">
        {error}
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto mt-10 px-4">
      <h2 className="text-2xl font-bold text-gray-800 mb-6">
        My Warranties
      </h2>

      {warranties.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-2xl shadow-sm border border-gray-100">
          <p className="text-gray-400 text-lg">No warranty NFTs found for this wallet.</p>
        </div>
      ) : (
        <div className="grid gap-6 sm:grid-cols-2">
          {warranties.map(({ tokenId, warranty }) => (
            <WarrantyCard
              key={tokenId}
              tokenId={tokenId}
              warranty={warranty}
              account={account}
              contract={contract}
              onTransferred={fetchWarranties}
            />
          ))}
        </div>
      )}
    </div>
  );
}
