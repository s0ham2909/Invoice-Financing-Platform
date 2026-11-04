import { useState, useEffect } from "react";
import Navbar from "./components/Navbar";
import ManufacturerDashboard from "./components/ManufacturerDashboard";
import CustomerDashboard from "./components/CustomerDashboard";
import InvoiceFinancing from "./components/InvoiceFinancing";
import VaultDashboard from "./components/VaultDashboard";
import AmmDashboard from "./components/AmmDashboard";
import { getContract } from "./utils/web3";
import { useWallet } from "./context/WalletContext";

function App() {
  const { account, signer, connectMetaMask } = useWallet();
  const [contract, setContract] = useState(null);
  const [activeTab, setActiveTab] = useState("invoice");
  const [isOwner, setIsOwner] = useState(false);

  // Initialize contract when signer is ready
  useEffect(() => {
    if (!account || !signer) {
      setContract(null);
      setIsOwner(false);
      return;
    }

    const init = async () => {
      try {
        const contractInstance = await getContract(signer);
        setContract(contractInstance);

        // Check if connected wallet is contract owner
        try {
          const owner = await contractInstance.owner();
          setIsOwner(owner.toLowerCase() === account.toLowerCase());
        } catch {
          setIsOwner(false);
        }
      } catch (err) {
        console.error("Failed to initialize contract:", err);
      }
    };

    init();
  }, [account, signer]);

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />

      {!account ? (
        <div className="flex flex-col items-center justify-center py-32 px-4">
          <h2 className="text-3xl font-bold text-gray-800 mb-4">
            Blockchain Invoice Financing & Warranty Platform
          </h2>
          <p className="text-gray-500 mb-8 text-center max-w-md">
            Connect your wallet to tokenize invoices, interact with ERC-4626 Tokenized Vaults, and claim repayment warranties.
          </p>
          <button
            onClick={connectMetaMask}
            className="bg-indigo-600 hover:bg-indigo-700 text-white font-semibold px-8 py-3 rounded-xl transition-all shadow-md active:scale-95 cursor-pointer"
          >
            Connect MetaMask
          </button>
        </div>
      ) : (
        <>
          {/* Tab navigation */}
          <div className="flex flex-wrap justify-center gap-3 mt-6">
            <button
              onClick={() => setActiveTab("invoice")}
              className={`px-5 py-2 rounded-lg font-medium transition-colors cursor-pointer ${
                activeTab === "invoice"
                  ? "bg-indigo-600 text-white"
                  : "bg-white text-gray-600 border border-gray-200 hover:bg-gray-100"
              }`}
            >
              🧾 Invoice Financing
            </button>
            <button
              onClick={() => setActiveTab("vault")}
              className={`px-5 py-2 rounded-lg font-medium transition-colors cursor-pointer ${
                activeTab === "vault"
                  ? "bg-indigo-600 text-white"
                  : "bg-white text-gray-600 border border-gray-200 hover:bg-gray-100"
              }`}
            >
              🏦 ERC-4626 Vault
            </button>
            <button
              onClick={() => setActiveTab("customer")}
              className={`px-5 py-2 rounded-lg font-medium transition-colors cursor-pointer ${
                activeTab === "customer"
                  ? "bg-indigo-600 text-white"
                  : "bg-white text-gray-600 border border-gray-200 hover:bg-gray-100"
              }`}
            >
              🔖 Warranty Feature
            </button>
            {isOwner && (
              <button
                onClick={() => setActiveTab("manufacturer")}
                className={`px-5 py-2 rounded-lg font-medium transition-colors cursor-pointer ${
                  activeTab === "manufacturer"
                    ? "bg-indigo-600 text-white"
                    : "bg-white text-gray-600 border border-gray-200 hover:bg-gray-100"
                }`}
              >
                🏭 Manufacturer Admin
              </button>
            )}
            <button
              onClick={() => setActiveTab("amm")}
              className={`px-5 py-2 rounded-lg font-medium transition-colors cursor-pointer ${
                activeTab === "amm"
                  ? "bg-purple-600 text-white"
                  : "bg-purple-50 text-purple-600 border border-purple-200 hover:bg-purple-100"
              }`}
            >
              🧪 Exp 4: AMM Pool
            </button>
          </div>

          {/* Dashboard content */}
          <div className="pb-12">
            {activeTab === "amm" && <AmmDashboard signer={signer} account={account} />}
            {activeTab === "invoice" && <InvoiceFinancing />}
            {activeTab === "vault" && <VaultDashboard signer={signer} account={account} />}
            {activeTab === "manufacturer" && isOwner && contract && (
              <ManufacturerDashboard contract={contract} />
            )}
            {activeTab === "customer" && contract && (
              <CustomerDashboard account={account} contract={contract} />
            )}
          </div>
        </>
      )}
    </div>
  );
}

export default App;
