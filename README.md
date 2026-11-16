## DAO governance module

The completed, simplified DAO supports binding financing-fee changes and collateral default penalties in its own invoice workspace. See [DAO launch and demonstration guide](docs/DAO_QUICKSTART.md) for exact PowerShell commands, MetaMask setup, three-wallet walkthrough, and optional Sepolia deployment. Older Sepolia experiments remain separate.

# Invoice Financing Platform — DeFi Experiments 1-7

A full-stack DeFi invoice financing platform built through 7 progressive experiments, featuring ERC-4626 vaults, yield farming, protocol staking, DEX AMM, Chainlink oracle integration, and a React frontend.

## 🏗️ Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        INVOICE FINANCING PLATFORM                       │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌──────────────────┐    ┌──────────────────┐    ┌──────────────────┐ │
│  │   Smart Contracts │    │   Frontend       │    │   Deployment     │ │
│  │   (Hardhat/Sol)   │    │   (React+Vite)   │    │   (Sepolia)      │ │
│  └────────┬──────────┘    └────────┬─────────┘    └────────┬─────────┘ │
│           │                        │                        │           │
│  ┌────────┴──────────┐    ┌────────┴─────────┐    ┌────────┴─────────┐ │
│  │ • InvoiceNFT      │    │ • InvoiceFinancing│    │ • 8 contracts    │ │
│  │ • InvoiceVault    │    │   (Supplier/      │    │   deployed       │ │
│  │   (ERC-4626)      │    │   Investor/Pool)  │    │ • Oracle not     │ │
│  │ • InvoiceFarm     │    │ • VaultDashboard  │    │   yet deployed   │ │
│  │ • ReserveStaking  │    │ • OracleHealth    │    │   (needs 0.012   │ │
│  │ • TierGate        │    │   Badge           │    │   ETH)           │ │
│  │ • FeeRouter       │    │ • DEX Swap        │    │                  │ │
│  │ • DEX (Factory/   │    │ • Wallet Connect  │    │                  │ │
│  │   Router/Pair)    │    │                   │    │                  │ │
│  │ • PlatformPrice   │    │                   │    │                  │ │
│  │   Oracle (Exp 7)  │    │                   │    │                  │ │
│  └───────────────────┘    └───────────────────┘    └──────────────────┘ │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

## 📦 Contracts (Solidity ^0.8.24)

| Contract | Purpose | Experiment |
|----------|---------|------------|
| `InvoiceNFT.sol` | ERC-721 invoice tokenization | 1 |
| `InvoiceVault.sol` | ERC-4626 vault for mUSDC → vINV shares | 4 |
| `InvoiceFarm.sol` | Stake vINV, earn INVX rewards | 5 |
| `ReserveStaking.sol` | Stake INVX, earn mUSDC yield + supplier tiers | 5 |
| `FeeRouter.sol` | 70/20/10 split (Vault/Reserve/Insurance) | 5 |
| `TierGate.sol` | On-chain tier enforcement, limits, unstake lock | 5 |
| `InvoiceLiquidityPool.sol` | AMM pool financing (investor deposits) | 6 |
| `DexFactory/DexRouter/DexPair.sol` | Uniswap v2 DEX for INVX/mUSDC | 6 |
| `PlatformPriceOracle.sol` | Multi-feed Chainlink oracle (Exp 7) | 7 |

## 🧪 Experiments Implemented

### Experiment 1: Invoice NFT Tokenization
- `InvoiceNFT.sol` — ERC-721 with metadata (invoice number, amount, due date, borrower)
- `mintInvoice`, `financeInvoice`, `repayInvoice` functions

### Experiment 2: P2P Marketplace
- Direct supplier ↔ investor financing
- Marketplace listing with ETH amounts

### Experiment 3: Invoice Vault (ERC-4626)
- `InvoiceVault.sol` — Standard ERC-4626 implementation
- `deposit`/`mint`/`withdraw`/`redeem`/`convertToShares`/`convertToAssets`
- Dynamic decimals support (fetches `asset.decimals()` and `vault.decimals()`)

### Experiment 4: Vault Accounting Fix
- Share price resilience when funds allocated to invoices
- Idle cash tracking prevents share dilution

### Experiment 5: Yield Farming + Protocol Staking
| Component | Function |
|-----------|----------|
| `InvoiceFarm` | Stake vINV → earn INVX (utilization-aware emissions) |
| `ReserveStaking` | Stake INVX → earn mUSDC yield (20% fee share) |
| `FeeRouter` | Auto-split: 70% Vault, 20% ReserveStaking, 10% Insurance |
| `TierGate` | Supplier tiers (Bronze/Silver/Gold) → fee discounts + financing caps + unstake lock |

### Experiment 6: DEX Prototype (Uniswap v2)
- `DexFactory` — Pair creation with `CREATE2` deterministic addresses
- `DexRouter` — Swaps, multi-hop, add/remove liquidity, slippage guards, deadlines
- `DexPair` — Constant product AMM, mixed decimals (6 & 18), `k` invariant
- 11 test scenarios covering all Lab document cases

### Experiment 7: Chainlink Price Oracle ✨ **Latest**
- `PlatformPriceOracle.sol` — Single deployed contract with:
  - **Multi-feed support**: ETH/USD, BTC/USD, USDC/USD (configurable via constructor)
  - **SafePrice checks**: `answer > 0`, `updatedAt != 0`, `age ≤ maxAge` (heartbeat × 1.25)
  - **Dynamic decimals**: Reads `feed.decimals()` at registration, normalizes to 18dp (multiply-before-divide)
  - **Conversions**: `ethToUsd`, `usdToEth`, `valueOf(symbol, amount, decimals)`
  - **Circuit breaker**: `isHealthy(symbol)` non-reverting bool for UI
  - **Owner config**: `addFeed`, `updateMaxAge`
- `MockFeed.sol` — Local testing with 8/18 decimals, roundId, answeredInRound
- **Frontend integration**:
  - `useOraclePrice` hook (read-only provider, 30s cache, oracle + direct feed fallback)
  - `OracleHealthBadge` — Header badge + popover with 3-feed health, heartbeats, ages
  - `InvoiceFinancing` — USD-denominated mint mode (live ETH calc, rate locked at listing), circuit breaker disables USD mode when stale, tier cap advisory (UI-only)
  - `VaultDashboard` — TVL in USD when USDC/USD healthy

## 🌐 Frontend (React 18 + Vite + Ethers v6)

### Pages/Components
| Component | Features |
|-----------|----------|
| `InvoiceFinancing.jsx` | 3 tabs: Supplier (mint ETH/USD), P2P Marketplace, Pool Financing (deposit/withdraw/request financing/repay) |
| `VaultDashboard.jsx` | ERC-4626 deposit/redeem, 1-click Deposit & Farm, Farm harvest/withdraw, ReserveStaking stake/unstake/claim, Combined APY, DEX swap card, conversion calculator |
| `OracleHealthBadge.jsx` | Header badge (price + age + colored dot), popover with 3 feeds (status, price, heartbeat, maxAge, source) |
| `Navbar.jsx` | Wallet connect (MetaMask/WalletConnect), Oracle badge, auth state |

### Key Features
- **Multi-tab financing**: P2P, Pool, USD-denominated mint
- **Real-time oracle data**: 30s polling, freshness status (fresh/aging/stale/unavailable)
- **Circuit breaker**: Disables USD mint & financing when price stale
- **Tier advisory**: Warns if invoice USD > supplier tier limit (UI-only)
- **Dynamic decimals**: All conversions use on-chain `decimals()` reads
- **WalletConnect + MetaMask** support

## 📁 Project Structure

```
E:\Desktop\CBD minproject\
├── contracts/
│   ├── *.sol                    # 17 main contracts + interfaces
│   └── test/MockFeed.sol        # Local Chainlink mock
├── test/
│   ├── Experiment5.test.js      # 12 tests (vault, farm, staking, router, tiergate)
│   ├── Experiment6.test.js      # 11 tests (DEX scenarios 1-11)
│   └── Experiment7.test.js      # 14 tests (5 doc cases + 9 extended)
├── scripts/
│   ├── deploy_exp5.js           # Deploys Exp 1-5 contracts
│   ├── deploy_dex.js            # Deploys DEX (factory, router, pair)
│   ├── deploy_oracle.js         # 5-gate oracle deployment (Exp 7)
│   ├── preflight.js             # Pre-deployment checks
│   ├── smoke_test.js            # Post-deploy verification
│   └── dex_gate_and_deploy.js   # DEX gate checks
├── deployments/
│   ├── sepolia.json             # Exp 1-5 deployed addresses
│   ├── dex-sepolia.json         # DEX deployed addresses
│   └── oracle-sepolia.json      # (Created after oracle deploy)
├── warranty-tracker/            # React frontend
│   ├── src/
│   │   ├── components/          # InvoiceFinancing, VaultDashboard, OracleHealthBadge, Navbar, DEX, etc.
│   │   ├── hooks/useOraclePrice.js
│   │   ├── config/              # All contract ABIs + addresses + oracle config
│   │   ├── context/WalletContext.jsx
│   │   └── pages/Login.jsx, SignUp.jsx
│   └── dist/                    # Production build
└── docs/
    ├── EXPERIMENT5_DOCUMENTATION.md
    └── EXPERIMENT5_EVIDENCE.md
```

## 🚀 Quick Start

### Prerequisites
- Node 18+
- Git
- Sepolia ETH (for deployment)

### Local Development

```bash
# 1. Install dependencies
cd "E:\Desktop\CBD minproject"
npm install

cd warranty-tracker
npm install

# 2. Run local Hardhat node (terminal 1)
cd ..
npx hardhat node

# 3. Deploy contracts locally (terminal 2)
npx hardhat run scripts/deploy_exp5.js --network hardhat
npx hardhat run scripts/deploy_dex.js --network hardhat
# Oracle deploys on fork (no local deploy needed)

# 4. Start frontend (terminal 3)
cd warranty-tracker
npm run dev
# → http://localhost:5173
```

### Run Tests
```bash
cd "E:\Desktop\CBD minproject"
npx hardhat test
# 34 tests passing (Exp 5: 12, Exp 6: 11, Exp 7: 14)
```

## 📡 Sepolia Deployment Status

| Contract | Address | Explorer |
|----------|---------|----------|
| InvoiceVault | `0x81289DBECab824C8db0d5193e2D6a8d8276A1456` | [Etherscan](https://sepolia.etherscan.io/address/0x81289DBECab824C8db0d5193e2D6a8d8276A1456) |
| INVX | `0xc2b51d72E701013F2107F77a7eDFB74735332739` | [Etherscan](https://sepolia.etherscan.io/address/0xc2b51d72E701013F2107F77a7eDFB74735332739) |
| ReserveStaking | `0xfd26E9E48a0AF8c695db86667203f9f0aaAbAC24` | [Etherscan](https://sepolia.etherscan.io/address/0xfd26E9E48a0AF8c695db86667203f9f0aaAbAC24) |
| InvoiceFarm | `0x5a2268E7e3ae8E83190422d508237f3A6fBEfa78` | [Etherscan](https://sepolia.etherscan.io/address/0x5a2268E7e3ae8E83190422d508237f3A6fBEfa78) |
| FeeRouter | `0x1cBABbD581f4fe4566B22a21CF33D35e17b8b268` | [Etherscan](https://sepolia.etherscan.io/address/0x1cBABbD581f4fe4566B22a21CF33D35e17b8b268) |
| TierGate | `0x6136516ce353dbAa62B1c1B63F6b41b502D6cCc8` | [Etherscan](https://sepolia.etherscan.io/address/0x6136516ce353dbAa62B1c1B63F6b41b502D6cCc8) |
| DexFactory | `0x17e54a6428dCf74fDA543DcDbf3949762836Fa8b` | [Etherscan](https://sepolia.etherscan.io/address/0x17e54a6428dCf74fDA543DcDbf3949762836Fa8b) |
| DexRouter | `0xAd1D256C1dd832485e11e014141b80ADDcf41440` | [Etherscan](https://sepolia.etherscan.io/address/0xAd1D256C1dd832485e11e014141b80ADDcf41440) |
| Pair INVX/mUSDC | `0x2Fe73871303b16A11FA0fd75DFB8306CAFb2BE48` | [Etherscan](https://sepolia.etherscan.io/address/0x2Fe73871303b16A11FA0fd75DFB8306CAFb2BE48) |
| **PlatformPriceOracle** | **PENDING** (needs 0.012 ETH) | — |

### Deploy Oracle (Experiment 7)
```bash
# 1. Fund deployer: 0x6e5e55388fA5fde92293FC17F15cf5d89daF5755 with ≥0.012 Sepolia ETH
# 2. Run deployment (single command, 5 gates):
npx hardhat run scripts/deploy_oracle.js --network sepolia

# 3. Rebuild frontend with real oracle address
cd warranty-tracker && npm run build
```

**Deployer:** `0x6e5e55388fA5fde92293FC17F15cf5d89daF5755`  
**Estimated cost:** ~0.012 ETH (9.6M gas × 1 gwei × 1.25 buffer)

### Oracle Feeds (Verified on data.chain.link)
| Feed | Address | Heartbeat | MaxAge | Decimals |
|------|---------|-----------|--------|----------|
| ETH/USD | `0x694AA1769357215DE4FAC081bf1f309aDC325306` | 3600s | 4500s | 8 |
| BTC/USD | `0x1b44F3514812d835EB1BDB0acB33d3fA3351Ee43` | 3600s | 4500s | 8 |
| USDC/USD | `0xA2F78ab2355fe2f984D808B5CeE7FD0A93D5270E` | 86400s | 108000s | 8 |

## 📋 What's Complete vs Remaining

### ✅ Complete (Experiments 1-7)
- [x] All 17 smart contracts written, compiled, tested
- [x] 8 contracts deployed to Sepolia (Exp 1-6)
- [x] DEX deployed and verified (factory, router, INVX/mUSDC pair)
- [x] All 34 Hardhat tests passing
- [x] React frontend with all features:
  - Invoice financing (P2P + Pool + USD mode)
  - Vault dashboard (deposit, farm, stake, DEX swap)
  - Oracle health badge + popover
  - USD-denominated mint with live conversion
  - Circuit breaker + tier advisory
  - WalletConnect + MetaMask
- [x] 5-gate oracle deployment script (ready to run)
- [x] Frontend builds successfully (`npm run build`)
- [x] Deployment records in `deployments/*.json`

### ⏳ Remaining / To Do
- [ ] **Deploy PlatformPriceOracle to Sepolia** (fund deployer with 0.012 ETH)
- [ ] Deploy `InvoiceLiquidityPool.sol` to Sepolia (for pool financing tab)
- [ ] Update `POOL_CONTRACT_ADDRESS` in `InvoiceFinancing.jsx` after pool deploy
- [ ] E2E Playwright tests for frontend (multi-viewport)
- [ ] Render deployment configuration (if hosting frontend)
- [ ] Optional: Add more Chainlink feeds (LINK/USD, ARB/USD, etc.)
- [ ] Optional: On-chain oracle consumption (e.g., TierGate uses oracle for USD limits)

## 🔧 Configuration Files

| File | Purpose |
|------|---------|
| `hardhat.config.js` | Solidity 0.8.24, optimizer, Sepolia network |
| `warranty-tracker/src/config/oracleConfig.js` | Oracle address, feed addresses, ABIs |
| `warranty-tracker/src/config/contractConfig.js` | Core contract addresses |
| `warranty-tracker/src/config/farmConfig.js` | Farm, staking, INVX addresses |
| `warranty-tracker/src/config/dexConfig.js` | DEX factory, router addresses |
| `.env` | PRIVATE_KEY, SEPOLIA_RPC_URL, ETHERSCAN_API_KEY |

## 📜 License

MIT — Built as a progressive DeFi learning platform through 7 experiments.