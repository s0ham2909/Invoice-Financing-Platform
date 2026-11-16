import { useState, useEffect, useCallback } from "react";
import { ethers } from "ethers";
import { MOCK_USDC_ADDRESS, INVOICE_VAULT_ADDRESS } from "../config/contractConfig";
import { INVX_ADDRESS } from "../config/farmConfig";
import {
  DEX_ROUTER_ADDRESS,
  DEX_FACTORY_ADDRESS,
  DEX_ROUTER_ABI,
  DEX_FACTORY_ABI,
  DEX_PAIR_ABI
} from "../config/dexConfig";

const ERC20_ABI = [
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function allowance(address owner, address spender) external view returns (uint256)",
  "function balanceOf(address account) external view returns (uint256)",
  "function decimals() external view returns (uint8)",
  "function symbol() external view returns (string)",
  "function name() external view returns (string)"
];

export default function DexSwapCard({
  signer,
  account,
  assetAddress = MOCK_USDC_ADDRESS,
  assetDecimals = 6,
  vaultAddress = INVOICE_VAULT_ADDRESS,
  vaultDecimals = 18,
  targetSwapPair = null,
  onActionComplete
}) {
  const [activeTab, setActiveTab] = useState("swap"); // "swap" | "liquidity"
  const [liquidityMode, setLiquidityMode] = useState("add"); // "add" | "remove"

  // Swap State
  const [fromTokenSymbol, setFromTokenSymbol] = useState("mUSDC");
  const [toTokenSymbol, setToTokenSymbol] = useState("INVX");
  const [fromAmount, setFromAmount] = useState("");
  const [toAmount, setToAmount] = useState("");
  const [slippageBps, setSlippageBps] = useState(50); // 0.5% default (50 bps)
  const [deadlineMinutes, setDeadlineMinutes] = useState(20); // 20 min default
  const [priceImpactPct, setPriceImpactPct] = useState(null);
  const [minReceived, setMinReceived] = useState("");
  const [isQuoting, setIsQuoting] = useState(false);

  // Liquidity State
  const [selectedPairKey, setSelectedPairKey] = useState("INVX_USDC"); // "INVX_USDC" | "VINV_USDC"
  const [liqAmountA, setLiqAmountA] = useState("");
  const [liqAmountB, setLiqAmountB] = useState("");
  const [userLpBalance, setUserLpBalance] = useState("0");
  const [userPoolShare, setUserPoolShare] = useState("0");
  const [pairReserves, setPairReserves] = useState({ rA: "0", rB: "0" });
  const [removeLpAmount, setRemoveLpAmount] = useState("");

  // Common UI State
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");
  const [userBalances, setUserBalances] = useState({
    mUSDC: "0",
    INVX: "0",
    vINV: "0"
  });

  // Token descriptor mapping
  const tokenMap = {
    mUSDC: {
      address: assetAddress || MOCK_USDC_ADDRESS,
      decimals: assetDecimals,
      symbol: "mUSDC"
    },
    INVX: {
      address: INVX_ADDRESS,
      decimals: 18,
      symbol: "INVX"
    },
    vINV: {
      address: vaultAddress || INVOICE_VAULT_ADDRESS,
      decimals: vaultDecimals,
      symbol: "vINV"
    }
  };

  const isDexDeployed =
    ethers.isAddress(DEX_ROUTER_ADDRESS) &&
    DEX_ROUTER_ADDRESS !== ethers.ZeroAddress &&
    ethers.isAddress(DEX_FACTORY_ADDRESS) &&
    DEX_FACTORY_ADDRESS !== ethers.ZeroAddress;

  // Listen for external shortcut trigger (e.g. "Buy INVX with mUSDC" or "Sell vINV on DEX")
  useEffect(() => {
    if (targetSwapPair) {
      if (targetSwapPair.from && tokenMap[targetSwapPair.from]) {
        setFromTokenSymbol(targetSwapPair.from);
      }
      if (targetSwapPair.to && tokenMap[targetSwapPair.to]) {
        setToTokenSymbol(targetSwapPair.to);
      }
      if (targetSwapPair.amount) {
        setFromAmount(targetSwapPair.amount);
      }
      setActiveTab("swap");
    }
  }, [targetSwapPair]);

  // Refresh balances
  const refreshBalances = useCallback(async () => {
    if (!signer || !account) return;
    try {
      const fetchBal = async (addr, dec) => {
        if (!ethers.isAddress(addr) || addr === ethers.ZeroAddress) return "0";
        try {
          const c = new ethers.Contract(addr, ERC20_ABI, signer);
          const b = await c.balanceOf(account);
          return ethers.formatUnits(b, dec);
        } catch {
          return "0";
        }
      };

      const [bUsdc, bInvx, bVinv] = await Promise.all([
        fetchBal(tokenMap.mUSDC.address, tokenMap.mUSDC.decimals),
        fetchBal(tokenMap.INVX.address, tokenMap.INVX.decimals),
        fetchBal(tokenMap.vINV.address, tokenMap.vINV.decimals)
      ]);

      setUserBalances({
        mUSDC: bUsdc,
        INVX: bInvx,
        vINV: bVinv
      });
    } catch (e) {
      console.warn("Failed to refresh DEX balances:", e);
    }
  }, [signer, account, assetAddress, assetDecimals, vaultAddress, vaultDecimals]);

  // Refresh Liquidity Pair Data
  const refreshLiquidityData = useCallback(async () => {
    if (!signer || !isDexDeployed) return;
    try {
      const router = new ethers.Contract(DEX_ROUTER_ADDRESS, DEX_ROUTER_ABI, signer);
      const factory = new ethers.Contract(DEX_FACTORY_ADDRESS, DEX_FACTORY_ABI, signer);

      let tA = tokenMap.INVX;
      let tB = tokenMap.mUSDC;
      if (selectedPairKey === "VINV_USDC") {
        tA = tokenMap.vINV;
        tB = tokenMap.mUSDC;
      }

      const pairAddr = await factory.getPair(tA.address, tB.address);
      if (!pairAddr || pairAddr === ethers.ZeroAddress) {
        setPairReserves({ rA: "0", rB: "0" });
        setUserLpBalance("0");
        setUserPoolShare("0");
        return;
      }

      const pair = new ethers.Contract(pairAddr, DEX_PAIR_ABI, signer);
      const [uLp, totLp, [rA, rB]] = await Promise.all([
        pair.balanceOf(account),
        pair.totalSupply(),
        router.getReserves(tA.address, tB.address)
      ]);

      setPairReserves({
        rA: ethers.formatUnits(rA, tA.decimals),
        rB: ethers.formatUnits(rB, tB.decimals)
      });
      setUserLpBalance(ethers.formatUnits(uLp, 18));

      if (totLp > 0n && uLp > 0n) {
        const share = (Number((uLp * 10000n) / totLp) / 100).toFixed(2);
        setUserPoolShare(`${share}%`);
      } else {
        setUserPoolShare("0%");
      }
    } catch (e) {
      console.warn("Failed to fetch liquidity data:", e);
    }
  }, [signer, account, isDexDeployed, selectedPairKey, assetAddress, vaultAddress]);

  useEffect(() => {
    refreshBalances();
    if (activeTab === "liquidity") {
      refreshLiquidityData();
    }
  }, [refreshBalances, refreshLiquidityData, activeTab]);

  // Derive Path: Direct or 2-Hop through mUSDC
  const getSwapPath = useCallback(() => {
    const fromToken = tokenMap[fromTokenSymbol];
    const toToken = tokenMap[toTokenSymbol];

    if (!fromToken || !toToken || fromToken.address === toToken.address) return [];

    // Direct pair if one is mUSDC
    if (fromTokenSymbol === "mUSDC" || toTokenSymbol === "mUSDC") {
      return [fromToken.address, toToken.address];
    }

    // 2-hop through mUSDC for INVX <-> vINV
    return [fromToken.address, tokenMap.mUSDC.address, toToken.address];
  }, [fromTokenSymbol, toTokenSymbol]);

  // Live Quote Calculation
  useEffect(() => {
    let isCancelled = false;

    const computeQuote = async () => {
      if (!signer || !isDexDeployed || !fromAmount || isNaN(fromAmount) || parseFloat(fromAmount) <= 0) {
        setToAmount("");
        setPriceImpactPct(null);
        setMinReceived("");
        return;
      }

      const path = getSwapPath();
      if (path.length < 2) {
        setToAmount("");
        return;
      }

      setIsQuoting(true);
      try {
        const fromToken = tokenMap[fromTokenSymbol];
        const toToken = tokenMap[toTokenSymbol];
        const parsedIn = ethers.parseUnits(fromAmount, fromToken.decimals);

        const router = new ethers.Contract(DEX_ROUTER_ADDRESS, DEX_ROUTER_ABI, signer);
        const amounts = await router.getAmountsOut(parsedIn, path);

        if (isCancelled) return;

        const outRaw = amounts[amounts.length - 1];
        const formattedOut = ethers.formatUnits(outRaw, toToken.decimals);
        setToAmount(formattedOut);

        // Minimum received based on slippage bps
        // minReceived = outRaw * (10000 - slippageBps) / 10000
        const minOutRaw = (outRaw * BigInt(10000 - slippageBps)) / 10000n;
        setMinReceived(ethers.formatUnits(minOutRaw, toToken.decimals));

        // Estimate price impact compared to first hop reserves
        try {
          const [rIn] = await router.getReserves(path[0], path[1]);
          const inPct = (Number((parsedIn * 10000n) / (rIn + parsedIn)) / 100).toFixed(2);
          setPriceImpactPct(parseFloat(inPct));
        } catch {
          setPriceImpactPct(null);
        }
      } catch {
        if (!isCancelled) {
          setToAmount("");
          setMinReceived("");
          setPriceImpactPct(null);
        }
      } finally {
        if (!isCancelled) setIsQuoting(false);
      }
    };

    const timer = setTimeout(computeQuote, 250);
    return () => {
      isCancelled = true;
      clearTimeout(timer);
    };
  }, [fromAmount, fromTokenSymbol, toTokenSymbol, slippageBps, signer, isDexDeployed, getSwapPath]);

  // Execute Swap
  const handleSwap = async () => {
    if (!signer || !isDexDeployed || !fromAmount || !toAmount) return;
    setStatus("");
    setLoading(true);

    try {
      const fromToken = tokenMap[fromTokenSymbol];
      const toToken = tokenMap[toTokenSymbol];
      const path = getSwapPath();

      const parsedIn = ethers.parseUnits(fromAmount, fromToken.decimals);
      const minOutRaw = ethers.parseUnits(minReceived || "0", toToken.decimals);

      const tokenContract = new ethers.Contract(fromToken.address, ERC20_ABI, signer);
      const routerContract = new ethers.Contract(DEX_ROUTER_ADDRESS, DEX_ROUTER_ABI, signer);

      // Check balance
      const userBal = await tokenContract.balanceOf(account);
      if (userBal < parsedIn) {
        throw new Error(
          `Insufficient ${fromTokenSymbol} balance. You have ${ethers.formatUnits(
            userBal,
            fromToken.decimals
          )} ${fromTokenSymbol}.`
        );
      }

      // Check allowance & approve only needed amount
      const allowance = await tokenContract.allowance(account, DEX_ROUTER_ADDRESS);
      if (allowance < parsedIn) {
        setStatus(`Approving ${fromAmount} ${fromTokenSymbol} for DEX Router...`);
        const appTx = await tokenContract.approve(DEX_ROUTER_ADDRESS, parsedIn);
        await appTx.wait();
      }

      setStatus(`Swapping ${fromAmount} ${fromTokenSymbol} for ~${toAmount} ${toTokenSymbol}...`);
      const deadline = Math.floor(Date.now() / 1000) + deadlineMinutes * 60;

      const swapTx = await routerContract.swapExactTokensForTokens(
        parsedIn,
        minOutRaw,
        path,
        account,
        deadline
      );
      await swapTx.wait();

      setStatus(`🎉 Swap Successful! Received at least ${minReceived} ${toTokenSymbol}.`);
      setFromAmount("");
      setToAmount("");
      setMinReceived("");
      await refreshBalances();
      if (onActionComplete) onActionComplete();
    } catch (err) {
      console.error("DEX Swap Error:", err);
      let humanMsg = err.reason || err.message;
      if (humanMsg.includes("EXPIRED")) {
        humanMsg = "Transaction expired. Please increase the deadline and try again.";
      } else if (humanMsg.includes("INSUFFICIENT_OUTPUT_AMOUNT")) {
        humanMsg = "Slippage tolerance breached. The market price moved while confirming; try increasing slippage.";
      } else if (humanMsg.includes("K")) {
        humanMsg = "Invariant K violation. Pool liquidity ratio error.";
      } else if (humanMsg.includes("PAIR_NOT_FOUND")) {
        humanMsg = "No liquidity pool found for this route yet.";
      }
      setStatus(`❌ Swap Failed: ${humanMsg}`);
    } finally {
      setLoading(false);
    }
  };

  // Add Liquidity
  const handleAddLiquidity = async () => {
    if (!signer || !isDexDeployed || !liqAmountA || !liqAmountB) return;
    setStatus("");
    setLoading(true);

    try {
      let tA = tokenMap.INVX;
      let tB = tokenMap.mUSDC;
      if (selectedPairKey === "VINV_USDC") {
        tA = tokenMap.vINV;
        tB = tokenMap.mUSDC;
      }

      const parsedA = ethers.parseUnits(liqAmountA, tA.decimals);
      const parsedB = ethers.parseUnits(liqAmountB, tB.decimals);

      const cA = new ethers.Contract(tA.address, ERC20_ABI, signer);
      const cB = new ethers.Contract(tB.address, ERC20_ABI, signer);
      const router = new ethers.Contract(DEX_ROUTER_ADDRESS, DEX_ROUTER_ABI, signer);

      // Check allowances
      const [allA, allB] = await Promise.all([
        cA.allowance(account, DEX_ROUTER_ADDRESS),
        cB.allowance(account, DEX_ROUTER_ADDRESS)
      ]);

      if (allA < parsedA) {
        setStatus(`Approving ${tA.symbol} for DEX Router...`);
        const txA = await cA.approve(DEX_ROUTER_ADDRESS, parsedA);
        await txA.wait();
      }
      if (allB < parsedB) {
        setStatus(`Approving ${tB.symbol} for DEX Router...`);
        const txB = await cB.approve(DEX_ROUTER_ADDRESS, parsedB);
        await txB.wait();
      }

      setStatus(`Adding liquidity to ${tA.symbol} / ${tB.symbol} pool...`);
      const deadline = Math.floor(Date.now() / 1000) + deadlineMinutes * 60;
      const minA = (parsedA * BigInt(10000 - slippageBps)) / 10000n;
      const minB = (parsedB * BigInt(10000 - slippageBps)) / 10000n;

      const tx = await router.addLiquidity(
        tA.address,
        tB.address,
        parsedA,
        parsedB,
        minA,
        minB,
        account,
        deadline
      );
      await tx.wait();

      setStatus(`🎉 Liquidity Added! Received LP shares.`);
      setLiqAmountA("");
      setLiqAmountB("");
      await refreshBalances();
      await refreshLiquidityData();
      if (onActionComplete) onActionComplete();
    } catch (err) {
      console.error("Add Liquidity Error:", err);
      setStatus(`❌ Add Liquidity Failed: ${err.reason || err.message}`);
    } finally {
      setLoading(false);
    }
  };

  // Remove Liquidity
  const handleRemoveLiquidity = async () => {
    if (!signer || !isDexDeployed || !removeLpAmount || parseFloat(removeLpAmount) <= 0) return;
    setStatus("");
    setLoading(true);

    try {
      let tA = tokenMap.INVX;
      let tB = tokenMap.mUSDC;
      if (selectedPairKey === "VINV_USDC") {
        tA = tokenMap.vINV;
        tB = tokenMap.mUSDC;
      }

      const factory = new ethers.Contract(DEX_FACTORY_ADDRESS, DEX_FACTORY_ABI, signer);
      const pairAddr = await factory.getPair(tA.address, tB.address);
      if (!pairAddr || pairAddr === ethers.ZeroAddress) throw new Error("Pair not found");

      const pair = new ethers.Contract(pairAddr, DEX_PAIR_ABI, signer);
      const router = new ethers.Contract(DEX_ROUTER_ADDRESS, DEX_ROUTER_ABI, signer);

      const parsedLp = ethers.parseUnits(removeLpAmount, 18);

      const all = await pair.allowance(account, DEX_ROUTER_ADDRESS);
      if (all < parsedLp) {
        setStatus("Approving LP tokens for withdrawal...");
        const appTx = await pair.approve(DEX_ROUTER_ADDRESS, parsedLp);
        await appTx.wait();
      }

      setStatus("Removing liquidity & redeeming underlying tokens...");
      const deadline = Math.floor(Date.now() / 1000) + deadlineMinutes * 60;
      const tx = await router.removeLiquidity(
        tA.address,
        tB.address,
        parsedLp,
        0,
        0,
        account,
        deadline
      );
      await tx.wait();

      setStatus(`🎉 Successfully removed liquidity! ${tA.symbol} and ${tB.symbol} returned to wallet.`);
      setRemoveLpAmount("");
      await refreshBalances();
      await refreshLiquidityData();
      if (onActionComplete) onActionComplete();
    } catch (err) {
      console.error("Remove Liquidity Error:", err);
      setStatus(`❌ Remove Liquidity Failed: ${err.reason || err.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6">
      {/* Header & Tabs */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 pb-4 mb-4 border-b border-gray-100">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-base font-bold text-gray-900 flex items-center gap-1.5">
              🔄 DEX Protocol Exchange
            </h3>
            <span className="text-[10px] bg-indigo-100 text-indigo-700 font-bold px-2 py-0.5 rounded-full uppercase">
              Uniswap v2 AMM
            </span>
          </div>
          <p className="text-xs text-gray-500 mt-0.5">
            Decentralized swaps with 0.3% fee and liquidity pools for INVX, mUSDC & vINV.
          </p>
        </div>

        <div className="flex bg-gray-100 p-1 rounded-xl">
          <button
            onClick={() => setActiveTab("swap")}
            className={`px-3.5 py-1.5 text-xs font-bold rounded-lg transition-all cursor-pointer ${
              activeTab === "swap"
                ? "bg-white text-indigo-600 shadow-xs"
                : "text-gray-500 hover:text-gray-900"
            }`}
          >
            Swap
          </button>
          <button
            onClick={() => setActiveTab("liquidity")}
            className={`px-3.5 py-1.5 text-xs font-bold rounded-lg transition-all cursor-pointer ${
              activeTab === "liquidity"
                ? "bg-white text-indigo-600 shadow-xs"
                : "text-gray-500 hover:text-gray-900"
            }`}
          >
            Liquidity
          </button>
        </div>
      </div>

      {/* Notice if DEX not deployed */}
      {!isDexDeployed && (
        <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl mb-4 text-xs text-amber-800 flex items-center gap-2">
          <span>⚠️</span>
          <span>
            DEX contracts are not yet configured on this network. Swaps will be active once deployed.
          </span>
        </div>
      )}

      {/* Notification Banner */}
      {status && (
        <div className="p-3 bg-indigo-50 border border-indigo-200 rounded-xl mb-4 text-xs text-indigo-900 flex justify-between items-center">
          <span>{status}</span>
          <button onClick={() => setStatus("")} className="font-bold cursor-pointer text-indigo-700">
            ✕
          </button>
        </div>
      )}

      {/* ─── TAB 1: SWAP ─── */}
      {activeTab === "swap" && (
        <div className="space-y-4">
          {/* Input Box */}
          <div className="bg-gray-50 p-4 rounded-xl border border-gray-200">
            <div className="flex justify-between text-xs text-gray-500 mb-1">
              <span>You Pay</span>
              <span>Balance: {parseFloat(userBalances[fromTokenSymbol] || 0).toFixed(4)}</span>
            </div>
            <div className="flex gap-2 items-center">
              <input
                type="number"
                placeholder="0.0"
                value={fromAmount}
                onChange={(e) => setFromAmount(e.target.value)}
                className="w-full text-xl font-bold bg-transparent outline-none text-gray-900"
              />
              <select
                value={fromTokenSymbol}
                onChange={(e) => {
                  const val = e.target.value;
                  if (val === toTokenSymbol) {
                    setToTokenSymbol(fromTokenSymbol);
                  }
                  setFromTokenSymbol(val);
                }}
                className="bg-white border border-gray-300 font-bold text-xs px-3 py-2 rounded-xl text-gray-800"
              >
                <option value="mUSDC">mUSDC</option>
                <option value="INVX">INVX</option>
                <option value="vINV">vINV</option>
              </select>
            </div>
          </div>

          {/* Swap Invert Button */}
          <div className="flex justify-center -my-2">
            <button
              onClick={() => {
                const prevFrom = fromTokenSymbol;
                setFromTokenSymbol(toTokenSymbol);
                setToTokenSymbol(prevFrom);
                setFromAmount("");
                setToAmount("");
              }}
              className="bg-white border border-gray-300 hover:bg-gray-50 p-1.5 rounded-full shadow-xs text-gray-600 cursor-pointer"
            >
              ⇅
            </button>
          </div>

          {/* Output Box */}
          <div className="bg-gray-50 p-4 rounded-xl border border-gray-200">
            <div className="flex justify-between text-xs text-gray-500 mb-1">
              <span>You Receive {isQuoting && "(Quoting...)"}</span>
              <span>Balance: {parseFloat(userBalances[toTokenSymbol] || 0).toFixed(4)}</span>
            </div>
            <div className="flex gap-2 items-center">
              <input
                type="text"
                readOnly
                placeholder="0.0"
                value={toAmount}
                className="w-full text-xl font-bold bg-transparent outline-none text-gray-900"
              />
              <select
                value={toTokenSymbol}
                onChange={(e) => {
                  const val = e.target.value;
                  if (val === fromTokenSymbol) {
                    setFromTokenSymbol(toTokenSymbol);
                  }
                  setToTokenSymbol(val);
                }}
                className="bg-white border border-gray-300 font-bold text-xs px-3 py-2 rounded-xl text-gray-800"
              >
                <option value="INVX">INVX</option>
                <option value="mUSDC">mUSDC</option>
                <option value="vINV">vINV</option>
              </select>
            </div>
          </div>

          {/* Quote Details & Price Impact Warning */}
          {toAmount && (
            <div className="p-3 bg-gray-50 rounded-xl border border-gray-100 text-xs space-y-1.5">
              <div className="flex justify-between text-gray-500">
                <span>Route</span>
                <span className="font-semibold text-gray-700">
                  {fromTokenSymbol === "INVX" && toTokenSymbol === "vINV"
                    ? "INVX ➔ mUSDC ➔ vINV (2 Hops)"
                    : fromTokenSymbol === "vINV" && toTokenSymbol === "INVX"
                    ? "vINV ➔ mUSDC ➔ INVX (2 Hops)"
                    : `${fromTokenSymbol} ➔ ${toTokenSymbol} (Direct)`}
                </span>
              </div>
              <div className="flex justify-between text-gray-500">
                <span>Minimum Received ({slippageBps / 100}% slippage)</span>
                <span className="font-semibold text-gray-700">
                  {parseFloat(minReceived).toFixed(4)} {toTokenSymbol}
                </span>
              </div>
              {priceImpactPct !== null && (
                <div className="flex justify-between items-center">
                  <span className="text-gray-500">Price Impact</span>
                  <span
                    className={`font-bold ${
                      priceImpactPct > 5.0
                        ? "text-red-600"
                        : priceImpactPct > 1.0
                        ? "text-amber-600"
                        : "text-emerald-600"
                    }`}
                  >
                    {priceImpactPct.toFixed(2)}%
                  </span>
                </div>
              )}
            </div>
          )}

          {priceImpactPct !== null && priceImpactPct > 5.0 && (
            <div className="p-2.5 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700 font-medium">
              ⚠️ High Price Impact ({priceImpactPct.toFixed(1)}%)! Your order is large relative to current pool liquidity and will incur heavy slippage.
            </div>
          )}

          {/* Slippage & Deadline Controls */}
          <div className="flex justify-between items-center text-xs text-gray-500 pt-1">
            <div className="flex items-center gap-1.5">
              <span>Slippage:</span>
              {[10, 50, 100].map((bps) => (
                <button
                  key={bps}
                  onClick={() => setSlippageBps(bps)}
                  className={`px-2 py-0.5 rounded-md font-bold cursor-pointer ${
                    slippageBps === bps ? "bg-indigo-600 text-white" : "bg-gray-100 text-gray-600"
                  }`}
                >
                  {bps / 100}%
                </button>
              ))}
            </div>
            <div className="flex items-center gap-1">
              <span>Deadline:</span>
              <input
                type="number"
                min="1"
                max="180"
                value={deadlineMinutes}
                onChange={(e) => setDeadlineMinutes(Number(e.target.value) || 20)}
                className="w-12 px-1 py-0.5 border border-gray-200 rounded text-center text-xs font-bold"
              />
              <span>min</span>
            </div>
          </div>

          {/* Swap Trigger Button */}
          <button
            onClick={handleSwap}
            disabled={loading || !isDexDeployed || !fromAmount || !toAmount || parseFloat(fromAmount) <= 0}
            className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-bold py-3 rounded-xl transition-all cursor-pointer text-sm shadow-xs"
          >
            {loading ? "Processing Swap..." : `Swap ${fromTokenSymbol} ➔ ${toTokenSymbol}`}
          </button>
        </div>
      )}

      {/* ─── TAB 2: LIQUIDITY ─── */}
      {activeTab === "liquidity" && (
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <div className="flex gap-2">
              <button
                onClick={() => setSelectedPairKey("INVX_USDC")}
                className={`text-xs font-bold px-3 py-1.5 rounded-lg cursor-pointer ${
                  selectedPairKey === "INVX_USDC"
                    ? "bg-indigo-600 text-white"
                    : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                }`}
              >
                INVX / mUSDC
              </button>
              <button
                onClick={() => setSelectedPairKey("VINV_USDC")}
                className={`text-xs font-bold px-3 py-1.5 rounded-lg cursor-pointer ${
                  selectedPairKey === "VINV_USDC"
                    ? "bg-indigo-600 text-white"
                    : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                }`}
              >
                vINV / mUSDC
              </button>
            </div>

            <div className="flex bg-gray-100 p-0.5 rounded-lg">
              <button
                onClick={() => setLiquidityMode("add")}
                className={`text-xs px-2.5 py-1 rounded-md font-bold cursor-pointer ${
                  liquidityMode === "add" ? "bg-white text-indigo-700 shadow-xs" : "text-gray-500"
                }`}
              >
                + Add
              </button>
              <button
                onClick={() => setLiquidityMode("remove")}
                className={`text-xs px-2.5 py-1 rounded-md font-bold cursor-pointer ${
                  liquidityMode === "remove" ? "bg-white text-indigo-700 shadow-xs" : "text-gray-500"
                }`}
              >
                - Remove
              </button>
            </div>
          </div>

          {/* Current Pool & User Share Stats */}
          <div className="grid grid-cols-3 gap-2 p-3 bg-gray-50 rounded-xl border border-gray-100 text-xs">
            <div>
              <div className="text-gray-400 font-medium">Pool Reserves</div>
              <div className="font-bold text-gray-800 mt-0.5">
                {parseFloat(pairReserves.rA).toFixed(2)} / {parseFloat(pairReserves.rB).toFixed(2)}
              </div>
            </div>
            <div>
              <div className="text-gray-400 font-medium">Your LP Shares</div>
              <div className="font-bold text-indigo-600 mt-0.5">
                {parseFloat(userLpBalance).toFixed(4)}
              </div>
            </div>
            <div>
              <div className="text-gray-400 font-medium">Your Pool Share</div>
              <div className="font-bold text-purple-600 mt-0.5">{userPoolShare}</div>
            </div>
          </div>

          {/* Add Liquidity Inputs */}
          {liquidityMode === "add" && (
            <div className="space-y-3">
              <div className="bg-gray-50 p-3 rounded-xl border border-gray-200">
                <div className="text-[11px] text-gray-500 mb-1">
                  Amount {selectedPairKey === "INVX_USDC" ? "INVX" : "vINV"} Desired
                </div>
                <input
                  type="number"
                  placeholder="0.0"
                  value={liqAmountA}
                  onChange={(e) => setLiqAmountA(e.target.value)}
                  className="w-full text-base font-bold bg-transparent outline-none"
                />
              </div>

              <div className="bg-gray-50 p-3 rounded-xl border border-gray-200">
                <div className="text-[11px] text-gray-500 mb-1">Amount mUSDC Desired</div>
                <input
                  type="number"
                  placeholder="0.0"
                  value={liqAmountB}
                  onChange={(e) => setLiqAmountB(e.target.value)}
                  className="w-full text-base font-bold bg-transparent outline-none"
                />
              </div>

              <button
                onClick={handleAddLiquidity}
                disabled={loading || !isDexDeployed || !liqAmountA || !liqAmountB}
                className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-bold py-3 rounded-xl transition-all cursor-pointer text-sm shadow-xs"
              >
                {loading ? "Supplying Liquidity..." : "Approve & Supply Liquidity"}
              </button>
            </div>
          )}

          {/* Remove Liquidity Inputs */}
          {liquidityMode === "remove" && (
            <div className="space-y-3">
              <div className="bg-gray-50 p-3 rounded-xl border border-gray-200">
                <div className="flex justify-between text-[11px] text-gray-500 mb-1">
                  <span>LP Shares to Burn</span>
                  <button
                    onClick={() => setRemoveLpAmount(userLpBalance)}
                    className="text-indigo-600 font-bold hover:underline cursor-pointer"
                  >
                    Max ({parseFloat(userLpBalance).toFixed(4)})
                  </button>
                </div>
                <input
                  type="number"
                  placeholder="0.0"
                  value={removeLpAmount}
                  onChange={(e) => setRemoveLpAmount(e.target.value)}
                  className="w-full text-base font-bold bg-transparent outline-none"
                />
              </div>

              <button
                onClick={handleRemoveLiquidity}
                disabled={loading || !isDexDeployed || !removeLpAmount || parseFloat(removeLpAmount) <= 0}
                className="w-full bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white font-bold py-3 rounded-xl transition-all cursor-pointer text-sm shadow-xs"
              >
                {loading ? "Removing Liquidity..." : "Burn LP Shares & Withdraw Tokens"}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
