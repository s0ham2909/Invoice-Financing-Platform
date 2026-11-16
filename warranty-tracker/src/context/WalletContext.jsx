import { createContext, useContext, useState, useEffect, useCallback, useRef } from "react";
import { ethers } from "ethers";
const WalletContext = createContext();

export const WalletProvider = ({ children }) => {
  const [wallet, setWallet] = useState({});
  const [rawProvider, setRawProvider] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [disconnected, setDisconnected] = useState(false);
  const epoch = useRef(0);
  const invalidate = useCallback(() => { epoch.current++; }, []);
  const refresh = useCallback(async raw => {
    const request = ++epoch.current;
    const accounts = await raw.request({ method: "eth_accounts" });
    const chainId = Number(await raw.request({ method: "eth_chainId" }));
    const provider = new ethers.BrowserProvider(raw);
    const signer = accounts.length ? await provider.getSigner(accounts[0]) : null;
    if (request === epoch.current) setWallet({ account: accounts[0] || null, provider, signer, chainId });
  }, []);
  const disconnect = useCallback(async () => {
    epoch.current++;
    setWallet({}); setDisconnected(true); setRawProvider(null);
    if (rawProvider && rawProvider !== window.ethereum && rawProvider.disconnect) await rawProvider.disconnect();
  }, [rawProvider]);
  useEffect(() => {
    if (disconnected) return;
    const raw = rawProvider || window.ethereum;
    if (!raw) return;
    const update = () => refresh(raw).catch(err => { setError(err.message); setWallet({}); });
    void update();
    raw.on?.("accountsChanged", update);
    raw.on?.("chainChanged", update);
    const dropped = () => { epoch.current++; setWallet({}); };
    raw.on?.("disconnect", dropped);
    return () => {
      invalidate();
      raw.removeListener?.("accountsChanged", update);
      raw.removeListener?.("chainChanged", update);
      raw.removeListener?.("disconnect", dropped);
    };
  }, [rawProvider, refresh, invalidate, disconnected]);
  const connectMetaMask = async () => {
    setLoading(true); setError(null);
    try {
      if (!window.ethereum) throw new Error("Install MetaMask to connect.");
      await window.ethereum.request({ method: "eth_requestAccounts" });
      setDisconnected(false);
      setRawProvider(window.ethereum);
      await refresh(window.ethereum);
    } catch (err) { setError(err.message); throw err; }
    finally { setLoading(false); }
  };
  const connectWalletConnect = async () => {
    setLoading(true); setError(null);
    try {
      const { EthereumProvider } = await import("@walletconnect/ethereum-provider");
      const raw = await EthereumProvider.init({ projectId: "c45412590204d800dd75d8d0859a117b", chains: [11155111], showQrModal: true });
      await raw.enable(); setDisconnected(false); setRawProvider(raw); await refresh(raw);
    } catch (err) { setError(err.message); throw err; }
    finally { setLoading(false); }
  };
  const switchNetwork = async chainId => {
    const raw = rawProvider || window.ethereum;
    if (!raw) throw new Error("Connect MetaMask first.");
    try { await raw.request({ method: "wallet_switchEthereumChain", params: [{ chainId: ethers.toQuantity(chainId) }] }); }
    catch (err) {
      if (err.code !== 4902 || raw !== window.ethereum) throw err;
      await raw.request({ method: "wallet_addEthereumChain", params: [{ chainId: ethers.toQuantity(chainId),
        chainName: chainId === 31337 ? "DeFiSpace Local" : "Sepolia", nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
        rpcUrls: [chainId === 31337 ? "http://127.0.0.1:8545" : "https://ethereum-sepolia-rpc.publicnode.com"] }] });
      await raw.request({ method: "wallet_switchEthereumChain", params: [{ chainId: ethers.toQuantity(chainId) }] });
    }
    await refresh(raw);
  };
  return <WalletContext.Provider value={{ ...wallet, loading, error, connectionType: rawProvider && rawProvider !== window.ethereum ? "walletconnect" : "metamask",
    connectMetaMask, connectWalletConnect, disconnect, switchNetwork }}>{children}</WalletContext.Provider>;
};

// The hook is deliberately colocated with its provider.
// eslint-disable-next-line react-refresh/only-export-components
export const useWallet = () => {
  const context = useContext(WalletContext);
  if (!context) throw new Error("useWallet must be used within WalletProvider");
  return context;
};
export default WalletContext;
