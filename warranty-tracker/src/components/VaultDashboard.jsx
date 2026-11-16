import { useState, useEffect, useCallback } from "react";
import { ethers } from "ethers";
import { INVOICE_VAULT_ADDRESS, MOCK_USDC_ADDRESS } from "../config/contractConfig";
import {
  INVX_ADDRESS,
  INVOICE_FARM_ADDRESS,
  RESERVE_STAKING_ADDRESS,
  INVOICE_FARM_ABI,
  RESERVE_STAKING_ABI,
  INVX_ABI
} from "../config/farmConfig";
import DexSwapCard from "./DexSwapCard";
import {
  DEX_ROUTER_ADDRESS,
  DEX_FACTORY_ADDRESS,
  DEX_ROUTER_ABI,
  DEX_FACTORY_ABI
} from "../config/dexConfig";
import { useOraclePrice } from "../hooks/useOraclePrice";

export default function VaultDashboard({ signer, account }) {
  const [vaultAddress] = useState(INVOICE_VAULT_ADDRESS || "");
  const [vaultContract, setVaultContract] = useState(null);
  const [assetAddress, setAssetAddress] = useState("");
  const [assetDecimals, setAssetDecimals] = useState(6); // Default 6 for mUSDC
  const [vaultDecimals, setVaultDecimals] = useState(18); // Dynamic vINV share decimals
  const [vaultIdleCash, setVaultIdleCash] = useState("0");
  const [targetSwapPair, setTargetSwapPair] = useState(null);
  const [invxSpotPriceLabel, setInvxSpotPriceLabel] = useState("spot price (testnet pool)");

  // Oracle for USDC/USD to show TVL in USD (Experiment 7)
  const oracleUsdc = useOraclePrice("USDC/USD");

  // Vault Metrics
  const [totalAssets, setTotalAssets] = useState("0");
  const [totalSupply, setTotalSupply] = useState("0");
  const [userShares, setUserShares] = useState("0");
  const [userSharesRaw, setUserSharesRaw] = useState(0n);
  const [userAssetBalance, setUserAssetBalance] = useState("0");

  // Input states
  const [depositAmount, setDepositAmount] = useState("");
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [calcAssetsInput, setCalcAssetsInput] = useState("");
  const [previewSharesOutput, setPreviewSharesOutput] = useState("0");

  // Farm & Combined Yield States (Experiment 5: Part 1 Yield Farming)
  const [farmContract, setFarmContract] = useState(null);
  const [farmedBalance, setFarmedBalance] = useState("0");
  const [earnedInvx, setEarnedInvx] = useState("0");
  const [farmApr, setFarmApr] = useState("n/a"); // Computed from on-chain rewardRate and totalStaked
  const [combinedApy, setCombinedApy] = useState("n/a"); // Computed combined APY
  // Configurable INVX price assumption for APR computation (in USD/mUSDC)
  const INVX_ASSUMED_PRICE_USD = 0.50; // Labelled configurable constant: $0.50 per INVX

  const [isDepositAndFarmOpen, setIsDepositAndFarmOpen] = useState(false);
  const [depositAndFarmAmount, setDepositAndFarmAmount] = useState("");
  const [depositAndFarmStep, setDepositAndFarmStep] = useState(0); // 0 = idle, 1 = approve mUSDC, 2 = deposit vault, 3 = approve vINV, 4 = stake farm

  // Reserve Staking & Portfolio States (Experiment 5: Part 2 Protocol Staking)
  const [stakingContract, setStakingContract] = useState(null);
  const [invxContract, setInvxContract] = useState(null);
  const [, setInvxBalance] = useState("0");
  const [stakedInvxBalance, setStakedInvxBalance] = useState("0");
  const [earnedUsdcYield, setEarnedUsdcYield] = useState("0");
  const [stakeInvxInput, setStakeInvxInput] = useState("");

  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");
  const [isWrongNetwork, setIsWrongNetwork] = useState(false);

  // ERC-4626 standard ABI (with dynamic decimals)
  const ERC4626_ABI = [
    "function asset() external view returns (address)",
    "function totalAssets() external view returns (uint256)",
    "function totalSupply() external view returns (uint256)",
    "function balanceOf(address owner) external view returns (uint256)",
    "function decimals() external view returns (uint8)",
    "function deposit(uint256 assets, address receiver) external returns (uint256 shares)",
    "function mint(uint256 shares, address receiver) external returns (uint256 assets)",
    "function withdraw(uint256 assets, address receiver, address owner) external returns (uint256 shares)",
    "function redeem(uint256 shares, address receiver, address owner) external returns (uint256 shares)",
    "function convertToShares(uint256 assets) external view returns (uint256)",
    "function convertToAssets(uint256 shares) external view returns (uint256)",
    "function previewDeposit(uint256 assets) external view returns (uint256)",
    "function approve(address spender, uint256 amount) external returns (bool)"
  ];

  const ERC20_ABI = [
    "function approve(address spender, uint256 amount) external returns (bool)",
    "function allowance(address owner, address spender) external view returns (uint256)",
    "function balanceOf(address account) external view returns (uint256)",
    "function decimals() external view returns (uint8)",
    "function mint(address to, uint256 amount) external"
  ];

  // Auto load vault on mount
  useEffect(() => {
    if (vaultAddress && ethers.isAddress(vaultAddress) && signer) {
      initContracts();
    }
  }, [signer, vaultAddress, account]);

  const handleSwitchNetwork = async () => {
    if (!window.ethereum) return;
    try {
      setLoading(true);
      await window.ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: "0xaa36a7" }],
      });
      setIsWrongNetwork(false);
      setStatus("Switched to Sepolia! Reloading vault...");
      window.location.reload();
    } catch (err) {
      console.error("Network Switch Error:", err);
      setStatus(`Failed to switch network: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const initContracts = async () => {
    if (!vaultAddress || !ethers.isAddress(vaultAddress) || !signer) return;
    try {
      setLoading(true);
      setStatus("Connecting to ERC-4626 Vault & Farm contracts...");

      try {
        const network = await signer.provider.getNetwork();
        if (network.chainId !== 11155111n && network.chainId !== 31337n) {
          setIsWrongNetwork(true);
        } else {
          setIsWrongNetwork(false);
        }
      } catch {
        // Fallback for mock/local
      }

      // Initialize Vault
      const vault = new ethers.Contract(vaultAddress, ERC4626_ABI, signer);
      setVaultContract(vault);

      const assetAddr = await vault.asset();
      setAssetAddress(assetAddr);

      const assetToken = new ethers.Contract(assetAddr, ERC20_ABI, signer);
      let aDec = 6;
      try {
        aDec = Number(await assetToken.decimals());
      } catch {
        aDec = 6;
      }
      setAssetDecimals(aDec);

      // PREREQUISITE FIX: Dynamically fetch share decimals from vault.decimals()
      let sDec = 18;
      try {
        sDec = Number(await vault.decimals());
      } catch {
        sDec = 18;
      }
      setVaultDecimals(sDec);

      // Initialize Farm if deployed
      if (ethers.isAddress(INVOICE_FARM_ADDRESS) && INVOICE_FARM_ADDRESS !== ethers.ZeroAddress) {
        const farm = new ethers.Contract(INVOICE_FARM_ADDRESS, INVOICE_FARM_ABI, signer);
        setFarmContract(farm);
      }

      // Initialize ReserveStaking if deployed
      if (ethers.isAddress(RESERVE_STAKING_ADDRESS) && RESERVE_STAKING_ADDRESS !== ethers.ZeroAddress) {
        const staking = new ethers.Contract(RESERVE_STAKING_ADDRESS, RESERVE_STAKING_ABI, signer);
        setStakingContract(staking);
      }

      // Initialize INVX token if deployed
      if (ethers.isAddress(INVX_ADDRESS) && INVX_ADDRESS !== ethers.ZeroAddress) {
        const token = new ethers.Contract(INVX_ADDRESS, INVX_ABI, signer);
        setInvxContract(token);
      }

      await refreshAllData(vault, aDec, sDec);
      setStatus("Contracts initialized successfully!");
    } catch (err) {
      console.error("Connection Error:", err);
      setStatus(`Connection Error: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const refreshAllData = useCallback(async (vC = vaultContract, aDec = assetDecimals, sDec = vaultDecimals) => {
    if (!vC || !account) return;
    try {
      const [totAssets, totSupply, uShares] = await Promise.all([
        vC.totalAssets(),
        vC.totalSupply(),
        vC.balanceOf(account)
      ]);

      setTotalAssets(ethers.formatUnits(totAssets, aDec));
      setTotalSupply(ethers.formatUnits(totSupply, sDec));
      setUserShares(ethers.formatUnits(uShares, sDec));
      setUserSharesRaw(uShares);

      if (assetAddress && signer) {
        const tokenContract = new ethers.Contract(assetAddress, ERC20_ABI, signer);
        const [uBal, vIdle] = await Promise.all([
          tokenContract.balanceOf(account),
          tokenContract.balanceOf(vaultAddress)
        ]);
        setUserAssetBalance(ethers.formatUnits(uBal, aDec));
        setVaultIdleCash(ethers.formatUnits(vIdle, aDec));
      }

      // Query on-chain spot price for INVX from INVX/mUSDC pool reserves
      let spotPriceUsd = null;
      if (ethers.isAddress(DEX_ROUTER_ADDRESS) && DEX_ROUTER_ADDRESS !== ethers.ZeroAddress && signer) {
        try {
          const router = new ethers.Contract(DEX_ROUTER_ADDRESS, DEX_ROUTER_ABI, signer);
          const [rInvx, rUsdc] = await router.getReserves(INVX_ADDRESS, assetAddress);
          if (rInvx > 0n && rUsdc > 0n) {
            const invxTokens = parseFloat(ethers.formatUnits(rInvx, 18));
            const usdcTokens = parseFloat(ethers.formatUnits(rUsdc, aDec));
            if (invxTokens > 0) {
              spotPriceUsd = usdcTokens / invxTokens;
              setInvxSpotPriceLabel(`spot price (testnet pool: $${spotPriceUsd.toFixed(3)})`);
            }
          }
        } catch {
          // Pool not created or empty yet
        }
      }

      // Farm data & Real APR calculation
      if (farmContract && account) {
        try {
          const [fBal, eInvx, rRate, totStaked] = await Promise.all([
            farmContract.stakedBalance(account),
            farmContract.earned(account),
            farmContract.rewardRate(),
            farmContract.totalStaked()
          ]);
          setFarmedBalance(ethers.formatUnits(fBal, sDec));
          setEarnedInvx(ethers.formatUnits(eInvx, 18));

          // Real On-Chain APR Computation:
          // Uses on-chain spot price from INVX/mUSDC DEX pool reserves
          if (totStaked > 0n && rRate > 0n && spotPriceUsd !== null && spotPriceUsd > 0) {
            const oneShare = ethers.parseUnits("1", sDec);
            const shareAssetPrice = await vC.convertToAssets(oneShare);
            const sharePriceUsd = parseFloat(ethers.formatUnits(shareAssetPrice, aDec));

            const totalStakedTokens = parseFloat(ethers.formatUnits(totStaked, sDec));
            const totalStakedUsd = totalStakedTokens * (sharePriceUsd > 0 ? sharePriceUsd : 1.0);

            const annualInvxEmitted = parseFloat(ethers.formatUnits(rRate, 18)) * 31536000;
            const annualRewardsUsd = annualInvxEmitted * spotPriceUsd;

            if (totalStakedUsd > 0) {
              const computedApr = ((annualRewardsUsd / totalStakedUsd) * 100).toFixed(1);
              setFarmApr(`${computedApr}%`);
              setCombinedApy(`~${(parseFloat(computedApr) + 6.0).toFixed(1)}%`);
            } else {
              setFarmApr("n/a");
              setCombinedApy("n/a");
            }
          } else {
            setFarmApr("n/a");
            setCombinedApy("n/a");
          }
        } catch (e) {
          console.warn("Farm data fetch error", e);
          setFarmApr("n/a");
          setCombinedApy("n/a");
        }
      } else {
        setFarmApr("n/a");
        setCombinedApy("n/a");
      }

      // Staking data
      if (stakingContract && invxContract && account) {
        try {
          const [iBal, sBal, eUsdc] = await Promise.all([
            invxContract.balanceOf(account),
            stakingContract.stakedBalance(account),
            stakingContract.earned(account)
          ]);
          setInvxBalance(ethers.formatUnits(iBal, 18));
          setStakedInvxBalance(ethers.formatUnits(sBal, 18));
          setEarnedUsdcYield(ethers.formatUnits(eUsdc, aDec));
        } catch (e) {
          console.warn("Staking data fetch error", e);
        }
      }
    } catch (err) {
      console.error("Failed to refresh data:", err);
    }
  }, [vaultContract, assetAddress, farmContract, stakingContract, invxContract, account, assetDecimals, vaultDecimals, signer]);

  useEffect(() => {
    if (vaultContract && account) {
      refreshAllData();
    }
  }, [vaultContract, account, refreshAllData]);

  const handleMintTestTokens = async () => {
    if (!assetAddress || !signer || !account) return;
    try {
      setLoading(true);
      setStatus("Minting 1,000 mUSDC test tokens to your wallet...");
      const assetToken = new ethers.Contract(assetAddress, ERC20_ABI, signer);
      const amountToMint = ethers.parseUnits("1000", assetDecimals);

      const tx = await assetToken.mint(account, amountToMint);
      await tx.wait();

      setStatus("Successfully minted 1,000 mUSDC test tokens!");
      await refreshAllData();
    } catch (err) {
      console.error("Mint Error:", err);
      setStatus(`Mint Failed: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleMintInvx = async () => {
    if (!invxContract || !account) return;
    try {
      setLoading(true);
      setStatus("Claiming 500 INVX test tokens from faucet...");
      const tx = await invxContract.faucet(account, ethers.parseUnits("500", 18));
      await tx.wait();
      setStatus("Successfully claimed 500 INVX!");
      await refreshAllData();
    } catch (err) {
      console.error("INVX Faucet Error:", err);
      setStatus(`Faucet Failed: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  // Preview conversion tool using dynamic decimals
  const handlePreviewConversion = async (val) => {
    setCalcAssetsInput(val);
    if (!vaultContract || !val || isNaN(val) || parseFloat(val) <= 0) {
      setPreviewSharesOutput("0");
      return;
    }
    try {
      const parsedAssets = ethers.parseUnits(val, assetDecimals);
      const shares = await vaultContract.convertToShares(parsedAssets);
      setPreviewSharesOutput(ethers.formatUnits(shares, vaultDecimals));
    } catch (err) {
      console.error("Preview Conversion Error:", err);
    }
  };

  // Standard Deposit (Dynamic Decimals)
  const handleDeposit = async () => {
    if (!vaultContract || !depositAmount || !signer) return;
    try {
      setLoading(true);
      setStatus("Step 1/2: Approving underlying mUSDC asset tokens...");
      const assetToken = new ethers.Contract(assetAddress, ERC20_ABI, signer);
      const parsedAmount = ethers.parseUnits(depositAmount, assetDecimals);

      const bal = await assetToken.balanceOf(account);
      if (bal < parsedAmount) {
        throw new Error(
          `Insufficient mUSDC balance! Your balance is ${ethers.formatUnits(
            bal,
            assetDecimals
          )} mUSDC. Please mint test tokens first.`
        );
      }

      const appTx = await assetToken.approve(vaultAddress, parsedAmount);
      await appTx.wait();

      setStatus("Step 2/2: Depositing mUSDC into Vault for vINV shares...");
      const depTx = await vaultContract.deposit(parsedAmount, account);
      await depTx.wait();

      setStatus("Deposit Successful! Received vINV vault shares.");
      setDepositAmount("");
      await refreshAllData();
    } catch (err) {
      console.error("Deposit Error:", err);
      setStatus(`Deposit Failed: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  // Standard Redeem (Dynamic Decimals)
  const handleRedeem = async () => {
    if (!vaultContract || !withdrawAmount || !signer) return;
    try {
      setLoading(true);
      setStatus("Executing ERC-4626 redeem(shares, receiver, owner)...");
      const parsedShares = ethers.parseUnits(withdrawAmount, vaultDecimals);

      if (parsedShares > userSharesRaw) {
        throw new Error(
          `Cannot redeem ${withdrawAmount} vINV shares! Your balance is ${userShares} vINV.`
        );
      }

      const tx = await vaultContract.redeem(parsedShares, account, account);
      await tx.wait();

      setStatus("Redemption Successful! Shares burned & mUSDC returned.");
      setWithdrawAmount("");
      await refreshAllData();
    } catch (err) {
      console.error("Redeem Error:", err);
      setStatus(`Redeem Failed: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  // ─── Seamless "Deposit & Farm" Flow (Experiment 5: Part 1) ─────────────────
  const handleDepositAndFarm = async () => {
    if (!vaultContract || !farmContract || !depositAndFarmAmount || !signer) return;
    try {
      setLoading(true);
      const assetToken = new ethers.Contract(assetAddress, ERC20_ABI, signer);
      const parsedAssets = ethers.parseUnits(depositAndFarmAmount, assetDecimals);

      // Step 1: Approve mUSDC for Vault
      setDepositAndFarmStep(1);
      setStatus("Step 1/4: Approving mUSDC for Vault deposit...");
      const tx1 = await assetToken.approve(vaultAddress, parsedAssets);
      await tx1.wait();

      // Step 2: Deposit into Vault & receive vINV
      setDepositAndFarmStep(2);
      setStatus("Step 2/4: Depositing into Vault to mint vINV shares...");
      const tx2 = await vaultContract.deposit(parsedAssets, account);
      await tx2.wait();

      // Estimate shares received
      const mintedShares = await vaultContract.convertToShares(parsedAssets);

      // Step 3: Approve vINV for InvoiceFarm
      setDepositAndFarmStep(3);
      setStatus("Step 3/4: Approving vINV shares for InvoiceFarm...");
      const tx3 = await vaultContract.approve(INVOICE_FARM_ADDRESS, mintedShares);
      await tx3.wait();

      // Step 4: Stake vINV into InvoiceFarm
      setDepositAndFarmStep(4);
      setStatus("Step 4/4: Staking vINV into InvoiceFarm to earn INVX rewards...");
      const tx4 = await farmContract.stake(mintedShares);
      await tx4.wait();

      setStatus("🎉 Deposit & Farm Complete! You are now earning double yield (Vault APY + INVX APR).");
      setDepositAndFarmAmount("");
      setIsDepositAndFarmOpen(false);
      setDepositAndFarmStep(0);
      await refreshAllData();
    } catch (err) {
      console.error("Deposit & Farm Error:", err);
      setStatus(`Deposit & Farm Failed: ${err.message}`);
      setDepositAndFarmStep(0);
    } finally {
      setLoading(false);
    }
  };

  // ─── Farm Harvesting & Unstaking ──────────────────────────────────────────
  const handleHarvestFarm = async () => {
    if (!farmContract) return;
    try {
      setLoading(true);
      setStatus("Harvesting INVX rewards from InvoiceFarm...");
      const tx = await farmContract.harvest();
      await tx.wait();
      setStatus("🎉 Successfully harvested INVX farming rewards!");
      await refreshAllData();
    } catch (err) {
      console.error(err);
      setStatus(`Harvest Failed: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };


  // ─── Reserve Staking (INVX -> mUSDC Yield) ─────────────────────────────────
  const handleStakeInvx = async () => {
    if (!stakingContract || !invxContract || !stakeInvxInput) return;
    try {
      setLoading(true);
      setStatus("Step 1/2: Approving INVX for ReserveStaking...");
      const parsed = ethers.parseUnits(stakeInvxInput, 18);
      const tx1 = await invxContract.approve(RESERVE_STAKING_ADDRESS, parsed);
      await tx1.wait();

      setStatus("Step 2/2: Staking INVX to earn mUSDC repayment yield & unlock Supplier Tiers...");
      const tx2 = await stakingContract.stake(parsed);
      await tx2.wait();

      setStatus("🎉 INVX Staked! You earn real mUSDC yield and qualify for fee discounts.");
      setStakeInvxInput("");
      await refreshAllData();
    } catch (err) {
      console.error(err);
      setStatus(`Stake INVX Failed: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleClaimStakingYield = async () => {
    if (!stakingContract) return;
    try {
      setLoading(true);
      setStatus("Claiming real mUSDC yield from ReserveStaking...");
      const tx = await stakingContract.claimReward();
      await tx.wait();
      setStatus("🎉 Successfully claimed mUSDC yield!");
      await refreshAllData();
    } catch (err) {
      console.error(err);
      setStatus(`Claim Yield Failed: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleUnstakeInvx = async () => {
    if (!stakingContract || !stakedInvxBalance || parseFloat(stakedInvxBalance) <= 0) return;
    try {
      setLoading(true);
      setStatus("Unstaking INVX from ReserveStaking...");
      const parsed = ethers.parseUnits(stakedInvxBalance, 18);
      const tx = await stakingContract.unstake(parsed);
      await tx.wait();
      setStatus("Successfully unstaked INVX!");
      await refreshAllData();
    } catch (err) {
      console.error(err);
      setStatus(`Unstake Failed: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  // ─── One-Click "Claim All" Portfolio Action ────────────────────────────────
  const handleClaimAll = async () => {
    setLoading(true);
    setStatus("Executing Claim All: harvesting INVX farm rewards + claiming mUSDC staking yield...");
    try {
      if (farmContract && parseFloat(earnedInvx) > 0) {
        const tx1 = await farmContract.harvest();
        await tx1.wait();
      }
      if (stakingContract && parseFloat(earnedUsdcYield) > 0) {
        const tx2 = await stakingContract.claimReward();
        await tx2.wait();
      }
      setStatus("🎉 Claimed all pending protocol rewards!");
      await refreshAllData();
    } catch (err) {
      console.error(err);
      setStatus(`Claim All Failed: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">

      {/* Header Banner */}
      <div className="bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 text-white rounded-2xl p-6 shadow-md border border-indigo-900/50">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <h2 className="text-2xl font-bold flex items-center gap-2">
              🏦 ERC-4626 Tokenized Vault & DeFi Yield Farm
            </h2>
            <p className="text-sm text-indigo-200 mt-1 max-w-2xl">
              Deposit mUSDC for yield-bearing <strong>vINV</strong> shares. Stake vINV into the Farm to earn <strong>INVX</strong> platform rewards,
              and stake INVX into Reserve Staking for real <strong>mUSDC</strong> invoice repayment yields!
            </p>
          </div>
          <div className="flex flex-col sm:flex-row gap-2">
            <button
              onClick={() => setIsDepositAndFarmOpen(!isDepositAndFarmOpen)}
              className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2.5 rounded-xl font-bold text-xs transition-all shadow-md cursor-pointer flex items-center justify-center gap-1.5"
            >
              ⚡ 1-Click Deposit & Farm
            </button>
            <button
              onClick={handleClaimAll}
              disabled={loading || (parseFloat(earnedInvx) === 0 && parseFloat(earnedUsdcYield) === 0)}
              className="bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white px-4 py-2.5 rounded-xl font-bold text-xs transition-all shadow-md cursor-pointer flex items-center justify-center gap-1.5"
            >
              🎁 Claim All Rewards
            </button>
          </div>
        </div>
      </div>

      {/* Status Notifications */}
      {status && (
        <div
          className={`p-4 rounded-xl text-xs font-mono flex items-center justify-between ${
            isWrongNetwork
              ? "bg-red-50 text-red-700 border border-red-200"
              : "bg-indigo-50 text-indigo-700 border border-indigo-100"
          }`}
        >
          <span>{status}</span>
          {isWrongNetwork && (
            <button
              onClick={handleSwitchNetwork}
              className="bg-red-600 hover:bg-red-700 text-white font-sans font-semibold text-xs px-3 py-1.5 rounded-lg transition-colors cursor-pointer ml-3"
            >
              🔄 Switch to Sepolia
            </button>
          )}
        </div>
      )}

      {/* ─── 1-CLICK DEPOSIT & FARM MODAL / ACCORDION ─── */}
      {isDepositAndFarmOpen && (
        <div className="bg-indigo-50/70 border-2 border-indigo-300 rounded-2xl p-6 shadow-sm animate-fadeIn">
          <div className="flex justify-between items-center mb-3">
            <h3 className="font-bold text-indigo-950 text-base flex items-center gap-2">
              ⚡ 1-Click "Deposit & Farm" (mUSDC &rarr; vINV &rarr; InvoiceFarm)
            </h3>
            <button
              onClick={() => setIsDepositAndFarmOpen(false)}
              className="text-gray-400 hover:text-gray-600 text-lg font-bold"
            >
              &times;
            </button>
          </div>
          <p className="text-xs text-indigo-800 mb-4">
            Automatically approves mUSDC, deposits into the ERC-4626 Vault, approves vINV, and stakes directly into the farm in sequential automated steps.
          </p>
          <div className="flex flex-col sm:flex-row gap-3">
            <input
              type="number"
              placeholder="Amount of mUSDC to Deposit & Farm"
              value={depositAndFarmAmount}
              onChange={(e) => setDepositAndFarmAmount(e.target.value)}
              className="flex-1 px-4 py-2.5 border border-indigo-200 rounded-xl bg-white text-sm focus:outline-none font-medium"
            />
            <button
              onClick={handleDepositAndFarm}
              disabled={loading || !depositAndFarmAmount || parseFloat(depositAndFarmAmount) <= 0}
              className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-bold text-xs px-6 py-2.5 rounded-xl cursor-pointer"
            >
              {depositAndFarmStep > 0 ? `Step ${depositAndFarmStep}/4 in progress...` : "Execute Deposit & Farm"}
            </button>
          </div>
        </div>
      )}

      {/* ─── UNIFIED PORTFOLIO PANEL ─── */}
      <div className="bg-white rounded-2xl p-5 border border-gray-200 shadow-sm">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-sm font-bold text-gray-800 uppercase tracking-wider">
            📊 Your Platform Portfolio & Pending Yields
          </h3>
          <div className="flex gap-2">
            <button
              onClick={handleMintTestTokens}
              disabled={loading}
              className="text-xs bg-gray-100 hover:bg-gray-200 text-gray-700 px-2.5 py-1 rounded-lg cursor-pointer font-medium"
            >
              + Mint 1K mUSDC
            </button>
            <button
              onClick={handleMintInvx}
              disabled={loading}
              className="text-xs bg-indigo-100 hover:bg-indigo-200 text-indigo-700 px-2.5 py-1 rounded-lg cursor-pointer font-medium"
            >
              + Mint 500 INVX
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
          <div className="bg-gray-50 p-3.5 rounded-xl border border-gray-100">
            <div className="text-[11px] text-gray-500 font-semibold">Wallet mUSDC</div>
            <div className="text-base font-extrabold text-gray-900 mt-1">{parseFloat(userAssetBalance).toFixed(2)}</div>
          </div>
          <div className="bg-gray-50 p-3.5 rounded-xl border border-gray-100">
            <div className="text-[11px] text-gray-500 font-semibold">Idle vINV Shares</div>
            <div className="text-base font-extrabold text-indigo-600 mt-1">{parseFloat(userShares).toFixed(4)}</div>
          </div>
          <div className="bg-gray-50 p-3.5 rounded-xl border border-gray-100">
            <div className="text-[11px] text-gray-500 font-semibold">Farmed vINV</div>
            <div className="text-base font-extrabold text-purple-600 mt-1">{parseFloat(farmedBalance).toFixed(4)}</div>
          </div>
          <div className="bg-amber-50 p-3.5 rounded-xl border border-amber-200">
            <div className="text-[11px] text-amber-700 font-semibold">Pending INVX Farm</div>
            <div className="text-base font-extrabold text-amber-800 mt-1">{parseFloat(earnedInvx).toFixed(4)}</div>
            {parseFloat(earnedInvx) > 0 && (
              <button onClick={handleHarvestFarm} disabled={loading} className="text-[10px] text-amber-900 underline mt-1 font-bold cursor-pointer">
                Harvest
              </button>
            )}
          </div>
          <div className="bg-emerald-50 p-3.5 rounded-xl border border-emerald-200">
            <div className="text-[11px] text-emerald-700 font-semibold">Pending mUSDC Yield</div>
            <div className="text-base font-extrabold text-emerald-800 mt-1">{parseFloat(earnedUsdcYield).toFixed(4)}</div>
            {parseFloat(earnedUsdcYield) > 0 && (
              <button onClick={handleClaimStakingYield} disabled={loading} className="text-[10px] text-emerald-900 underline mt-1 font-bold cursor-pointer">
                Claim
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ─── VAULT METRICS & COMBINED YIELD ─── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="p-5 bg-white rounded-2xl border border-gray-200 shadow-sm">
          <div className="text-xs text-gray-500 uppercase font-semibold">Total Assets Managed</div>
          <div className="text-2xl font-black text-gray-900 mt-1">{parseFloat(totalAssets).toFixed(2)} mUSDC</div>
          {oracleUsdc.isHealthy && oracleUsdc.price18 && (
            <div className="text-[11px] text-emerald-600 font-mono mt-1">
              ≈ ${(parseFloat(totalAssets) * parseFloat(oracleUsdc.price) || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })} USD
            </div>
          )}
          <p className="text-[11px] text-gray-400 mt-1">Idle Cash + Outstanding Invoice Receivables</p>
        </div>
        <div className="p-5 bg-white rounded-2xl border border-gray-200 shadow-sm">
          <div className="text-xs text-gray-500 uppercase font-semibold">Total Vault Supply</div>
          <div className="text-2xl font-black text-indigo-600 mt-1">{parseFloat(totalSupply).toFixed(4)} vINV</div>
          <p className="text-[11px] text-gray-400 mt-1">Decimals: {vaultDecimals} | Standard ERC-4626</p>
        </div>
        <div className="p-5 bg-gradient-to-br from-indigo-50 to-purple-50 rounded-2xl border border-indigo-200 shadow-sm">
          <div className="text-xs text-indigo-700 uppercase font-semibold">Combined Protocol Yield</div>
          <div className="text-2xl font-black text-purple-700 mt-1">{combinedApy}</div>
          <p className="text-[11px] text-indigo-900/70 mt-1">
            {farmApr !== "n/a"
              ? `6.0% Invoice Yield + ${farmApr} Farm APR (${invxSpotPriceLabel})`
              : "6.0% Invoice Yield + Farm APR (n/a until pool is staked)"}
          </p>
        </div>
      </div>

      {/* ─── VAULT CORE ACTIONS: DEPOSIT & REDEEM ─── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Deposit Box */}
        <div className="p-5 border border-gray-200 rounded-2xl bg-white shadow-sm">
          <h3 className="font-bold text-gray-800 mb-2 flex items-center gap-1.5">
            📥 Deposit Assets (`deposit`)
          </h3>
          <p className="text-xs text-gray-500 mb-4">Deposit mUSDC into the vault to receive yield-bearing vINV share tokens.</p>
          <input
            type="number"
            placeholder="Amount of mUSDC to deposit"
            value={depositAmount}
            onChange={(e) => setDepositAmount(e.target.value)}
            className="w-full px-4 py-2.5 border border-gray-300 rounded-xl mb-4 bg-white focus:outline-none text-sm"
          />
          <button
            onClick={handleDeposit}
            disabled={loading || !vaultContract}
            className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-medium py-2.5 rounded-xl transition-all cursor-pointer text-sm"
          >
            1. Approve & 2. Deposit mUSDC
          </button>
        </div>

        {/* Redeem Box */}
        <div className="p-5 border border-gray-200 rounded-2xl bg-white shadow-sm">
          <h3 className="font-bold text-gray-800 mb-2 flex items-center gap-1.5">
            📤 Redeem Vault Shares (`redeem`)
          </h3>
          <p className="text-xs text-gray-500 mb-4">Burn your vINV shares to redeem underlying mUSDC plus accumulated interest.</p>
          <div className="flex gap-2 mb-4">
            <input
              type="number"
              placeholder="Amount of vINV to redeem"
              value={withdrawAmount}
              onChange={(e) => setWithdrawAmount(e.target.value)}
              className="flex-1 px-4 py-2.5 border border-gray-300 rounded-xl bg-white focus:outline-none text-sm"
            />
            <button
              onClick={() => setWithdrawAmount(userShares)}
              className="px-3 py-2 bg-gray-100 hover:bg-gray-200 rounded-xl text-xs font-bold text-gray-600"
            >
              Max
            </button>
          </div>
          <button
            onClick={handleRedeem}
            disabled={loading || !vaultContract || parseFloat(userShares) <= 0}
            className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-medium py-2.5 rounded-xl transition-all cursor-pointer text-sm"
          >
            Redeem Shares & Return mUSDC
          </button>

          {/* Instant Exit via DEX */}
          <div className="mt-3.5 p-3 bg-amber-50 rounded-xl border border-amber-200 text-xs">
            <div className="flex justify-between items-center">
              <span className="font-semibold text-amber-900">⚡ Need Instant Liquidity?</span>
              <button
                onClick={() => setTargetSwapPair({ from: "vINV", to: "mUSDC", amount: withdrawAmount || userShares })}
                disabled={parseFloat(userShares) <= 0}
                className="bg-amber-600 hover:bg-amber-700 text-white font-bold px-2.5 py-1 rounded-lg text-[11px] cursor-pointer"
              >
                Sell vINV on DEX
              </button>
            </div>
            <p className="text-[11px] text-amber-800/80 mt-1">
              Vault idle liquidity: <strong>{parseFloat(vaultIdleCash).toFixed(2)} mUSDC</strong>. If vault cash is allocated to invoices, sell vINV instantly on the DEX AMM without waiting.
            </p>
          </div>
        </div>
      </div>

      {/* ─── EXPERIMENT 5 - PART 2: PROTOCOL STAKING & SUPPLIER TIERS ─── */}
      <div className="bg-white border border-gray-200 rounded-2xl p-6 shadow-sm">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 mb-4">
          <div>
            <h3 className="text-base font-bold text-gray-900">
              💎 Stake INVX & Unlock Supplier Tiers (ReserveStaking)
            </h3>
            <p className="text-xs text-gray-500">
              Stake protocol tokens to earn real mUSDC yield routed from invoice interest repayments (20% share), and unlock invoice fee discounts.
            </p>
          </div>
          <div className="text-right">
            <span className="text-xs text-gray-400">Your Staked: </span>
            <span className="text-xs font-bold text-indigo-700">{parseFloat(stakedInvxBalance).toFixed(2)} INVX</span>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-5">
          <div className="p-3 rounded-xl border border-gray-200 bg-gray-50 text-center">
            <div className="text-xs font-bold text-gray-700">🥉 Bronze Tier</div>
            <div className="text-[11px] text-gray-500 mt-1">0 - 999 INVX</div>
            <div className="text-xs font-bold text-gray-800 mt-1">0% Fee Discount</div>
          </div>
          <div className="p-3 rounded-xl border border-indigo-200 bg-indigo-50/50 text-center">
            <div className="text-xs font-bold text-indigo-800">🥈 Silver Tier</div>
            <div className="text-[11px] text-indigo-600 mt-1">1,000 - 4,999 INVX</div>
            <div className="text-xs font-bold text-indigo-900 mt-1">1.0% Fee Discount (100 bps)</div>
          </div>
          <div className="p-3 rounded-xl border border-amber-200 bg-amber-50/50 text-center">
            <div className="text-xs font-bold text-amber-800">🥇 Gold Tier</div>
            <div className="text-[11px] text-amber-600 mt-1">5,000+ INVX</div>
            <div className="text-xs font-bold text-amber-900 mt-1">2.5% Fee Discount (250 bps)</div>
          </div>
        </div>

        <div className="flex justify-between items-center mb-3">
          <span className="text-xs text-gray-500 font-medium">Need INVX to reach a higher tier?</span>
          <button
            onClick={() => setTargetSwapPair({ from: "mUSDC", to: "INVX" })}
            className="text-xs bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 font-bold px-3 py-1.5 rounded-lg cursor-pointer flex items-center gap-1"
          >
            🛒 Buy INVX with mUSDC on DEX
          </button>
        </div>

        <div className="flex flex-col sm:flex-row gap-3">
          <input
            type="number"
            placeholder="Amount of INVX to Stake"
            value={stakeInvxInput}
            onChange={(e) => setStakeInvxInput(e.target.value)}
            className="flex-1 px-4 py-2.5 border border-gray-300 rounded-xl bg-white text-sm focus:outline-none"
          />
          <button
            onClick={handleStakeInvx}
            disabled={loading || !stakeInvxInput || parseFloat(stakeInvxInput) <= 0}
            className="bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white font-bold text-xs px-6 py-2.5 rounded-xl cursor-pointer"
          >
            Stake INVX
          </button>
          <button
            onClick={handleUnstakeInvx}
            disabled={loading || parseFloat(stakedInvxBalance) <= 0}
            className="bg-gray-100 hover:bg-gray-200 disabled:opacity-50 text-gray-700 font-bold text-xs px-4 py-2.5 rounded-xl cursor-pointer"
          >
            Unstake All
          </button>
        </div>
      </div>

      {/* ─── EXPERIMENT 6: DEX SWAP & LIQUIDITY POOL ─── */}
      <DexSwapCard
        signer={signer}
        account={account}
        assetAddress={assetAddress}
        assetDecimals={assetDecimals}
        vaultAddress={vaultAddress}
        vaultDecimals={vaultDecimals}
        targetSwapPair={targetSwapPair}
        onActionComplete={refreshAllData}
      />

      {/* ─── CONVERSION PREVIEW TOOL ─── */}
      <div className="p-5 bg-indigo-50/40 border border-indigo-100 rounded-2xl">
        <h3 className="font-bold text-indigo-900 mb-2 flex items-center gap-1.5 text-xs uppercase tracking-wider">
          🧮 Dynamic Conversion Calculator (`convertToShares`)
        </h3>
        <div className="flex gap-4 items-center">
          <input
            type="number"
            placeholder="Enter underlying mUSDC amount"
            value={calcAssetsInput}
            onChange={(e) => handlePreviewConversion(e.target.value)}
            className="flex-1 px-4 py-2 border border-gray-200 rounded-xl bg-white text-sm focus:outline-none"
          />
          <span className="text-gray-400 font-bold">&rarr;</span>
          <div className="px-4 py-2 bg-white border border-gray-200 rounded-xl font-mono text-indigo-600 font-bold text-sm">
            {previewSharesOutput} vINV Shares
          </div>
        </div>
      </div>
    </div>
  );
}
