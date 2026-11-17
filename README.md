# Invoice Financing Platform

A full-stack DeFi platform for invoice financing — combining ERC-4626 vaults, yield farming, protocol staking, a Uniswap v2-style DEX, Chainlink price oracle integration, and a DAO governance module. Built with Solidity, Hardhat, React 18, and Ethers v6.

---

## 🎯 What This Platform Does

### Invoice Lifecycle & Financing
- **Tokenize invoices as NFTs** — ERC-721 with metadata (invoice number, amount, due date, borrower)
- **Three financing paths** — direct P2P investor, shared liquidity pool, or USD-denominated minting
- **Automated repayment** — principal + 5% interest returned to investors/pool
- **Supplier credit tiers** — Bronze/Silver/Gold based on INVX staked; fee discounts (0%/1%/2.5%) and financing caps enforced on-chain

### Vault & Yield
- **ERC-4626 compliant vault** — deposit mUSDC, receive yield-bearing vINV shares
- **Dynamic decimals** — automatically reads `asset.decimals()` and `vault.decimals()` for precision
- **Share price resilience** — idle cash tracking prevents dilution when funds allocated to invoices
- **Yield farming** — stake vINV in InvoiceFarm to earn INVX rewards (utilization-aware emissions)
- **Protocol staking** — stake INVX in ReserveStaking to earn mUSDC yield (20% of platform fees)
- **Fee router** — automatic 70/20/10 split (Vault / ReserveStaking / Insurance Reserve)

### DEX & Liquidity
- **Uniswap v2 AMM** — factory, router, and pair contracts with CREATE2 deterministic addresses
- **Full swap suite** — single-hop, multi-hop, add/remove liquidity, slippage guards, deadlines
- **Mixed-decimal support** — 6 decimals (mUSDC) and 18 decimals (INVX) with perfect precision
- **INVX/mUSDC pair** — deployed and verified for trading and liquidity provision

### Chainlink Price Oracle
- **Multi-feed oracle** — ETH/USD, BTC/USD, USDC/USD registered in constructor (single deployment)
- **SafePrice validation** — `answer > 0`, `updatedAt != 0`, `age ≤ maxAge` (heartbeat × 1.25)
- **Dynamic decimal normalization** — reads `feed.decimals()` at registration, normalizes to 18dp (multiply-before-divide)
- **On-chain conversions** — `ethToUsd`, `usdToEth`, `valueOf(symbol, amount, decimals)`
- **Circuit breaker** — `isHealthy(symbol)` non-reverting bool for UI
- **Owner administration** — `addFeed`, `updateMaxAge` for post-deploy configuration

### DAO Governance
- **Binding proposals** — change financing fee (10–1000 bps) or penalize defaulting suppliers
- **Snapshot voting** — ERC20Votes (DTEST) with flash-loan protection (block.number - 1 snapshots)
- **Timelock execution** — queue → wait → execute with guardian veto
- **Whitelisted targets/selectors** — only authorized contracts and functions callable via governance
- **Sealed permissions** — minting, execution authority, and collateral admin locked after bootstrap
- **Collateral penalty** — slash INVX from overdue supplier (once per invoice, transfers to treasury)

### Frontend (React 18 + Vite)
- **Invoice Financing** — Supplier (mint ETH/USD), P2P Marketplace, Pool Financing tabs
- **Vault Dashboard** — deposit/redeem, 1-click Deposit & Farm, farm harvest/withdraw, staking, DEX swap, conversion calculator
- **Oracle Health Badge** — header badge (price + age + colored dot), popover with 3-feed status, heartbeats, source indicator
- **DAO Governance** — create proposals, vote, delegate, queue, execute, view proposal lifecycle
- **Invoices & Collateral** — deposit INVX, create invoices, finance, simulate default, execute penalty
- **Real-time data** — 30s polling, freshness states (fresh/aging/stale/unavailable), circuit breaker UI
- **Wallet support** — MetaMask + WalletConnect, multi-account switching

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        INVOICE FINANCING PLATFORM                           │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌──────────────────┐    ┌──────────────────┐    ┌──────────────────┐     │
│  │  Smart Contracts │    │    Frontend      │    │   Networks       │     │
│  │  (Solidity)      │    │  (React + Vite)  │    │                  │     │
│  └────────┬─────────┘    └────────┬─────────┘    └────────┬─────────┘     │
│           │                       │                       │               │
│  ┌────────┴─────────┐    ┌────────┴─────────┐    ┌────────┴─────────┐     │
│  │ • InvoiceNFT     │    │ • InvoiceFinancing│    │ • Sepolia: 8     │     │
│  │ • InvoiceVault   │    │   (3 tabs)       │    │   core contracts │     │
│  │   (ERC-4626)     │    │ • VaultDashboard │    │ • DEX: factory,  │     │
│  │ • InvoiceFarm    │    │ • OracleHealth   │    │   router, pair   │     │
│  │ • ReserveStaking │    │   Badge          │    │ • Oracle:        │     │
│  │ • FeeRouter      │    │ • DAO Governance │    │   PlatformPrice  │     │
│  │ • TierGate       │    │   (proposals,    │    │ • Localhost:     │     │
│  │ • DEX Factory/   │    │   voting, delegate)│  │   DAO workspace  │     │
│  │   Router/Pair    │    │ • Invoices &     │    │   (7 contracts)  │     │
│  │ • PlatformPrice  │    │   Collateral     │    │                  │     │
│  │   Oracle         │    │ • WalletConnect  │    │                  │     │
│  │ • DTEST,         │    │   + MetaMask     │    │                  │     │
│  │   Governance,    │    │                   │    │                  │     │
│  │   PlatformConfig │    │                   │    │                  │     │
│  └──────────────────┘    └──────────────────┘    └──────────────────┘     │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 📦 Core Contracts

| Contract | Purpose |
|----------|---------|
| `InvoiceNFT.sol` | ERC-721 invoice tokenization with financing/repayment logic |
| `InvoiceVault.sol` | ERC-4626 vault (mUSDC → vINV shares) |
| `InvoiceFarm.sol` | Stake vINV → earn INVX (utilization-aware emissions) |
| `ReserveStaking.sol` | Stake INVX → earn mUSDC yield + supplier tiers |
| `FeeRouter.sol` | 70/20/10 automated fee split (Vault/Reserve/Insurance) |
| `TierGate.sol` | On-chain tier enforcement, limits, unstake lock |
| `InvoiceLiquidityPool.sol` | AMM pool financing for investor deposits |
| `DexFactory/DexRouter/DexPair.sol` | Uniswap v2 DEX (INVX/mUSDC) |
| `PlatformPriceOracle.sol` | Multi-feed Chainlink oracle (ETH/BTC/USDC-USD) |
| `DTEST.sol` | ERC20Votes governance token with faucet + delegation |
| `Governance.sol` | DAO core (proposals, voting, timelock, whitelists) |
| `PlatformConfig.sol` | DAO-executable fee changes & collateral penalties |

---

## 🌐 Deployment Status

### Sepolia (Live)
| Contract | Address |
|----------|---------|
| InvoiceVault | `0x81289DBECab824C8db0d5193e2D6a8d8276A1456` |
| INVX | `0xc2b51d72E701013F2107F77a7eDFB74735332739` |
| ReserveStaking | `0xfd26E9E48a0AF8c695db86667203f9f0aaAbAC24` |
| InvoiceFarm | `0x5a2268E7e3ae8E83190422d508237f3A6fBEfa78` |
| FeeRouter | `0x1cBABbD581f4fe4566B22a21CF33D35e17b8b268` |
| TierGate | `0x6136516ce353dbAa62B1c1B63F6b41b502D6cCc8` |
| DexFactory | `0x17e54a6428dCf74fDA543DcDbf3949762836Fa8b` |
| DexRouter | `0xAd1D256C1dd832485e11e014141b80ADDcf41440` |
| INVX/mUSDC Pair | `0x2Fe73871303b16A11FA0fd75DFB8306CAFb2BE48` |
| **PlatformPriceOracle** | `0x6a6f2d0B3Fe78da7bC2b2749AB76663e2A934004` |

### Localhost (DAO Workspace)
Run `npm run node:local` then `npm run deploy:gov` to deploy 7 governance contracts locally with seeded accounts (Alice/Bob/Charlie).

---

## 🧪 Testing

```bash
# All tests (89 passing)
npx hardhat test

# Breakdown:
# - Experiments 1-7: 34 tests
# - DAO Governance: 35 tests  
# - Security (flash-loan, snapshot): 10 tests
# - Regression/integration: 10 tests
```

---

## 🚀 Quick Start

### Prerequisites
- Node 18+
- Git

### Local Development (Full Stack)
```bash
# 1. Install dependencies
cd invoice-financing-platform
npm install
cd warranty-tracker && npm install && cd ..

# 2. Start local Hardhat node (terminal 1)
npm run node:local
# → http://127.0.0.1:8545 (Chain ID 31337)

# 3. Deploy DAO workspace (terminal 2)
npm run deploy:gov
# Deploys 7 governance contracts + seeds Alice/Bob/Charlie

# 4. Start frontend (terminal 3)
cd warranty-tracker && npm run dev -- --host 127.0.0.1
# → http://127.0.0.1:5174
```

### Sepolia Development (Experiments 1-7)
```bash
# Deploy core contracts
npx hardhat run scripts/deploy_exp5.js --network sepolia
npx hardhat run scripts/deploy_dex.js --network sepolia

# Deploy oracle (5-gate script)
npx hardhat run scripts/deploy_oracle.js --network sepolia
```

### MetaMask Setup (Local)
| Field | Value |
|-------|-------|
| Network | DeFiSpace Local |
| RPC | http://127.0.0.1:8545 |
| Chain ID | 31337 |
| Symbol | ETH |

**Demo Accounts** (import private keys from `npm run node:local` output):
- Alice (Account #1) — 50,000 DTEST, 2,000 INVX — proposer/borrower
- Bob (Account #2) — 20,000 DTEST, 2,000 INVX — voter/investor  
- Charlie (Account #3) — 20,000 DTEST, 2,000 INVX — voter

---

## ⚙️ Configuration

| File | Purpose |
|------|---------|
| `hardhat.config.js` | Solidity 0.8.24, optimizer, networks |
| `.env` | PRIVATE_KEY, SEPOLIA_RPC_URL, ETHERSCAN_API_KEY |
| `warranty-tracker/src/config/oracleConfig.js` | Oracle address, feed configs, ABIs |
| `warranty-tracker/src/config/governanceConfig.js` | DAO contract addresses (local/sepolia) |
| `warranty-tracker/src/config/contractConfig.js` | Core Sepolia contract addresses |
| `warranty-tracker/src/config/farmConfig.js` | Farm, staking, INVX addresses |
| `warranty-tracker/src/config/dexConfig.js` | DEX factory, router addresses |

---

## 📋 Key Features Summary

**Invoice Financing**
- ✅ NFT tokenization with metadata
- ✅ P2P direct financing
- ✅ Shared liquidity pool (AMM)
- ✅ USD-denominated minting (live oracle conversion)
- ✅ Circuit breaker (disables USD/financing when price stale)
- ✅ Tier-based fee discounts & caps (on-chain)

**Vault & Yield**
- ✅ ERC-4626 standard compliance
- ✅ Dynamic decimals support
- ✅ Share price protection
- ✅ vINV farming → INVX rewards
- ✅ INVX staking → mUSDC yield
- ✅ Automated 70/20/10 fee routing

**DEX**
- ✅ Uniswap v2 AMM (factory/router/pair)
- ✅ CREATE2 deterministic pairs
- ✅ Multi-hop swaps
- ✅ Slippage guards, deadlines
- ✅ Mixed decimal precision

**Oracle**
- ✅ Multi-feed (ETH/BTC/USDC-USD)
- ✅ SafePrice 3-check validation
- ✅ Dynamic 18dp normalization
- ✅ ethToUsd / usdToEth / valueOf
- ✅ isHealthy circuit breaker
- ✅ Owner feed management

**Governance**
- ✅ Fee change proposals (10–1000 bps)
- ✅ Collateral penalty proposals
- ✅ ERC20Votes snapshot voting
- ✅ Flash-loan resistant snapshots
- ✅ Timelock + guardian veto
- ✅ Whitelisted targets/selectors
- ✅ Sealed permissions post-bootstrap

**Frontend**
- ✅ Multi-tab invoice financing
- ✅ Vault dashboard (deposit, farm, stake, swap)
- ✅ Oracle health badge + popover
- ✅ DAO governance (create, vote, delegate, execute)
- ✅ Invoices & collateral management
- ✅ Real-time polling + circuit breaker UI
- ✅ MetaMask + WalletConnect

---

## 📜 License

MIT — A progressive DeFi platform demonstrating invoice financing, vault yield, DEX liquidity, oracle integration, and DAO governance.
