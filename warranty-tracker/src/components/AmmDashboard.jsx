import { useState, useEffect } from "react";
import { ethers } from "ethers";
import {
  TOKEN_A_ADDRESS,
  TOKEN_B_ADDRESS,
  SIMPLE_AMM_ADDRESS,
  MOCK_ERC20_ABI,
  SIMPLE_AMM_ABI
} from "../config/ammConfig";

export default function AmmDashboard({ signer, account }) {
  // Contract Addresses (editable for testnet flexibility)
  const [tokenAAddr, setTokenAAddr] = useState(
    TOKEN_A_ADDRESS !== "0x0000000000000000000000000000000000000000" ? TOKEN_A_ADDRESS : ""
  );
  const [tokenBAddr, setTokenBAddr] = useState(
    TOKEN_B_ADDRESS !== "0x0000000000000000000000000000000000000000" ? TOKEN_B_ADDRESS : ""
  );
  const [ammAddr, setAmmAddr] = useState(
    SIMPLE_AMM_ADDRESS !== "0x0000000000000000000000000000000000000000" ? SIMPLE_AMM_ADDRESS : ""
  );

  // Pool State
  const [reserveA, setReserveA] = useState("0");
  const [reserveB, setReserveB] = useState("0");
  const [kInvariant, setKInvariant] = useState("0");
  const [totalLpSupply, setTotalLpSupply] = useState("0");
  const [userLpBalance, setUserLpBalance] = useState("0");
  const [userSharePercent, setUserSharePercent] = useState("0");

  // User Token Balances & Allowances
  const [tokenABalance, setTokenABalance] = useState("0");
  const [tokenBBalance, setTokenBBalance] = useState("0");
  const [tokenASymbol, setTokenASymbol] = useState("TKA");
  const [tokenBSymbol, setTokenBSymbol] = useState("TKB");
  const [allowanceA, setAllowanceA] = useState("0");
  const [allowanceB, setAllowanceB] = useState("0");

  // Action Tabs: 'add' | 'swap' | 'remove'
  const [activeTab, setActiveTab] = useState("add");

  // Add Liquidity State
  const [addAmountA, setAddAmountA] = useState("");
  const [addAmountB, setAddAmountB] = useState("");
  const [estLpMinted, setEstLpMinted] = useState("0");

  // Swap State
  const [swapDirection, setSwapDirection] = useState("AtoB"); // 'AtoB' | 'BtoA'
  const [swapAmountIn, setSwapAmountIn] = useState("");
  const [swapEstimatedOut, setSwapEstimatedOut] = useState("0");

  // Remove Liquidity State
  const [removeLpAmount, setRemoveLpAmount] = useState("");
  const [estReturnA, setEstReturnA] = useState("0");
  const [estReturnB, setEstReturnB] = useState("0");

  // UI status
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  const isConfigured =
    ethers.isAddress(tokenAAddr) &&
    ethers.isAddress(tokenBAddr) &&
    ethers.isAddress(ammAddr);

  // Auto-refresh pool and user data
  useEffect(() => {
    if (isConfigured && signer && account) {
      loadData();
    }
  }, [tokenAAddr, tokenBAddr, ammAddr, signer, account]);

  // Load balances, reserves, allowances
  const loadData = async () => {
    if (!isConfigured || !signer || !account) return;
    try {
      setErrorMsg("");
      const tokenAContract = new ethers.Contract(tokenAAddr, MOCK_ERC20_ABI, signer);
      const tokenBContract = new ethers.Contract(tokenBAddr, MOCK_ERC20_ABI, signer);
      const ammContract = new ethers.Contract(ammAddr, SIMPLE_AMM_ABI, signer);

      // Fetch symbols
      try {
        const symA = await tokenAContract.symbol();
        const symB = await tokenBContract.symbol();
        setTokenASymbol(symA);
        setTokenBSymbol(symB);
      } catch (e) {
        console.warn("Could not read symbols", e);
      }

      // Fetch User Balances
      const [balA, balB, lpBal] = await Promise.all([
        tokenAContract.balanceOf(account),
        tokenBContract.balanceOf(account),
        ammContract.balanceOf(account)
      ]);

      setTokenABalance(ethers.formatEther(balA));
      setTokenBBalance(ethers.formatEther(balB));
      setUserLpBalance(ethers.formatEther(lpBal));

      // Fetch Allowances for AMM contract
      const [allowA, allowB] = await Promise.all([
        tokenAContract.allowance(account, ammAddr),
        tokenBContract.allowance(account, ammAddr)
      ]);
      setAllowanceA(ethers.formatEther(allowA));
      setAllowanceB(ethers.formatEther(allowB));

      // Fetch Reserves & Total Supply
      const [reserves, lpSupply] = await Promise.all([
        ammContract.getReserves(),
        ammContract.totalSupply()
      ]);

      const rA = reserves[0];
      const rB = reserves[1];
      setReserveA(ethers.formatEther(rA));
      setReserveB(ethers.formatEther(rB));
      setTotalLpSupply(ethers.formatEther(lpSupply));

      // Calculate invariant k = x * y
      const rANum = parseFloat(ethers.formatEther(rA));
      const rBNum = parseFloat(ethers.formatEther(rB));
      const kVal = rANum * rBNum;
      setKInvariant(kVal.toLocaleString(undefined, { maximumFractionDigits: 4 }));

      // Calculate user share %
      if (lpSupply > 0n) {
        const sharePct = (Number(lpBal * 10000n / lpSupply) / 100).toFixed(2);
        setUserSharePercent(sharePct);
      } else {
        setUserSharePercent("0");
      }
    } catch (err) {
      console.error("Error loading AMM data:", err);
      setErrorMsg("Failed to read AMM contract data. Check addresses & network.");
    }
  };

  // Estimate LP shares when adding liquidity
  useEffect(() => {
    if (!addAmountA || !addAmountB || parseFloat(addAmountA) <= 0 || parseFloat(addAmountB) <= 0) {
      setEstLpMinted("0");
      return;
    }
    try {
      const a = parseFloat(addAmountA);
      const b = parseFloat(addAmountB);
      const totalLp = parseFloat(totalLpSupply);

      if (totalLp === 0 || parseFloat(reserveA) === 0 || parseFloat(reserveB) === 0) {
        // sqrt(a * b)
        const est = Math.sqrt(a * b);
        setEstLpMinted(est.toFixed(6));
      } else {
        const shareA = (a * totalLp) / parseFloat(reserveA);
        const shareB = (b * totalLp) / parseFloat(reserveB);
        const est = Math.min(shareA, shareB);
        setEstLpMinted(est.toFixed(6));
      }
    } catch {
      setEstLpMinted("0");
    }
  }, [addAmountA, addAmountB, totalLpSupply, reserveA, reserveB]);

  // Estimate swap output
  useEffect(() => {
    if (!swapAmountIn || parseFloat(swapAmountIn) <= 0) {
      setSwapEstimatedOut("0");
      return;
    }
    try {
      const rIn = swapDirection === "AtoB" ? parseFloat(reserveA) : parseFloat(reserveB);
      const rOut = swapDirection === "AtoB" ? parseFloat(reserveB) : parseFloat(reserveA);

      if (rIn <= 0 || rOut <= 0) {
        setSwapEstimatedOut("0");
        return;
      }

      const amtIn = parseFloat(swapAmountIn);
      const newRIn = rIn + amtIn;
      const newROut = (rIn * rOut) / newRIn;
      const amtOut = rOut - newROut;
      setSwapEstimatedOut(amtOut.toFixed(6));
    } catch {
      setSwapEstimatedOut("0");
    }
  }, [swapAmountIn, swapDirection, reserveA, reserveB]);

  // Estimate returned assets on liquidity removal
  useEffect(() => {
    if (!removeLpAmount || parseFloat(removeLpAmount) <= 0 || parseFloat(totalLpSupply) <= 0) {
      setEstReturnA("0");
      setEstReturnB("0");
      return;
    }
    try {
      const lp = parseFloat(removeLpAmount);
      const totalLp = parseFloat(totalLpSupply);
      const retA = (lp * parseFloat(reserveA)) / totalLp;
      const retB = (lp * parseFloat(reserveB)) / totalLp;
      setEstReturnA(retA.toFixed(6));
      setEstReturnB(retB.toFixed(6));
    } catch {
      setEstReturnA("0");
      setEstReturnB("0");
    }
  }, [removeLpAmount, totalLpSupply, reserveA, reserveB]);

  // Faucet: Mint Mock Tokens
  const handleMintTestTokens = async (tokenKey) => {
    if (!isConfigured || !signer) return;
    try {
      setLoading(true);
      setStatus(`Minting 1,000 ${tokenKey === "A" ? tokenASymbol : tokenBSymbol}...`);
      const targetAddr = tokenKey === "A" ? tokenAAddr : tokenBAddr;
      const tokenContract = new ethers.Contract(targetAddr, MOCK_ERC20_ABI, signer);
      const tx = await tokenContract.mint(account, ethers.parseEther("1000"));
      await tx.wait();
      setStatus(`Successfully minted 1,000 ${tokenKey === "A" ? tokenASymbol : tokenBSymbol}!`);
      await loadData();
    } catch (err) {
      console.error(err);
      setErrorMsg(err.reason || err.message || "Minting failed");
    } finally {
      setLoading(false);
    }
  };

  // Approve Tokens for AMM
  const handleApprove = async (tokenKey) => {
    if (!isConfigured || !signer) return;
    try {
      setLoading(true);
      setStatus(`Approving ${tokenKey === "A" ? tokenASymbol : tokenBSymbol} for SimpleAMM...`);
      const targetAddr = tokenKey === "A" ? tokenAAddr : tokenBAddr;
      const tokenContract = new ethers.Contract(targetAddr, MOCK_ERC20_ABI, signer);
      // Approve 1,000,000 tokens
      const tx = await tokenContract.approve(ammAddr, ethers.parseEther("1000000"));
      await tx.wait();
      setStatus(`Approval confirmed for ${tokenKey === "A" ? tokenASymbol : tokenBSymbol}!`);
      await loadData();
    } catch (err) {
      console.error(err);
      setErrorMsg(err.reason || err.message || "Approval failed");
    } finally {
      setLoading(false);
    }
  };

  // Add Liquidity
  const handleAddLiquidity = async (e) => {
    e.preventDefault();
    if (!addAmountA || !addAmountB) return;
    try {
      setLoading(true);
      setStatus("Adding liquidity to pool... Please confirm transaction.");
      const ammContract = new ethers.Contract(ammAddr, SIMPLE_AMM_ABI, signer);
      const parsedA = ethers.parseEther(addAmountA);
      const parsedB = ethers.parseEther(addAmountB);

      const tx = await ammContract.addLiquidity(parsedA, parsedB);
      setStatus("Transaction submitted. Waiting for confirmation...");
      await tx.wait();

      setStatus(`Successfully added liquidity! Minted ~${estLpMinted} LP shares.`);
      setAddAmountA("");
      setAddAmountB("");
      await loadData();
    } catch (err) {
      console.error(err);
      setErrorMsg(err.reason || err.message || "Add liquidity failed");
    } finally {
      setLoading(false);
    }
  };

  // Swap Tokens
  const handleSwap = async (e) => {
    e.preventDefault();
    if (!swapAmountIn || parseFloat(swapAmountIn) <= 0) return;
    try {
      setLoading(true);
      setStatus(
        `Swapping ${swapAmountIn} ${swapDirection === "AtoB" ? tokenASymbol : tokenBSymbol}... Confirm in wallet.`
      );
      const ammContract = new ethers.Contract(ammAddr, SIMPLE_AMM_ABI, signer);
      const parsedIn = ethers.parseEther(swapAmountIn);

      const tx =
        swapDirection === "AtoB"
          ? await ammContract.swapAForB(parsedIn)
          : await ammContract.swapBForA(parsedIn);

      setStatus("Swap submitted. Waiting for block confirmation...");
      await tx.wait();

      setStatus(
        `Swap complete! Received ~${swapEstimatedOut} ${swapDirection === "AtoB" ? tokenBSymbol : tokenASymbol}.`
      );
      setSwapAmountIn("");
      await loadData();
    } catch (err) {
      console.error(err);
      setErrorMsg(err.reason || err.message || "Swap failed");
    } finally {
      setLoading(false);
    }
  };

  // Remove Liquidity
  const handleRemoveLiquidity = async (e) => {
    e.preventDefault();
    if (!removeLpAmount || parseFloat(removeLpAmount) <= 0) return;
    try {
      setLoading(true);
      setStatus(`Removing ${removeLpAmount} LP shares... Confirm in wallet.`);
      const ammContract = new ethers.Contract(ammAddr, SIMPLE_AMM_ABI, signer);
      const parsedLp = ethers.parseEther(removeLpAmount);

      const tx = await ammContract.removeLiquidity(parsedLp);
      setStatus("Removal submitted. Waiting for confirmation...");
      await tx.wait();

      setStatus(
        `Successfully removed liquidity! Returned ~${estReturnA} ${tokenASymbol} and ~${estReturnB} ${tokenBSymbol}.`
      );
      setRemoveLpAmount("");
      await loadData();
    } catch (err) {
      console.error(err);
      setErrorMsg(err.reason || err.message || "Remove liquidity failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="text-center mb-8">
        <h1 className="text-3xl font-extrabold text-gray-900 mb-2">
          DeFi Experiment 4: AMM Liquidity Pool
        </h1>
        <p className="text-gray-600 max-w-2xl mx-auto text-sm">
          Interactive Automated Market Maker (AMM) implementing the constant-product invariant{" "}
          <span className="font-mono font-bold text-indigo-600">x * y = k</span> with dynamic LP-share
          accounting and no-fee swaps.
        </p>
      </div>

      {/* Contract Addresses Configuration Accordion / Card */}
      <div className="bg-white border border-gray-200 rounded-xl p-5 mb-6 shadow-sm">
        <div className="flex justify-between items-center mb-3">
          <h2 className="text-sm font-bold text-gray-700 uppercase tracking-wider">
            ⚙️ Deployed Contract Addresses (Sepolia / Localhost)
          </h2>
          <button
            onClick={loadData}
            disabled={loading || !isConfigured}
            className="text-xs bg-gray-100 hover:bg-gray-200 text-gray-700 px-3 py-1.5 rounded-lg transition-colors font-medium cursor-pointer"
          >
            🔄 Refresh Data
          </button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">
              Token A ({tokenASymbol}):
            </label>
            <input
              type="text"
              value={tokenAAddr}
              onChange={(e) => setTokenAAddr(e.target.value.trim())}
              placeholder="0x..."
              className="w-full text-xs font-mono p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">
              Token B ({tokenBSymbol}):
            </label>
            <input
              type="text"
              value={tokenBAddr}
              onChange={(e) => setTokenBAddr(e.target.value.trim())}
              placeholder="0x..."
              className="w-full text-xs font-mono p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">
              SimpleAMM Pool:
            </label>
            <input
              type="text"
              value={ammAddr}
              onChange={(e) => setAmmAddr(e.target.value.trim())}
              placeholder="0x..."
              className="w-full text-xs font-mono p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
            />
          </div>
        </div>
        {!isConfigured && (
          <p className="mt-2 text-xs text-amber-600 font-medium">
            ⚠️ Please paste your deployed Token A, Token B, and SimpleAMM contract addresses above.
          </p>
        )}
      </div>

      {/* Notifications */}
      {status && (
        <div className="mb-4 p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl text-sm flex justify-between items-center shadow-sm">
          <span>{status}</span>
          <button onClick={() => setStatus("")} className="font-bold text-emerald-800 ml-2">
            ×
          </button>
        </div>
      )}
      {errorMsg && (
        <div className="mb-4 p-3 bg-rose-50 border border-rose-200 text-rose-800 rounded-xl text-sm flex justify-between items-center shadow-sm">
          <span>{errorMsg}</span>
          <button onClick={() => setErrorMsg("")} className="font-bold text-rose-800 ml-2">
            ×
          </button>
        </div>
      )}

      {/* Top Analytics Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
          <span className="text-xs text-gray-500 uppercase font-bold tracking-wider">
            Reserve A ({tokenASymbol})
          </span>
          <p className="text-xl font-extrabold text-indigo-600 mt-1">{reserveA}</p>
          <span className="text-[10px] text-gray-400 font-mono">x in constant product</span>
        </div>
        <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
          <span className="text-xs text-gray-500 uppercase font-bold tracking-wider">
            Reserve B ({tokenBSymbol})
          </span>
          <p className="text-xl font-extrabold text-emerald-600 mt-1">{reserveB}</p>
          <span className="text-[10px] text-gray-400 font-mono">y in constant product</span>
        </div>
        <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
          <span className="text-xs text-gray-500 uppercase font-bold tracking-wider">
            Constant Product (k = x * y)
          </span>
          <p className="text-xl font-extrabold text-amber-600 mt-1 truncate">{kInvariant}</p>
          <span className="text-[10px] text-gray-400">Preserved on swaps</span>
        </div>
        <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
          <span className="text-xs text-gray-500 uppercase font-bold tracking-wider">
            Your Pool Share
          </span>
          <p className="text-xl font-extrabold text-purple-600 mt-1">{userSharePercent}%</p>
          <span className="text-[10px] text-gray-400">{userLpBalance} SAMM-LP shares</span>
        </div>
      </div>

      {/* Account Balances & Faucet / Approval Bar */}
      <div className="bg-gradient-to-r from-slate-900 to-indigo-950 text-white rounded-xl p-5 mb-8 shadow-md">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <h3 className="text-sm font-bold uppercase tracking-wider text-indigo-300">
              Wallet Balances & Test Faucet
            </h3>
            <div className="flex flex-wrap gap-4 mt-2 text-sm">
              <div>
                <span className="text-gray-400">{tokenASymbol}: </span>
                <span className="font-bold text-white">{tokenABalance}</span>
                <span className="text-xs text-gray-400 ml-1">(Allowance: {allowanceA})</span>
              </div>
              <div>
                <span className="text-gray-400">{tokenBSymbol}: </span>
                <span className="font-bold text-white">{tokenBBalance}</span>
                <span className="text-xs text-gray-400 ml-1">(Allowance: {allowanceB})</span>
              </div>
              <div>
                <span className="text-gray-400">LP Shares: </span>
                <span className="font-bold text-purple-300">{userLpBalance}</span>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => handleMintTestTokens("A")}
              disabled={loading || !isConfigured}
              className="bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold px-3 py-2 rounded-lg transition-colors cursor-pointer disabled:opacity-50"
            >
              + Mint 1K {tokenASymbol}
            </button>
            <button
              onClick={() => handleMintTestTokens("B")}
              disabled={loading || !isConfigured}
              className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold px-3 py-2 rounded-lg transition-colors cursor-pointer disabled:opacity-50"
            >
              + Mint 1K {tokenBSymbol}
            </button>
            {parseFloat(allowanceA) < 100 && (
              <button
                onClick={() => handleApprove("A")}
                disabled={loading || !isConfigured}
                className="bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold px-3 py-2 rounded-lg transition-colors cursor-pointer disabled:opacity-50"
              >
                ✓ Approve {tokenASymbol}
              </button>
            )}
            {parseFloat(allowanceB) < 100 && (
              <button
                onClick={() => handleApprove("B")}
                disabled={loading || !isConfigured}
                className="bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold px-3 py-2 rounded-lg transition-colors cursor-pointer disabled:opacity-50"
              >
                ✓ Approve {tokenBSymbol}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Main Interaction Card */}
      <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden mb-8">
        {/* Tab Header */}
        <div className="flex border-b border-gray-200 bg-gray-50/50">
          <button
            onClick={() => setActiveTab("add")}
            className={`flex-1 py-4 text-center text-sm font-bold cursor-pointer transition-colors ${
              activeTab === "add"
                ? "border-b-2 border-indigo-600 text-indigo-600 bg-white"
                : "text-gray-500 hover:text-gray-700"
            }`}
          >
            💧 1. Add Liquidity
          </button>
          <button
            onClick={() => setActiveTab("swap")}
            className={`flex-1 py-4 text-center text-sm font-bold cursor-pointer transition-colors ${
              activeTab === "swap"
                ? "border-b-2 border-indigo-600 text-indigo-600 bg-white"
                : "text-gray-500 hover:text-gray-700"
            }`}
          >
            🔄 2. Swap Tokens (x * y = k)
          </button>
          <button
            onClick={() => setActiveTab("remove")}
            className={`flex-1 py-4 text-center text-sm font-bold cursor-pointer transition-colors ${
              activeTab === "remove"
                ? "border-b-2 border-indigo-600 text-indigo-600 bg-white"
                : "text-gray-500 hover:text-gray-700"
            }`}
          >
            📤 3. Remove Liquidity
          </button>
        </div>

        {/* Tab 1: Add Liquidity */}
        {activeTab === "add" && (
          <div className="p-6 max-w-xl mx-auto">
            <h3 className="text-lg font-bold text-gray-800 mb-1">Provide Liquidity</h3>
            <p className="text-xs text-gray-500 mb-6">
              Deposit both assets into the pool to earn proportional LP share tokens.
            </p>

            <form onSubmit={handleAddLiquidity} className="space-y-4">
              <div>
                <div className="flex justify-between text-xs text-gray-600 mb-1">
                  <span>Deposit {tokenASymbol} Amount:</span>
                  <span>Balance: {tokenABalance}</span>
                </div>
                <input
                  type="number"
                  step="any"
                  value={addAmountA}
                  onChange={(e) => setAddAmountA(e.target.value)}
                  placeholder="e.g. 100"
                  required
                  className="w-full p-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none font-medium"
                />
              </div>

              <div>
                <div className="flex justify-between text-xs text-gray-600 mb-1">
                  <span>Deposit {tokenBSymbol} Amount:</span>
                  <span>Balance: {tokenBBalance}</span>
                </div>
                <input
                  type="number"
                  step="any"
                  value={addAmountB}
                  onChange={(e) => setAddAmountB(e.target.value)}
                  placeholder="e.g. 100"
                  required
                  className="w-full p-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none font-medium"
                />
              </div>

              {/* Simulation Result */}
              <div className="bg-indigo-50/70 border border-indigo-100 rounded-xl p-4 text-xs text-indigo-900 space-y-1">
                <div className="flex justify-between">
                  <span>Estimated LP Shares to receive:</span>
                  <span className="font-bold text-indigo-700">{estLpMinted} SAMM-LP</span>
                </div>
                <div className="flex justify-between text-gray-500 text-[11px]">
                  <span>Accounting Rule:</span>
                  <span>
                    {parseFloat(totalLpSupply) === 0
                      ? "First Provider: sqrt(amountA * amountB)"
                      : "Subsequent: min(shareA, shareB)"}
                  </span>
                </div>
              </div>

              <button
                type="submit"
                disabled={loading || !isConfigured}
                className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-3.5 rounded-xl shadow transition-all cursor-pointer disabled:opacity-50"
              >
                {loading ? "Processing..." : "Add Liquidity"}
              </button>
            </form>
          </div>
        )}

        {/* Tab 2: Swap */}
        {activeTab === "swap" && (
          <div className="p-6 max-w-xl mx-auto">
            <div className="flex justify-between items-center mb-4">
              <div>
                <h3 className="text-lg font-bold text-gray-800">Token Swap</h3>
                <p className="text-xs text-gray-500">
                  Instant trade executed against the constant-product liquidity pool.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setSwapDirection(swapDirection === "AtoB" ? "BtoA" : "AtoB");
                  setSwapAmountIn("");
                }}
                className="text-xs bg-indigo-100 text-indigo-700 hover:bg-indigo-200 font-bold px-3 py-1.5 rounded-lg transition-colors cursor-pointer"
              >
                ⇄ Switch Direction
              </button>
            </div>

            <form onSubmit={handleSwap} className="space-y-4">
              <div>
                <div className="flex justify-between text-xs text-gray-600 mb-1">
                  <span>
                    You Pay: {swapDirection === "AtoB" ? tokenASymbol : tokenBSymbol}
                  </span>
                  <span>
                    Balance:{" "}
                    {swapDirection === "AtoB" ? tokenABalance : tokenBBalance}
                  </span>
                </div>
                <input
                  type="number"
                  step="any"
                  value={swapAmountIn}
                  onChange={(e) => setSwapAmountIn(e.target.value)}
                  placeholder="0.0"
                  required
                  className="w-full p-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none font-medium"
                />
              </div>

              <div className="flex justify-center -my-2">
                <div className="bg-gray-100 p-2 rounded-full border border-gray-300 text-gray-500 text-xs font-bold">
                  ↓
                </div>
              </div>

              <div>
                <div className="flex justify-between text-xs text-gray-600 mb-1">
                  <span>
                    You Receive (Estimated): {swapDirection === "AtoB" ? tokenBSymbol : tokenASymbol}
                  </span>
                  <span>
                    Pool Reserve:{" "}
                    {swapDirection === "AtoB" ? reserveB : reserveA}
                  </span>
                </div>
                <input
                  type="text"
                  readOnly
                  value={swapEstimatedOut}
                  className="w-full p-3 bg-gray-50 border border-gray-300 rounded-xl text-gray-700 font-bold cursor-not-allowed"
                />
              </div>

              {/* AMM Math Verification Preview */}
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-3.5 text-xs text-slate-700 space-y-1">
                <div className="flex justify-between font-mono">
                  <span>Formula:</span>
                  <span>amountOut = reserveOut - (k / (reserveIn + amountIn))</span>
                </div>
                <div className="flex justify-between text-gray-500">
                  <span>Swap Rate:</span>
                  <span>
                    {swapAmountIn && parseFloat(swapAmountIn) > 0 && parseFloat(swapEstimatedOut) > 0
                      ? `1 ${swapDirection === "AtoB" ? tokenASymbol : tokenBSymbol} ≈ ${(
                          parseFloat(swapEstimatedOut) / parseFloat(swapAmountIn)
                        ).toFixed(4)} ${swapDirection === "AtoB" ? tokenBSymbol : tokenASymbol}`
                      : "0"}
                  </span>
                </div>
              </div>

              <button
                type="submit"
                disabled={loading || !isConfigured || parseFloat(swapAmountIn) <= 0}
                className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-3.5 rounded-xl shadow transition-all cursor-pointer disabled:opacity-50"
              >
                {loading ? "Swapping..." : `Swap ${swapDirection === "AtoB" ? tokenASymbol : tokenBSymbol} for ${swapDirection === "AtoB" ? tokenBSymbol : tokenASymbol}`}
              </button>
            </form>
          </div>
        )}

        {/* Tab 3: Remove Liquidity */}
        {activeTab === "remove" && (
          <div className="p-6 max-w-xl mx-auto">
            <h3 className="text-lg font-bold text-gray-800 mb-1">Burn LP Shares</h3>
            <p className="text-xs text-gray-500 mb-6">
              Redeem your LP tokens to withdraw your proportional share of Token A and Token B reserves.
            </p>

            <form onSubmit={handleRemoveLiquidity} className="space-y-4">
              <div>
                <div className="flex justify-between text-xs text-gray-600 mb-1">
                  <span>LP Shares to Burn:</span>
                  <button
                    type="button"
                    onClick={() => setRemoveLpAmount(userLpBalance)}
                    className="text-indigo-600 font-bold hover:underline"
                  >
                    Max ({userLpBalance})
                  </button>
                </div>
                <input
                  type="number"
                  step="any"
                  value={removeLpAmount}
                  onChange={(e) => setRemoveLpAmount(e.target.value)}
                  placeholder="0.0"
                  required
                  className="w-full p-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none font-medium"
                />
              </div>

              {/* Redemption Preview */}
              <div className="bg-purple-50 border border-purple-100 rounded-xl p-4 text-xs text-purple-900 space-y-2">
                <div className="font-bold text-purple-800">Assets You Will Receive:</div>
                <div className="flex justify-between">
                  <span>{tokenASymbol} Output:</span>
                  <span className="font-bold font-mono">{estReturnA} {tokenASymbol}</span>
                </div>
                <div className="flex justify-between">
                  <span>{tokenBSymbol} Output:</span>
                  <span className="font-bold font-mono">{estReturnB} {tokenBSymbol}</span>
                </div>
              </div>

              <button
                type="submit"
                disabled={loading || !isConfigured || parseFloat(removeLpAmount) <= 0}
                className="w-full bg-rose-600 hover:bg-rose-700 text-white font-bold py-3.5 rounded-xl shadow transition-all cursor-pointer disabled:opacity-50"
              >
                {loading ? "Processing..." : "Remove Liquidity"}
              </button>
            </form>
          </div>
        )}
      </div>

      {/* Experiment Observations & Mathematical Invariant Guide */}
      <div className="bg-slate-50 border border-slate-200 rounded-2xl p-6 shadow-sm">
        <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wider mb-3">
          📐 Experiment 4 Invariant & Verification Notes
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs text-slate-600">
          <div className="bg-white p-4 rounded-xl border border-slate-200">
            <h4 className="font-bold text-slate-800 mb-1">Constant Product Formula (x * y = k)</h4>
            <p>
              In an automated market maker without fees, every swap shifts the balance of assets along
              the hyperbola <span className="font-mono font-bold">x * y = k</span>. When Token A is added,
              Reserve A increases, causing Reserve B to decrease so the product remains invariant.
            </p>
          </div>
          <div className="bg-white p-4 rounded-xl border border-slate-200">
            <h4 className="font-bold text-slate-800 mb-1">LP Share Accounting</h4>
            <p>
              The initial liquidity provider receives shares equal to{" "}
              <span className="font-mono font-bold">sqrt(amountA * amountB)</span>. Subsequent deposits
              mint shares proportional to the minimum reserve share to prevent dilution.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
