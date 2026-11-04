# Blockchain Warranty Tracker

A full-stack blockchain-based warranty management system built with React, Vite, and Solidity. The app allows manufacturers to mint warranty NFTs for products and lets customers view, validate, and transfer those warranties securely on the Sepolia testnet.

## Overview

This project demonstrates how warranty records can be represented as ERC-721 NFTs, making product ownership and warranty validity verifiable on-chain. It is designed for demo and learning purposes and is suitable for showcasing blockchain-based product lifecycle tracking.

## Features

- Manufacturer dashboard to mint warranty NFTs
- Customer dashboard to view owned warranties
- Warranty validity checking based on expiry date
- Transfer of warranty NFTs between wallet addresses
- Wallet connection using MetaMask
- Smart contract deployment on Ethereum Sepolia testnet

## Tech Stack

- React + Vite
- Ethers.js
- Solidity
- OpenZeppelin ERC721
- MetaMask wallet integration
- Sepolia test network

## Project Structure

```bash
warranty-tracker/
├── public/
├── src/
│   ├── components/
│   ├── config/
│   ├── pages/
│   ├── utils/
│   ├── App.jsx
│   ├── main.jsx
│   └── index.css
├── package.json
├── vite.config.js
├── eslint.config.js
├── index.html
└── README.md
```

The Solidity contract is located in the project root as `WarrantyTracker.sol`.

## Prerequisites

Before running the app, make sure you have:

- Node.js 18+ installed
- npm or yarn installed
- MetaMask browser extension installed
- Access to the Sepolia test network
- Some Sepolia ETH for deploying or interacting with the contract

## Setup Instructions

1. Open a terminal in the project folder:

```bash
cd warranty-tracker
```

2. Install dependencies:

```bash
npm install
```

3. Start the development server:

```bash
npm run dev
```

4. Open the local URL shown in the terminal, usually:

```bash
http://localhost:5173
```

## Smart Contract Deployment

The smart contract is in the root folder:

- `WarrantyTracker.sol`

To deploy it:

1. Open Remix IDE.
2. Create a new Solidity file or upload `WarrantyTracker.sol`.
3. Compile the contract.
4. Deploy it on the Sepolia testnet.
5. Copy the deployed contract address.
6. Update the contract configuration in `src/config/contractConfig.js`.

Example:

```js
export const CONTRACT_ADDRESS = "YOUR_DEPLOYED_CONTRACT_ADDRESS";
```

If you modified the Solidity contract, also make sure the ABI in `src/config/contractAbi.json` matches the deployed version.

## How to Use

### 1. Connect your wallet

- Open the app in the browser.
- Click the Connect Wallet button.
- Approve the MetaMask connection.

### 2. Manufacturer flow

If the connected wallet is the contract owner:

- Open the Manufacturer dashboard.
- Enter product details such as:
  - customer wallet address
  - serial number
  - warranty duration in days
  - metadata/IPFS URI
- Click mint to create the warranty NFT.

### 3. Customer flow

As a customer:

- Open the My Warranties section.
- View all warranty NFTs associated with your wallet.
- Check whether each warranty is still valid.
- Review details like serial number, issue date, and expiry date.

### 4. Transfer a warranty

- Select a warranty card.
- Use the transfer option.
- Enter the recipient wallet address.
- Confirm the transaction in MetaMask.

## Available Scripts

```bash
npm run dev
npm run build
npm run preview
npm run lint
```

## Notes

- The app expects MetaMask to be installed and connected to Sepolia.
- The contract owner (manufacturer) is the wallet that deployed the smart contract.
- This project is intended for demonstration and educational use.

## License

This project is licensed under the MIT License.
