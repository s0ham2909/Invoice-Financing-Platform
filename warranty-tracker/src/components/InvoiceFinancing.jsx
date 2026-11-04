import { useState, useEffect, useCallback } from "react";
import { ethers } from "ethers";
import { useWallet } from "../context/WalletContext";
import { INVOICE_CONTRACT_ADDRESS, INVOICE_CONTRACT_ABI } from "../config/invoiceContractConfig";
import { RESERVE_STAKING_ADDRESS, RESERVE_STAKING_ABI } from "../config/farmConfig";
import { useOraclePrice } from "../hooks/useOraclePrice";

// ─── Pool Contract (deploy InvoiceLiquidityPool.sol and paste address here) ───
// Once deployed, replace this placeholder with the real address:
const POOL_CONTRACT_ADDRESS = "0x0000000000000000000000000000000000000000"; // <-- replace after deploy

const POOL_ABI = [
  // Investor
  { "inputs": [], "name": "depositLiquidity", "outputs": [{ "internalType": "uint256", "name": "shares", "type": "uint256" }], "stateMutability": "payable", "type": "function" },
  { "inputs": [{ "internalType": "uint256", "name": "shares", "type": "uint256" }], "name": "withdrawLiquidity", "outputs": [{ "internalType": "uint256", "name": "ethAmount", "type": "uint256" }], "stateMutability": "nonpayable", "type": "function" },
  // Supplier
  { "inputs": [{ "internalType": "uint256", "name": "tokenId", "type": "uint256" }], "name": "requestPoolFinancing", "outputs": [], "stateMutability": "nonpayable", "type": "function" },
  { "inputs": [{ "internalType": "uint256", "name": "tokenId", "type": "uint256" }], "name": "repayInvoice", "outputs": [], "stateMutability": "payable", "type": "function" },
  // Views
  { "inputs": [], "name": "totalPoolETH", "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }], "stateMutability": "view", "type": "function" },
  { "inputs": [], "name": "totalFinancedETH", "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }], "stateMutability": "view", "type": "function" },
  { "inputs": [], "name": "availableLiquidity", "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }], "stateMutability": "view", "type": "function" },
  { "inputs": [], "name": "utilizationBps", "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }], "stateMutability": "view", "type": "function" },
  { "inputs": [], "name": "sharePriceWei", "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }], "stateMutability": "view", "type": "function" },
  { "inputs": [], "name": "totalSupply", "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }], "stateMutability": "view", "type": "function" },
  { "inputs": [{ "internalType": "address", "name": "account", "type": "address" }], "name": "balanceOf", "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }], "stateMutability": "view", "type": "function" },
  { "inputs": [{ "internalType": "uint256", "name": "tokenId", "type": "uint256" }], "name": "getLoan", "outputs": [{ "components": [{ "internalType": "uint256", "name": "principal", "type": "uint256" }, { "internalType": "uint256", "name": "repayAmount", "type": "uint256" }, { "internalType": "address", "name": "borrower", "type": "address" }, { "internalType": "bool", "name": "repaid", "type": "bool" }], "internalType": "struct InvoiceLiquidityPool.LoanRecord", "name": "", "type": "tuple" }], "stateMutability": "view", "type": "function" },
  // Events (for reference)
  { "anonymous": false, "inputs": [{ "indexed": true, "internalType": "address", "name": "investor", "type": "address" }, { "indexed": false, "internalType": "uint256", "name": "ethAmount", "type": "uint256" }, { "indexed": false, "internalType": "uint256", "name": "ipsShares", "type": "uint256" }], "name": "LiquidityDeposited", "type": "event" },
  { "anonymous": false, "inputs": [{ "indexed": true, "internalType": "uint256", "name": "tokenId", "type": "uint256" }, { "indexed": true, "internalType": "address", "name": "borrower", "type": "address" }, { "indexed": false, "internalType": "uint256", "name": "principal", "type": "uint256" }], "name": "InvoiceFinancedByPool", "type": "event" },
  { "anonymous": false, "inputs": [{ "indexed": true, "internalType": "uint256", "name": "tokenId", "type": "uint256" }, { "indexed": true, "internalType": "address", "name": "borrower", "type": "address" }, { "indexed": false, "internalType": "uint256", "name": "totalRepaid", "type": "uint256" }, { "indexed": false, "internalType": "uint256", "name": "interest", "type": "uint256" }], "name": "InvoiceRepaid", "type": "event" }
];

const POOL_DEPLOYED = ethers.isAddress(POOL_CONTRACT_ADDRESS) &&
  POOL_CONTRACT_ADDRESS !== "0x0000000000000000000000000000000000000000";

// ─── Utilization Bar ───────────────────────────────────────────────────────
function UtilizationBar({ bps }) {
  const pct = Math.min(100, (bps / 10000) * 100).toFixed(1);
  const color =
    bps > 7000 ? "bg-red-500" :
    bps > 5000 ? "bg-amber-400" :
    "bg-emerald-500";
  return (
    <div className="w-full">
      <div className="flex justify-between text-xs text-gray-600 mb-1">
        <span>Pool Utilization</span>
        <span className="font-bold">{pct}% <span className="text-gray-400">(max 80%)</span></span>
      </div>
      <div className="w-full bg-gray-200 rounded-full h-3 overflow-hidden">
        <div className={`${color} h-3 rounded-full transition-all duration-500`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

// ─── Main Component ────────────────────────────────────────────────────────
export default function InvoiceFinancing() {
  const { account, signer } = useWallet();
  const [contract, setContract] = useState(null);
  const [poolContract, setPoolContract] = useState(null);
  const [activeTab, setActiveTab] = useState("supplier");

  // UI States
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [successMsg, setSuccessMsg] = useState("");

  // Invoice Data
  const [myInvoices, setMyInvoices] = useState([]);
  const [allInvoices, setAllInvoices] = useState([]);

  // Mint Form
  const [formData, setFormData] = useState({
    invoiceNumber: "",
    amountEth: "",
    dueDateDays: "",
    borrowerAddress: ""
  });
  const [mintMode, setMintMode] = useState("ETH"); // "ETH" or "USD"
  const [usdInput, setUsdInput] = useState("");

  // Chainlink Oracle Hook (Experiment 7)
  const oracleEth = useOraclePrice("ETH/USD");

  // Pool State
  const [poolStats, setPoolStats] = useState({
    totalPoolETH: "0",
    totalFinancedETH: "0",
    availableLiquidity: "0",
    utilizationBps: 0,
    sharePriceEth: "1.0",
    totalSupply: "0",
    userIpsBalance: "0"
  });
  const [depositAmount, setDepositAmount] = useState("");
  const [withdrawShares, setWithdrawShares] = useState("");
  const [loanDetails, setLoanDetails] = useState({}); // tokenId -> LoanRecord

  // Supplier Staking Tier State (Experiment 5: Part 2 Hook)
  const [supplierTier, setSupplierTier] = useState({
    tier: 0,
    name: "Bronze",
    discountBps: 0,
    stakedAmount: "0",
    financingLimit: "10000"
  });

  // ─── Initialize Contracts ─────────────────────────────────────────────
  useEffect(() => {
    if (signer && account) {
      const invoiceC = new ethers.Contract(INVOICE_CONTRACT_ADDRESS, INVOICE_CONTRACT_ABI, signer);
      setContract(invoiceC);
      setFormData(prev => ({ ...prev, borrowerAddress: account }));

      if (POOL_DEPLOYED) {
        const poolC = new ethers.Contract(POOL_CONTRACT_ADDRESS, POOL_ABI, signer);
        setPoolContract(poolC);
      }

      // Check supplier staking tier from ReserveStaking
      if (ethers.isAddress(RESERVE_STAKING_ADDRESS) && RESERVE_STAKING_ADDRESS !== ethers.ZeroAddress) {
        const stakingC = new ethers.Contract(RESERVE_STAKING_ADDRESS, RESERVE_STAKING_ABI, signer);
        stakingC.stakedBalance(account).then(async (bal) => {
          const discount = await stakingC.feeDiscountBps(account);
          const limit = await stakingC.financingLimit(account);
          const tierNum = await stakingC.getSupplierTier(account);
          const tierNames = ["Bronze", "Silver", "Gold"];
          setSupplierTier({
            tier: Number(tierNum),
            name: tierNames[Number(tierNum)] || "Bronze",
            discountBps: Number(discount),
            stakedAmount: ethers.formatUnits(bal, 18),
            financingLimit: ethers.formatUnits(limit, 6)
          });
        }).catch(() => {});
      }
    } else {
      setContract(null);
      setPoolContract(null);
    }
  }, [signer, account]);

  // ─── Fetch Invoices ───────────────────────────────────────────────────
  const fetchInvoices = useCallback(async () => {
    if (!contract || !account) return;
    try {
      setLoading(true);
      setErrorMsg("");

      const totalMinted = await contract.totalMinted();
      const count = Number(totalMinted);
      const fetchedAll = [];
      const fetchedMine = [];

      for (let i = 0; i < count; i++) {
        try {
          const invoice = await contract.getInvoice(i);
          const formatted = {
            tokenId: i,
            invoiceNumber: invoice.invoiceNumber,
            amount: ethers.formatEther(invoice.amount),
            amountWei: invoice.amount,
            dueDate: new Date(Number(invoice.dueDate) * 1000).toLocaleDateString(),
            borrower: invoice.borrower,
            investor: invoice.investor,
            isFinanced: invoice.isFinanced
          };
          fetchedAll.push(formatted);
          if (invoice.borrower.toLowerCase() === account.toLowerCase()) {
            fetchedMine.push(formatted);
          }
        } catch (err) {
          console.warn(`Failed to fetch invoice ${i}`, err);
        }
      }

      setAllInvoices(fetchedAll);
      setMyInvoices(fetchedMine);
    } catch (err) {
      console.error("Error fetching invoices:", err);
      setErrorMsg("Failed to load invoices from the blockchain.");
    } finally {
      setLoading(false);
    }
  }, [contract, account]);

  // ─── Fetch Pool Stats ─────────────────────────────────────────────────
  const fetchPoolStats = useCallback(async () => {
    if (!poolContract || !account) return;
    try {
      const [totalPool, totalFinanced, available, utilBps, sharePrice, supply, userBal] =
        await Promise.all([
          poolContract.totalPoolETH(),
          poolContract.totalFinancedETH(),
          poolContract.availableLiquidity(),
          poolContract.utilizationBps(),
          poolContract.sharePriceWei(),
          poolContract.totalSupply(),
          poolContract.balanceOf(account)
        ]);

      setPoolStats({
        totalPoolETH: ethers.formatEther(totalPool),
        totalFinancedETH: ethers.formatEther(totalFinanced),
        availableLiquidity: ethers.formatEther(available),
        utilizationBps: Number(utilBps),
        sharePriceEth: ethers.formatEther(sharePrice),
        totalSupply: ethers.formatEther(supply),
        userIpsBalance: ethers.formatEther(userBal)
      });

      // Fetch loan details for my invoices
      if (myInvoices.length > 0) {
        const loanMap = {};
        for (const inv of myInvoices) {
          try {
            const loan = await poolContract.getLoan(inv.tokenId);
            if (loan.principal > 0n) {
              loanMap[inv.tokenId] = {
                principal: ethers.formatEther(loan.principal),
                repayAmount: ethers.formatEther(loan.repayAmount),
                repaid: loan.repaid
              };
            }
          } catch { /* no loan */ }
        }
        setLoanDetails(loanMap);
      }
    } catch (err) {
      console.error("Pool stats error:", err);
    }
  }, [poolContract, account, myInvoices]);

  useEffect(() => {
    if (contract && account) fetchInvoices();
  }, [contract, account, activeTab, fetchInvoices]);

  useEffect(() => {
    if (poolContract && account && activeTab === "pool") fetchPoolStats();
  }, [poolContract, account, activeTab, fetchPoolStats]);

  const parseContractError = (err) => {
    if (err.data && contract) {
      try {
        const decoded = contract.interface.parseError(err.data);
        if (decoded) return `Contract Error: ${decoded.name}`;
      } catch { /* ignore */ }
    }
    return err.reason || err.message;
  };

  // ─── Mint Invoice ─────────────────────────────────────────────────────
  const handleMint = async (e) => {
    e.preventDefault();
    setErrorMsg(""); setSuccessMsg("");
    if (!formData.invoiceNumber || !formData.amountEth || !formData.dueDateDays) {
      setErrorMsg("Please fill in all required fields."); return;
    }
    try {
      setLoading(true);
      const amountWei = ethers.parseEther(formData.amountEth);
      const borrower = formData.borrowerAddress || account;
      const tx = await contract.mintInvoice(borrower, formData.invoiceNumber, amountWei, Number(formData.dueDateDays), "ipfs://placeholder");
      setSuccessMsg("Transaction submitted. Waiting for confirmation...");
      await tx.wait();
      setSuccessMsg(`✅ Invoice #${formData.invoiceNumber} uploaded & minted as NFT!`);
      setFormData({ invoiceNumber: "", amountEth: "", dueDateDays: "", borrowerAddress: account });
      fetchInvoices();
    } catch (err) {
      console.error(err);
      setErrorMsg(`Minting failed: ${parseContractError(err)}`);
    } finally { setLoading(false); }
  };

  // ─── P2P Finance (legacy individual investor) ─────────────────────────
  const handleFinanceInvoice = async (inv) => {
    setErrorMsg(""); setSuccessMsg("");
    if (inv.borrower.toLowerCase() === account.toLowerCase()) {
      setErrorMsg("You cannot finance your own invoice."); return;
    }
    try {
      setLoading(true);
      const tx = await contract.financeInvoice(inv.tokenId, { value: inv.amountWei });
      setSuccessMsg(`Financing ${inv.amount} ETH... waiting for confirmation...`);
      await tx.wait();
      setSuccessMsg(`🎉 Invoice #${inv.invoiceNumber} financed! ETH sent to supplier.`);
      fetchInvoices();
    } catch (err) {
      console.error(err);
      setErrorMsg(`Financing failed: ${parseContractError(err)}`);
    } finally { setLoading(false); }
  };

  // ─── Pool: Deposit ────────────────────────────────────────────────────
  const handleDeposit = async (e) => {
    e.preventDefault();
    setErrorMsg(""); setSuccessMsg("");
    if (!depositAmount || parseFloat(depositAmount) <= 0) return;
    try {
      setLoading(true);
      const tx = await poolContract.depositLiquidity({ value: ethers.parseEther(depositAmount) });
      setSuccessMsg("Deposit submitted. Waiting for confirmation...");
      await tx.wait();
      setSuccessMsg(`✅ Deposited ${depositAmount} ETH. You received IPS share tokens!`);
      setDepositAmount("");
      fetchPoolStats();
    } catch (err) {
      console.error(err);
      setErrorMsg(`Deposit failed: ${err.reason || err.message}`);
    } finally { setLoading(false); }
  };

  // ─── Pool: Withdraw ───────────────────────────────────────────────────
  const handleWithdraw = async (e) => {
    e.preventDefault();
    setErrorMsg(""); setSuccessMsg("");
    if (!withdrawShares || parseFloat(withdrawShares) <= 0) return;
    try {
      setLoading(true);
      const tx = await poolContract.withdrawLiquidity(ethers.parseEther(withdrawShares));
      setSuccessMsg("Withdrawal submitted. Waiting for confirmation...");
      await tx.wait();
      setSuccessMsg(`✅ Withdrew liquidity successfully! ETH + yield returned.`);
      setWithdrawShares("");
      fetchPoolStats();
    } catch (err) {
      console.error(err);
      setErrorMsg(`Withdrawal failed: ${err.reason || err.message}`);
    } finally { setLoading(false); }
  };

  // ─── Pool: Request Financing ──────────────────────────────────────────
  const handleRequestPoolFinancing = async (inv) => {
    setErrorMsg(""); setSuccessMsg("");
    try {
      setLoading(true);
      const tx = await poolContract.requestPoolFinancing(inv.tokenId);
      setSuccessMsg(`Requesting pool financing for Invoice #${inv.invoiceNumber}...`);
      await tx.wait();
      setSuccessMsg(`🎉 Invoice #${inv.invoiceNumber} financed by the pool! ${inv.amount} ETH sent to you.`);
      fetchInvoices();
      fetchPoolStats();
    } catch (err) {
      console.error(err);
      setErrorMsg(`Pool financing failed: ${err.reason || err.message}`);
    } finally { setLoading(false); }
  };

  // ─── Pool: Repay ──────────────────────────────────────────────────────
  const handleRepayInvoice = async (inv) => {
    setErrorMsg(""); setSuccessMsg("");
    const loan = loanDetails[inv.tokenId];
    if (!loan) { setErrorMsg("No active pool loan found for this invoice."); return; }
    try {
      setLoading(true);
      const repayWei = ethers.parseEther(loan.repayAmount);
      const tx = await poolContract.repayInvoice(inv.tokenId, { value: repayWei });
      setSuccessMsg(`Repaying ${loan.repayAmount} ETH (incl. 5% interest)...`);
      await tx.wait();
      setSuccessMsg(`✅ Invoice #${inv.invoiceNumber} repaid! Pool yield distributed to investors.`);
      fetchInvoices();
      fetchPoolStats();
    } catch (err) {
      console.error(err);
      setErrorMsg(`Repayment failed: ${err.reason || err.message}`);
    } finally { setLoading(false); }
  };

  if (!contract) {
    return (
      <div className="p-8 text-center text-gray-500">
        Please connect your wallet to access the Invoice Financing Platform.
      </div>
    );
  }

  // ─── Render ────────────────────────────────────────────────────────────
  return (
    <div className="max-w-6xl mx-auto p-4 sm:p-6">

      {/* Notifications */}
      {errorMsg && (
        <div className="mb-4 p-4 bg-red-100 text-red-700 border border-red-200 rounded-lg shadow-sm flex justify-between items-center">
          <span>{errorMsg}</span>
          <button onClick={() => setErrorMsg("")} className="text-red-700 font-bold">&times;</button>
        </div>
      )}
      {successMsg && (
        <div className="mb-4 p-4 bg-green-100 text-green-700 border border-green-200 rounded-lg shadow-sm flex justify-between items-center">
          <span>{successMsg}</span>
          <button onClick={() => setSuccessMsg("")} className="text-green-700 font-bold">&times;</button>
        </div>
      )}

      {/* Tab Navigation */}
      <div className="flex flex-wrap gap-1 border-b border-gray-200 mb-6">
        {[
          { id: "supplier", label: "📤 Supplier (Upload Invoice)" },
          { id: "investor", label: "💎 P2P Marketplace" },
          { id: "pool",     label: "💧 Pool Financing (AMM)" }
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`py-3 px-5 font-medium text-sm transition-colors cursor-pointer ${
              activeTab === tab.id
                ? "border-b-2 border-indigo-600 text-indigo-600 font-bold"
                : "text-gray-500 hover:text-gray-700 border-b-2 border-transparent"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {loading && (
        <div className="text-center py-4">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" />
          <p className="mt-2 text-gray-600 text-sm">Communicating with Ethereum Blockchain...</p>
        </div>
      )}

      {/* ═══════════════ TAB 1: SUPPLIER ═══════════════ */}
      {activeTab === "supplier" && (
        <div className="space-y-8">
          {/* Supplier Staking Tier Benefit Card */}
          <div className="bg-gradient-to-r from-purple-900 to-indigo-900 text-white rounded-2xl p-5 shadow-sm border border-purple-800 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs uppercase font-bold tracking-wider text-purple-200">Supplier Credit Tier</span>
                <span className={`text-xs px-2.5 py-0.5 rounded-full font-bold ${
                  supplierTier.tier === 2 ? "bg-amber-400 text-amber-950" :
                  supplierTier.tier === 1 ? "bg-indigo-200 text-indigo-950" :
                  "bg-gray-200 text-gray-800"
                }`}>
                  {supplierTier.tier === 2 ? "🥇 Gold Tier" : supplierTier.tier === 1 ? "🥈 Silver Tier" : "🥉 Bronze Tier"}
                </span>
              </div>
              <p className="text-xs text-purple-200 mt-1">
                Active Staked: <strong>{parseFloat(supplierTier.stakedAmount).toFixed(0)} INVX</strong> | Financing Fee Discount: <strong>{(supplierTier.discountBps / 100).toFixed(1)}%</strong> | Max Financing Cap: <strong>${parseFloat(supplierTier.financingLimit).toLocaleString()}</strong>
              </p>
            </div>
            {supplierTier.tier < 2 && (
              <div className="text-right">
                <p className="text-[11px] text-purple-200 mb-1">
                  {supplierTier.tier === 0 ? "Stake 1,000 INVX to unlock Silver Tier (-1.0% fees)" : "Stake 5,000 INVX to unlock Gold Tier (-2.5% fees)"}
                </p>
                <span className="text-xs bg-white/20 px-3 py-1.5 rounded-lg font-bold text-white">
                  Stake INVX in Vault & Staking Tab
                </span>
              </div>
            )}
          </div>

          <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 mb-4">
              <div>
                <h2 className="text-xl font-bold text-gray-800">Upload & Tokenize Invoice</h2>
                <p className="text-sm text-gray-500">
                  Tokenize your unpaid invoice as an NFT. You can then seek funding from individual P2P investors
                  or request instant financing from the shared Liquidity Pool.
                </p>
              </div>

              {/* Currency Denomination Toggle (Experiment 7) */}
              <div className="flex items-center gap-1 bg-gray-100 p-1 rounded-xl text-xs font-semibold">
                <button
                  type="button"
                  onClick={() => setMintMode("ETH")}
                  className={`px-3 py-1.5 rounded-lg transition-all ${
                    mintMode === "ETH"
                      ? "bg-white text-indigo-700 shadow-xs font-bold"
                      : "text-gray-500 hover:text-gray-700"
                  }`}
                >
                  Ξ ETH Mode
                </button>
                <button
                  type="button"
                  onClick={() => setMintMode("USD")}
                  className={`px-3 py-1.5 rounded-lg transition-all flex items-center gap-1 ${
                    mintMode === "USD"
                      ? "bg-white text-indigo-700 shadow-xs font-bold"
                      : "text-gray-500 hover:text-gray-700"
                  }`}
                >
                  💵 USD Mode
                  <span className="text-[10px] text-purple-600 bg-purple-50 border border-purple-200 px-1 rounded">
                    Chainlink
                  </span>
                </button>
              </div>
            </div>

            <form onSubmit={handleMint} className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Supplier Wallet Address</label>
                <input type="text" value={formData.borrowerAddress}
                  onChange={(e) => setFormData({ ...formData, borrowerAddress: e.target.value })}
                  className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
                  placeholder="0x..." />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Invoice Number / Serial #</label>
                <input type="text" value={formData.invoiceNumber}
                  onChange={(e) => setFormData({ ...formData, invoiceNumber: e.target.value })}
                  className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
                  placeholder="e.g. INV-2026-880" />
              </div>

              {/* Funding Amount Input with USD option */}
              {mintMode === "ETH" ? (
                <div>
                  <div className="flex justify-between items-center mb-1">
                    <label className="block text-sm font-medium text-gray-700">Requested Funding Amount (ETH)</label>
                    {oracleEth.isHealthy && formData.amountEth && parseFloat(formData.amountEth) > 0 && (
                      <span className="text-xs text-indigo-600 font-semibold font-mono">
                        ≈ ${parseFloat(oracleEth.ethToUsd(formData.amountEth) || "0").toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD
                      </span>
                    )}
                  </div>
                  <input type="number" step="0.0001" value={formData.amountEth}
                    onChange={(e) => setFormData({ ...formData, amountEth: e.target.value })}
                    className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
                    placeholder="e.g. 0.05" />
                </div>
              ) : (
                <div>
                  <div className="flex justify-between items-center mb-1">
                    <label className="block text-sm font-medium text-gray-700">Requested Funding Amount (USD)</label>
                    <span className="text-xs text-purple-600 font-semibold">
                      Chainlink Rate: ${parseFloat(oracleEth.price || "0").toFixed(2)}
                    </span>
                  </div>
                  <input
                    type="number"
                    step="0.01"
                    value={usdInput}
                    disabled={!oracleEth.isHealthy}
                    onChange={(e) => {
                      const val = e.target.value;
                      setUsdInput(val);
                      if (val && parseFloat(val) > 0 && oracleEth.isHealthy) {
                        const calculatedEth = oracleEth.usdToEth(val);
                        setFormData((prev) => ({ ...prev, amountEth: calculatedEth || "" }));
                      } else {
                        setFormData((prev) => ({ ...prev, amountEth: "" }));
                      }
                    }}
                    className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none disabled:bg-gray-100"
                    placeholder={oracleEth.isHealthy ? "e.g. 1500.00" : "Price unavailable, try again shortly"}
                  />
                  {formData.amountEth && (
                    <div className="mt-1.5 p-2 bg-purple-50 border border-purple-200 rounded-lg text-xs text-purple-900">
                      Calculated On-Chain Mint Amount: <strong className="font-mono text-purple-950">{parseFloat(formData.amountEth).toFixed(6)} ETH</strong>
                      <span className="block text-[10px] text-purple-600 mt-0.5">
                        Note: The ETH amount is locked at listing time via Chainlink oracle rate.
                      </span>
                    </div>
                  )}
                  {!oracleEth.isHealthy && (
                    <p className="text-xs text-rose-600 mt-1 font-semibold">
                      ⚠️ Circuit breaker active: Chainlink price feed unavailable or stale. USD mode is temporarily disabled.
                    </p>
                  )}
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Repayment Term (Days)</label>
                <input type="number" value={formData.dueDateDays}
                  onChange={(e) => setFormData({ ...formData, dueDateDays: e.target.value })}
                  className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
                  placeholder="e.g. 30" />
              </div>

              {/* Advisory Tier Cap Warning (UI-only) */}
              {oracleEth.isHealthy && formData.amountEth && parseFloat(formData.amountEth) > 0 && (() => {
                const usdValue = parseFloat(oracleEth.ethToUsd(formData.amountEth) || "0");
                const limit = parseFloat(supplierTier.financingLimit || "10000");
                if (usdValue > limit) {
                  return (
                    <div className="md:col-span-2 p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-800">
                      <div className="font-bold flex items-center gap-1">
                        <span>⚠️ Financing Cap Advisory (UI only)</span>
                      </div>
                      <p className="mt-0.5">
                        This invoice value (≈ ${usdValue.toLocaleString(undefined, { maximumFractionDigits: 0 })} USD) exceeds your current {supplierTier.name} tier financing limit (${limit.toLocaleString()} USD). You can still tokenize this invoice, but financing through TierGate hooks may require staking more INVX to upgrade your tier.
                      </p>
                    </div>
                  );
                }
                return null;
              })()}

              <div className="md:col-span-2 mt-2">
                <button
                  type="submit"
                  disabled={loading || (mintMode === "USD" && !oracleEth.isHealthy)}
                  className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-medium py-3 px-4 rounded-lg transition-colors shadow-sm disabled:bg-gray-400 cursor-pointer text-base"
                >
                  {loading
                    ? "Processing..."
                    : mintMode === "USD" && !oracleEth.isHealthy
                    ? "Price unavailable, try again shortly"
                    : "🚀 Upload & Tokenize Invoice NFT"}
                </button>
              </div>
            </form>
          </div>

          {/* My Invoices */}
          <div>
            <h2 className="text-xl font-bold text-gray-800 mb-4">My Uploaded Invoices</h2>
            {myInvoices.length === 0 ? (
              <p className="text-gray-500 bg-white p-6 rounded-xl border border-gray-200 text-center">
                You haven't uploaded any invoices yet.
              </p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {myInvoices.map((inv) => {
                  const loan = loanDetails[inv.tokenId];
                  return (
                    <div key={inv.tokenId} className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm hover:shadow-md transition-shadow">
                      <div className="p-5">
                        <div className="flex justify-between items-start mb-4">
                          <span className="font-semibold text-lg text-gray-800">#{inv.invoiceNumber}</span>
                          {inv.isFinanced ? (
                            <span className="bg-green-100 text-green-800 text-xs px-2.5 py-1 rounded-full font-bold">✅ Financed</span>
                          ) : (
                            <span className="bg-yellow-100 text-yellow-800 text-xs px-2.5 py-1 rounded-full font-bold">⏳ Awaiting</span>
                          )}
                        </div>
                        <div className="space-y-2 text-sm">
                          <div className="flex justify-between items-center">
                            <span className="text-gray-500">Value:</span>
                            <span className="font-semibold text-indigo-600">
                              {inv.amount} ETH
                              {oracleEth.isHealthy && (
                                <span className="text-xs text-gray-400 font-normal ml-1">
                                  (≈ ${parseFloat(oracleEth.ethToUsd(inv.amount) || "0").toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })})
                                </span>
                              )}
                            </span>
                          </div>
                          <div className="flex justify-between"><span className="text-gray-500">Due:</span><span>{inv.dueDate}</span></div>
                          {inv.isFinanced && inv.investor && (
                            <div className="flex justify-between pt-2 border-t border-gray-100">
                              <span className="text-gray-500">Financed By:</span>
                              <span className="font-mono text-xs text-green-700">
                                {inv.investor.toLowerCase() === POOL_CONTRACT_ADDRESS.toLowerCase()
                                  ? "💧 Pool"
                                  : `${inv.investor.slice(0, 6)}...${inv.investor.slice(-4)}`}
                              </span>
                            </div>
                          )}
                          {/* Pool loan repayment section */}
                          {loan && !loan.repaid && (
                            <div className="pt-2 border-t border-amber-100 bg-amber-50 -mx-5 px-5 pb-3 rounded-b-xl">
                              <p className="text-xs text-amber-700 mb-2">
                                Pool Loan Active — Repay <strong>{loan.repayAmount} ETH</strong> (incl. 5% interest)
                              </p>
                              <button onClick={() => handleRepayInvoice(inv)} disabled={loading}
                                className="w-full bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold py-2 rounded-lg cursor-pointer disabled:opacity-50">
                                💳 Repay Pool Loan
                              </button>
                            </div>
                          )}
                          {loan && loan.repaid && (
                            <div className="pt-2 text-center text-xs text-green-600 font-semibold">✅ Pool Loan Repaid</div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ═══════════════ TAB 2: P2P MARKETPLACE ═══════════════ */}
      {activeTab === "investor" && (
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
          <div className="mb-6">
            <h2 className="text-xl font-bold text-gray-800">P2P Crowdlending Marketplace</h2>
            <p className="text-sm text-gray-500">Browse invoices and provide direct 1-on-1 ETH financing to suppliers.</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-gray-600">
              <thead className="bg-gray-50 text-gray-700 uppercase">
                <tr>
                  <th className="px-6 py-3 rounded-tl-lg">Token ID</th>
                  <th className="px-6 py-3">Invoice #</th>
                  <th className="px-6 py-3">Supplier</th>
                  <th className="px-6 py-3">Amount</th>
                  <th className="px-6 py-3">Due Date</th>
                  <th className="px-6 py-3">Status</th>
                  <th className="px-6 py-3 text-right rounded-tr-lg">Action</th>
                </tr>
              </thead>
              <tbody>
                {allInvoices.length === 0 ? (
                  <tr><td colSpan="7" className="px-6 py-8 text-center text-gray-500">No invoices listed yet.</td></tr>
                ) : (
                  allInvoices.map((inv) => (
                    <tr key={inv.tokenId} className="border-b border-gray-100 hover:bg-gray-50">
                      <td className="px-6 py-4 font-medium text-gray-900">#{inv.tokenId}</td>
                      <td className="px-6 py-4 font-semibold">{inv.invoiceNumber}</td>
                      <td className="px-6 py-4 font-mono text-xs">{inv.borrower.slice(0, 6)}...{inv.borrower.slice(-4)}</td>
                      <td className="px-6 py-4 font-bold text-indigo-600">
                        {inv.amount} ETH
                        {oracleEth.isHealthy && (
                          <div className="text-[11px] text-gray-400 font-normal">
                            ≈ ${parseFloat(oracleEth.ethToUsd(inv.amount) || "0").toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </div>
                        )}
                      </td>
                      <td className="px-6 py-4">{inv.dueDate}</td>
                      <td className="px-6 py-4">
                        {inv.isFinanced ? (
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-green-100 text-green-800">Financed</span>
                        ) : (
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-100 text-amber-800">Available</span>
                        )}
                      </td>
                      <td className="px-6 py-4 text-right">
                        {inv.isFinanced ? (
                          <span className="text-xs text-gray-400 font-mono">
                            {inv.investor.toLowerCase() === POOL_CONTRACT_ADDRESS.toLowerCase()
                              ? "💧 Pool"
                              : `Funded by ${inv.investor.slice(0, 6)}...`}
                          </span>
                        ) : inv.borrower.toLowerCase() === account.toLowerCase() ? (
                          <span className="text-xs text-gray-400 italic">Your Invoice</span>
                        ) : (
                          <button onClick={() => handleFinanceInvoice(inv)} disabled={loading}
                            className="bg-emerald-600 hover:bg-emerald-700 text-white font-medium text-xs px-4 py-2 rounded-lg transition-colors shadow-sm disabled:opacity-50 cursor-pointer">
                            Finance ({inv.amount} ETH)
                          </button>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ═══════════════ TAB 3: POOL FINANCING ═══════════════ */}
      {activeTab === "pool" && (
        <div className="space-y-6">

          {!POOL_DEPLOYED && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-5 text-amber-800">
              <h3 className="font-bold text-base mb-1">⚠️ Pool Contract Not Yet Deployed</h3>
              <p className="text-sm">
                Deploy <code className="bg-amber-100 px-1 rounded">InvoiceLiquidityPool.sol</code> on Sepolia, then paste the address
                at the top of <code className="bg-amber-100 px-1 rounded">InvoiceFinancing.jsx</code> as <code className="bg-amber-100 px-1 rounded">POOL_CONTRACT_ADDRESS</code>.
              </p>
              <p className="text-xs mt-2 text-amber-600">Constructor argument: <strong>{INVOICE_CONTRACT_ADDRESS}</strong> (your InvoiceNFT address)</p>
            </div>
          )}

          {/* How It Works Banner */}
          <div className="bg-gradient-to-r from-indigo-900 to-purple-900 text-white rounded-2xl p-6">
            <h2 className="text-xl font-bold mb-1">💧 Invoice Liquidity Pool</h2>
            <p className="text-indigo-200 text-sm mb-4">
              Powered by AMM mechanics — investors pool ETH together, suppliers get instant financing, repayments + 5% interest grow the pool automatically.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-center text-xs">
              <div className="bg-white/10 rounded-xl p-3">
                <div className="text-2xl mb-1">🏦</div>
                <div className="font-bold">Investors Deposit ETH</div>
                <div className="text-indigo-300 mt-1">Receive IPS share tokens proportional to pool size</div>
              </div>
              <div className="bg-white/10 rounded-xl p-3">
                <div className="text-2xl mb-1">⚡</div>
                <div className="font-bold">Pool Auto-Finances</div>
                <div className="text-indigo-300 mt-1">Supplier requests pool financing — ETH transferred instantly</div>
              </div>
              <div className="bg-white/10 rounded-xl p-3">
                <div className="text-2xl mb-1">📈</div>
                <div className="font-bold">Repayment + 5% Yield</div>
                <div className="text-indigo-300 mt-1">Interest stays in pool → IPS share price rises → investors earn</div>
              </div>
            </div>
          </div>

          {/* Pool Stats */}
          {POOL_DEPLOYED && (
            <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
              <div className="flex justify-between items-center mb-4">
                <h3 className="font-bold text-gray-800">Pool Analytics</h3>
                <button onClick={fetchPoolStats} disabled={loading}
                  className="text-xs bg-gray-100 hover:bg-gray-200 text-gray-600 px-3 py-1.5 rounded-lg cursor-pointer">
                  🔄 Refresh
                </button>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                {[
                  {
                    label: "Total Pool ETH",
                    value: `${parseFloat(poolStats.totalPoolETH).toFixed(4)} ETH`,
                    sub: oracleEth.isHealthy ? `≈ $${parseFloat(oracleEth.ethToUsd(poolStats.totalPoolETH) || "0").toLocaleString(undefined, { maximumFractionDigits: 0 })}` : null,
                    color: "text-indigo-600"
                  },
                  {
                    label: "Active Loans",
                    value: `${parseFloat(poolStats.totalFinancedETH).toFixed(4)} ETH`,
                    sub: oracleEth.isHealthy ? `≈ $${parseFloat(oracleEth.ethToUsd(poolStats.totalFinancedETH) || "0").toLocaleString(undefined, { maximumFractionDigits: 0 })}` : null,
                    color: "text-amber-600"
                  },
                  {
                    label: "Available Liquidity",
                    value: `${parseFloat(poolStats.availableLiquidity).toFixed(4)} ETH`,
                    sub: oracleEth.isHealthy ? `≈ $${parseFloat(oracleEth.ethToUsd(poolStats.availableLiquidity) || "0").toLocaleString(undefined, { maximumFractionDigits: 0 })}` : null,
                    color: "text-emerald-600"
                  },
                  {
                    label: "IPS Share Price",
                    value: `${parseFloat(poolStats.sharePriceEth).toFixed(6)} ETH`,
                    sub: oracleEth.isHealthy ? `≈ $${(parseFloat(poolStats.sharePriceEth) * parseFloat(oracleEth.price || "0")).toFixed(2)}` : null,
                    color: "text-purple-600"
                  }
                ].map(stat => (
                  <div key={stat.label} className="bg-gray-50 rounded-xl p-3 text-center">
                    <div className="text-xs text-gray-500 uppercase font-bold mb-1">{stat.label}</div>
                    <div className={`text-base font-extrabold ${stat.color}`}>{stat.value}</div>
                    {stat.sub && <div className="text-[10px] text-gray-400 font-medium mt-0.5">{stat.sub}</div>}
                  </div>
                ))}
              </div>
              <UtilizationBar bps={poolStats.utilizationBps} />
              <div className="mt-2 text-xs text-gray-500 text-right">
                Your IPS Balance: <strong className="text-purple-600">{parseFloat(poolStats.userIpsBalance).toFixed(6)} IPS</strong>
                {" | "}Total Supply: <strong>{parseFloat(poolStats.totalSupply).toFixed(4)} IPS</strong>
              </div>
            </div>
          )}

          {/* Investor Actions */}
          {POOL_DEPLOYED && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Deposit */}
              <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
                <h3 className="font-bold text-gray-800 mb-1">💰 Deposit ETH</h3>
                <p className="text-xs text-gray-500 mb-4">Add ETH to the pool and receive IPS share tokens. Your share grows as interest accrues.</p>
                <form onSubmit={handleDeposit} className="space-y-3">
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1">Amount to Deposit (ETH)</label>
                    <input type="number" step="0.001" value={depositAmount}
                      onChange={(e) => setDepositAmount(e.target.value)}
                      placeholder="e.g. 0.1"
                      className="w-full p-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none font-medium" />
                  </div>
                  {depositAmount && parseFloat(depositAmount) > 0 && (
                    <div className="bg-indigo-50 border border-indigo-100 rounded-xl p-3 text-xs text-indigo-800 space-y-1">
                      <div>
                        Est. IPS shares: <strong>
                          {parseFloat(poolStats.totalSupply) === 0
                            ? parseFloat(depositAmount).toFixed(6)
                            : ((parseFloat(depositAmount) * parseFloat(poolStats.totalSupply)) / (parseFloat(poolStats.totalPoolETH) || 1)).toFixed(6)
                          } IPS
                        </strong>
                      </div>
                      {oracleEth.isHealthy && (
                        <div className="text-[11px] text-indigo-600">
                          USD Valuation: ≈ ${parseFloat(oracleEth.ethToUsd(depositAmount) || "0").toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </div>
                      )}
                    </div>
                  )}
                  <button type="submit" disabled={loading || !depositAmount}
                    className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-3 rounded-xl cursor-pointer disabled:opacity-50">
                    {loading ? "Processing..." : "Deposit ETH → Get IPS Shares"}
                  </button>
                </form>
              </div>

              {/* Withdraw */}
              <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
                <h3 className="font-bold text-gray-800 mb-1">📤 Withdraw Liquidity</h3>
                <p className="text-xs text-gray-500 mb-4">Burn your IPS tokens to reclaim ETH + proportional yield earned from supplier repayments.</p>
                <form onSubmit={handleWithdraw} className="space-y-3">
                  <div>
                    <div className="flex justify-between text-xs text-gray-600 mb-1">
                      <label className="font-semibold">IPS Shares to Burn</label>
                      <button type="button" onClick={() => setWithdrawShares(poolStats.userIpsBalance)}
                        className="text-indigo-600 font-bold hover:underline">
                        Max ({parseFloat(poolStats.userIpsBalance).toFixed(4)})
                      </button>
                    </div>
                    <input type="number" step="any" value={withdrawShares}
                      onChange={(e) => setWithdrawShares(e.target.value)}
                      placeholder="0.0"
                      className="w-full p-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none font-medium" />
                  </div>
                  {withdrawShares && parseFloat(withdrawShares) > 0 && parseFloat(poolStats.totalSupply) > 0 && (
                    <div className="bg-purple-50 border border-purple-100 rounded-xl p-3 text-xs text-purple-800">
                      Est. ETH returned: <strong>
                        {((parseFloat(withdrawShares) * parseFloat(poolStats.totalPoolETH)) / parseFloat(poolStats.totalSupply)).toFixed(6)} ETH
                      </strong>
                    </div>
                  )}
                  <button type="submit" disabled={loading || !withdrawShares || parseFloat(poolStats.userIpsBalance) <= 0}
                    className="w-full bg-purple-600 hover:bg-purple-700 text-white font-bold py-3 rounded-xl cursor-pointer disabled:opacity-50">
                    {loading ? "Processing..." : "Burn IPS → Withdraw ETH"}
                  </button>
                </form>
              </div>
            </div>
          )}

          {/* Supplier: Request Pool Financing */}
          {POOL_DEPLOYED && (
            <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
              <h3 className="font-bold text-gray-800 mb-1">⚡ Request Pool Financing (Supplier)</h3>
              <p className="text-xs text-gray-500 mb-4">
                Instead of waiting for an individual P2P investor, request instant financing from the shared pool.
                You'll need to repay the principal + 5% interest before the due date.
              </p>
              {myInvoices.filter(inv => !inv.isFinanced).length === 0 ? (
                <p className="text-center text-gray-400 py-4">
                  No unfinanced invoices found. Upload an invoice in the Supplier tab first.
                </p>
              ) : (
                <div className="space-y-3">
                  {myInvoices.filter(inv => !inv.isFinanced).map(inv => (
                    <div key={inv.tokenId} className="flex items-center justify-between p-4 border border-gray-100 rounded-xl bg-gray-50">
                      <div>
                        <span className="font-semibold text-gray-800">#{inv.invoiceNumber}</span>
                        <span className="text-indigo-600 font-bold ml-3">{inv.amount} ETH</span>
                        {oracleEth.isHealthy && (
                          <span className="text-xs text-gray-400 font-normal ml-1">
                            (≈ ${parseFloat(oracleEth.ethToUsd(inv.amount) || "0").toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })})
                          </span>
                        )}
                        <span className="text-xs text-gray-400 ml-2">Due: {inv.dueDate}</span>
                      </div>
                      <div className="text-right">
                        <div className="text-xs text-gray-500 mb-1">
                          Repay: <strong>{(parseFloat(inv.amount) * 1.05).toFixed(5)} ETH</strong> (5% interest)
                          {oracleEth.isHealthy && (
                            <span className="text-gray-400 font-normal ml-1">
                              (≈ ${parseFloat(oracleEth.ethToUsd(parseFloat(inv.amount) * 1.05) || "0").toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })})
                            </span>
                          )}
                        </div>
                        <button
                          onClick={() => handleRequestPoolFinancing(inv)}
                          disabled={loading || parseFloat(poolStats.availableLiquidity) < parseFloat(inv.amount)}
                          className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold px-4 py-2 rounded-lg cursor-pointer disabled:opacity-50"
                        >
                          {parseFloat(poolStats.availableLiquidity) < parseFloat(inv.amount)
                            ? "⚠️ Insufficient Pool Liquidity"
                            : "⚡ Get Pool Financing"}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* AMM Concept Info */}
          <div className="bg-slate-50 border border-slate-200 rounded-2xl p-6">
            <h3 className="font-bold text-slate-800 mb-3">📐 How Liquidity Pool Mechanics Work Here</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs text-slate-600">
              <div className="bg-white p-4 rounded-xl border border-slate-100">
                <h4 className="font-bold text-slate-800 mb-2">IPS Share Pricing (AMM-inspired)</h4>
                <p>Share price = <code className="bg-gray-100 px-1 rounded">totalPoolETH / totalSupply(IPS)</code></p>
                <p className="mt-1">As suppliers repay with 5% interest, <code>totalPoolETH</code> grows → each IPS share becomes worth more ETH — exactly like LP token appreciation in Uniswap/Aave.</p>
              </div>
              <div className="bg-white p-4 rounded-xl border border-slate-100">
                <h4 className="font-bold text-slate-800 mb-2">Utilization Rate</h4>
                <p>Utilization = <code className="bg-gray-100 px-1 rounded">financedETH / totalPoolETH</code></p>
                <p className="mt-1">Capped at 80% — ensures investors can always withdraw. The remaining 20% is idle buffer (similar to Aave's liquidity reserve model).</p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
