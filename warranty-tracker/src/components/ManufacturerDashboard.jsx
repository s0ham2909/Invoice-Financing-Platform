import { useState } from "react";

export default function ManufacturerDashboard({ contract }) {
  const [customerAddress, setCustomerAddress] = useState("");
  const [serialNumber, setSerialNumber] = useState("");
  const [duration, setDuration] = useState("");
  const [status, setStatus] = useState({ type: "", message: "" });
  const [loading, setLoading] = useState(false);

  const handleMint = async (e) => {
    e.preventDefault();
    setStatus({ type: "", message: "" });
    setLoading(true);

    try {
      // Use a placeholder tokenURI (user can update to real IPFS later)
      const tokenURI = `https://example.com/warranty/${serialNumber}`;

      const tx = await contract.mintWarranty(
        customerAddress,
        serialNumber,
        BigInt(duration),
        tokenURI
      );

      setStatus({ type: "info", message: "Transaction submitted. Waiting for confirmation..." });
      await tx.wait();

      setStatus({ type: "success", message: `Warranty NFT minted successfully! Tx: ${tx.hash}` });
      setCustomerAddress("");
      setSerialNumber("");
      setDuration("");
    } catch (err) {
      const msg = err?.reason || err?.message || "Transaction failed";
      setStatus({ type: "error", message: msg });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-lg mx-auto mt-10 bg-white rounded-2xl shadow-lg p-8">
      <h2 className="text-2xl font-bold text-gray-800 mb-6">
        Manufacturer Dashboard
      </h2>
      <p className="text-gray-500 mb-6 text-sm">
        Mint a new warranty NFT for a customer product.
      </p>

      <form onSubmit={handleMint} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Customer Wallet Address
          </label>
          <input
            type="text"
            placeholder="0x..."
            value={customerAddress}
            onChange={(e) => setCustomerAddress(e.target.value)}
            required
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Serial Number
          </label>
          <input
            type="text"
            placeholder="SN-12345-XYZ"
            value={serialNumber}
            onChange={(e) => setSerialNumber(e.target.value)}
            required
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Warranty Duration (Days)
          </label>
          <input
            type="number"
            placeholder="365"
            min="1"
            value={duration}
            onChange={(e) => setDuration(e.target.value)}
            required
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
          />
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-semibold py-3 rounded-lg transition-colors"
        >
          {loading ? "Minting..." : "Mint Warranty NFT"}
        </button>
      </form>

      {status.message && (
        <div
          className={`mt-4 p-3 rounded-lg text-sm break-all ${
            status.type === "success"
              ? "bg-green-100 text-green-800"
              : status.type === "error"
              ? "bg-red-100 text-red-800"
              : "bg-blue-100 text-blue-800"
          }`}
        >
          {status.message}
        </div>
      )}
    </div>
  );
}
