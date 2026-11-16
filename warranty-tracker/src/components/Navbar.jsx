import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useWallet } from "../context/WalletContext";
import LogoutButton from "./LogoutButton";
import OracleHealthBadge from "./OracleHealthBadge";
import { isLoggedIn } from "../utils/auth";

export default function Navbar() {
  const { account, chainId, connectionType, loading, connectMetaMask, connectWalletConnect, disconnect } = useWallet();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const navigate = useNavigate();

  const truncateAddress = (addr) =>
    addr ? `${addr.slice(0, 6)}...${addr.slice(-4)}` : "";

  const handleConnectMetaMask = async () => {
    try {
      await connectMetaMask();
      setIsModalOpen(false);
    } catch (err) {
      alert(err.message);
    }
  };

  const handleConnectWalletConnect = async () => {
    try {
      await connectWalletConnect();
      setIsModalOpen(false);
    } catch (err) {
      alert(err.message);
    }
  };

  return (
    <>
      <nav className="flex flex-wrap gap-3 items-center justify-between px-4 md:px-6 py-4 bg-gray-900 text-white shadow-lg">
        <h1
          className="text-base md:text-xl font-bold tracking-wide cursor-pointer flex items-center gap-2"
          onClick={() => navigate("/")}
        >
          📄 Invoice Financing Platform
        </h1>

        <div className="flex flex-wrap min-w-0 items-center gap-2 md:gap-4">
          {/* Chainlink Oracle Health Badge (Experiment 7) */}
          {chainId === 11155111 && <OracleHealthBadge />}

          {isLoggedIn() && <LogoutButton />}

          {!isLoggedIn() && (
            <>
              <Link to="/login" className="text-gray-300 hover:text-white transition-colors">
                Login
              </Link>
              <Link to="/signup" className="text-gray-300 hover:text-white transition-colors">
                Sign Up
              </Link>
            </>
          )}

          {account ? (
            <div className="flex items-center gap-2">
              <span className="bg-indigo-950 text-indigo-300 text-xs px-3 py-1.5 rounded-full border border-indigo-700 font-mono flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                {truncateAddress(account)}
                {connectionType && (
                  <span className="text-[10px] text-gray-400 capitalize">({connectionType})</span>
                )}
              </span>
              <button
                onClick={disconnect}
                className="bg-red-600/80 hover:bg-red-600 text-white text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors cursor-pointer"
              >
                Disconnect
              </button>
            </div>
          ) : (
            <button
              onClick={() => setIsModalOpen(true)}
              className="bg-indigo-600 hover:bg-indigo-700 text-white font-medium px-5 py-2 rounded-lg transition-all shadow-sm active:scale-95 cursor-pointer"
            >
              Connect Wallet
            </button>
          )}
        </div>
      </nav>

      {/* Wallet Choice Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-white text-gray-900 rounded-2xl max-w-md w-full p-6 shadow-2xl relative border border-gray-100">
            <button
              onClick={() => setIsModalOpen(false)}
              className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 text-xl font-bold cursor-pointer"
            >
              ✕
            </button>

            <h2 className="text-xl font-bold mb-1 text-gray-900">Connect Wallet</h2>
            <p className="text-sm text-gray-500 mb-6">
              Select a wallet provider to connect your Web3 account.
            </p>

            <div className="space-y-3">
              {/* MetaMask Option */}
              <button
                onClick={handleConnectMetaMask}
                disabled={loading}
                className="w-full flex items-center justify-between p-4 border border-gray-200 hover:border-indigo-500 hover:bg-indigo-50/50 rounded-xl transition-all group cursor-pointer disabled:opacity-50"
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-orange-100 flex items-center justify-center text-xl">
                    🦊
                  </div>
                  <div className="text-left">
                    <div className="font-semibold text-gray-800 group-hover:text-indigo-600">
                      MetaMask
                    </div>
                    <div className="text-xs text-gray-500">Injected browser extension</div>
                  </div>
                </div>
                <span className="text-gray-400 group-hover:text-indigo-600 font-bold">→</span>
              </button>

              {/* WalletConnect Option */}
              <button
                onClick={handleConnectWalletConnect}
                disabled={loading}
                className="w-full flex items-center justify-between p-4 border border-gray-200 hover:border-blue-500 hover:bg-blue-50/50 rounded-xl transition-all group cursor-pointer disabled:opacity-50"
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-blue-100 flex items-center justify-center text-xl">
                    📲
                  </div>
                  <div className="text-left">
                    <div className="font-semibold text-gray-800 group-hover:text-blue-600">
                      WalletConnect
                    </div>
                    <div className="text-xs text-gray-500">Scan QR code with mobile wallet</div>
                  </div>
                </div>
                <span className="text-gray-400 group-hover:text-blue-600 font-bold">→</span>
              </button>
            </div>

            {loading && (
              <div className="mt-4 text-center text-xs text-indigo-600 font-medium animate-pulse">
                Initiating wallet connection...
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
