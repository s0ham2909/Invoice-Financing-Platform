import hre from "hardhat";
if (Number((await hre.ethers.provider.getNetwork()).chainId) !== 31337) throw new Error("Local demo only");
const seconds = Number(process.env.DEMO_SECONDS || 86401);
if (!Number.isSafeInteger(seconds) || seconds < 1) throw new Error("Invalid DEMO_SECONDS");
await hre.network.provider.send("evm_increaseTime", [seconds]);
await hre.network.provider.send("evm_mine");
console.log(`Advanced LOCAL chain by ${seconds} seconds. Refresh the app.`);
