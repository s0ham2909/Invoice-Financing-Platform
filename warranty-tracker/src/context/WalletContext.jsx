import { createContext, useContext, useState, useEffect } from "react";
import { ethers } from "ethers";

const WalletContext = createContext();

export const WalletProvider = ({ children }) => {
  const [account, setAccount] = useState(null);
  const [provider, setProvider] = useState(null);
  const [signer, setSigner] = useState(null);
  const [connectionType, setConnectionType] = useState(null); // 'metamask' | 'walletconnect'
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Auto check existing MetaMask account on mount
  useEffect(() => {
    if (window.ethereum) {
      window.ethereum
        .request({ method: "eth_accounts" })
        .then(async (accounts) => {
          if (accounts && accounts.length > 0) {
            const browserProvider = new ethers.BrowserProvider(window.ethereum);
            const walletSigner = await browserProvider.getSigner();
            setAccount(accounts[0]);
            setProvider(browserProvider);
            setSigner(walletSigner);
            setConnectionType("metamask");
          }
        })
        .catch(console.error);

      const handleAccountsChanged = async (accounts) => {
        if (accounts.length === 0) {
          disconnect();
        } else {
          const browserProvider = new ethers.BrowserProvider(window.ethereum);
          const walletSigner = await browserProvider.getSigner();
          setAccount(accounts[0]);
          setProvider(browserProvider);
          setSigner(walletSigner);
        }
      };

      window.ethereum.on("accountsChanged", handleAccountsChanged);
      return () => {
        if (window.ethereum.removeListener) {
          window.ethereum.removeListener("accountsChanged", handleAccountsChanged);
        }
      };
    }
  }, []);

  /**
   * Connect using MetaMask extension (Injected Provider)
   */
  const connectMetaMask = async () => {
    setLoading(true);
    setError(null);
    try {
      if (!window.ethereum) {
        throw new Error("MetaMask extension is not installed. Please install MetaMask.");
      }
      const accounts = await window.ethereum.request({
        method: "eth_requestAccounts",
      });
      if (!accounts || accounts.length === 0) {
        throw new Error("No MetaMask account selected");
      }
      const browserProvider = new ethers.BrowserProvider(window.ethereum);
      const walletSigner = await browserProvider.getSigner();

      setAccount(accounts[0]);
      setProvider(browserProvider);
      setSigner(walletSigner);
      setConnectionType("metamask");
      return accounts[0];
    } catch (err) {
      console.error("MetaMask Error:", err);
      setError(err.message);
      throw err;
    } finally {
      setLoading(false);
    }
  };

  /**
   * Connect using WalletConnect QR Code Modal
   */
  const connectWalletConnect = async () => {
    setLoading(true);
    setError(null);
    try {
      let EthereumProvider;
      try {
        const module = await import("@walletconnect/ethereum-provider");
        EthereumProvider = module.EthereumProvider;
      } catch {
        throw new Error(
          "WalletConnect package (@walletconnect/ethereum-provider) is not installed. Run `npm install @walletconnect/ethereum-provider`."
        );
      }

      // Initialize WalletConnect Ethereum Provider
      const wcProvider = await EthereumProvider.init({
        projectId: "c45412590204d800dd75d8d0859a117b", // Standard Sepolia demo Project ID
        chains: [11155111], // Sepolia Testnet
        showQrModal: true,
        metadata: {
          name: "Invoice Financing Platform",
          description: "Decentralized Invoice Financing & NFT Platform",
          url: window.location.origin,
          icons: ["https://walletconnect.com/walletconnect-logo.png"],
        },
      });

      await wcProvider.enable();
      const browserProvider = new ethers.BrowserProvider(wcProvider);
      const walletSigner = await browserProvider.getSigner();
      const address = await walletSigner.getAddress();

      setAccount(address);
      setProvider(browserProvider);
      setSigner(walletSigner);
      setConnectionType("walletconnect");

      wcProvider.on("accountsChanged", (accounts) => {
        if (accounts.length === 0) disconnect();
        else setAccount(accounts[0]);
      });

      wcProvider.on("disconnect", () => {
        disconnect();
      });

      return address;
    } catch (err) {
      console.error("WalletConnect Error:", err);
      setError(err.message);
      throw err;
    } finally {
      setLoading(false);
    }
  };

  /**
   * Disconnect current active wallet session
   */
  const disconnect = async () => {
    setAccount(null);
    setProvider(null);
    setSigner(null);
    setConnectionType(null);
  };

  return (
    <WalletContext.Provider
      value={{
        account,
        provider,
        signer,
        connectionType,
        loading,
        error,
        connectMetaMask,
        connectWalletConnect,
        disconnect,
      }}
    >
      {children}
    </WalletContext.Provider>
  );
};

export const useWallet = () => {
  const context = useContext(WalletContext);
  if (!context) {
    throw new Error("useWallet must be used within a WalletProvider");
  }
  return context;
};

export default WalletContext;
