import hre from "hardhat";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const { ethers } = hre;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export async function deployGovernance({ publish = true } = {}) {
  // Never export addresses for an in-process chain which disappears at command exit.
  if (publish && !["localhost", "sepolia"].includes(hre.network.name)) {
    throw new Error("Use npm run deploy:gov (persistent localhost) or deploy:gov:sepolia.");
  }
  const signers = await ethers.getSigners();
  const [owner] = signers;
  if (!owner) throw new Error("No deployer configured. Keep deployment credentials locally.");
  const chainId = Number((await ethers.provider.getNetwork()).chainId);
  const isLocal = chainId === 31337;
  let members = isLocal ? signers.slice(1, 4).map(s => s.address) : [];
  if (!isLocal) {
    members = JSON.parse(process.env.GOVERNANCE_MEMBERS || "[]");
    if (members.length !== 3 || members.some(a => !ethers.isAddress(a) || a === ethers.ZeroAddress)
      || new Set(members.map(a => a.toLowerCase())).size !== 3
      || members.some(a => a.toLowerCase() === owner.address.toLowerCase())) {
      throw new Error('Set GOVERNANCE_MEMBERS to a JSON array of three distinct wallets you control, excluding deployer.');
    }
  }
  const deploy = async (name, ...args) => {
    const c = await (await ethers.getContractFactory(name)).deploy(...args);
    await c.waitForDeployment();
    console.log(name, await c.getAddress());
    return c;
  };
  const params = { proposalThreshold: ethers.parseEther("100"), votingDelayBlocks: 0,
    votingPeriodSeconds: 180, quorumBps: 400, majorityBps: 5001,
    timelockDelay: 60, queueWindow: 3600, gracePeriod: 3600 };
  const dtest = await deploy("DTEST", ethers.parseEther("1000000"), owner.address);
  const invx = await deploy("INVX");
  const usdc = await deploy("MockUSDC");
  const staking = await deploy("ReserveStaking", invx.target, usdc.target);
  const invoices = await deploy("InvoiceNFT");
  const gov = await deploy("Governance", dtest.target, params, owner.address);
  const config = await deploy("PlatformConfig", owner.address, staking.target, invoices.target, ethers.ZeroAddress, owner.address);
  await (await invoices.configureCollateral(staking.target, owner.address)).wait();
  await (await invoices.setPlatformFeeBps(50)).wait();
  await (await staking.setAuthorizedLockerStatus(invoices.target, true)).wait();
  await (await staking.setAuthorizedLockerStatus(config.target, true)).wait();
  await (await staking.sealCollateralAdmin()).wait();
  await (await invoices.transferOwnership(config.target)).wait();
  await (await gov.setTargetWhitelisted(config.target, true)).wait();
  for (const [fn, type] of [["setPlatformFeeBps", 1], ["applyDefaultPenalty", 0]]) {
    await (await gov.setTargetSelector(config.target, config.interface.getFunction(fn).selector, type, true)).wait();
  }
  await (await config.transferOwnership(gov.target)).wait();
  // Seal bootstrap permissions: guardian may veto, but cannot expand execution authority later.
  await (await gov.sealPermissions()).wait();
  for (const [i, member] of members.entries()) {
    await (await dtest.transfer(member, ethers.parseEther(i === 0 ? "50000" : "20000"))).wait();
    await (await invx.transfer(member, ethers.parseEther("2000"))).wait();
    const signer = isLocal ? signers.find(s => s.address.toLowerCase() === member.toLowerCase()) : null;
    if (signer) await (await dtest.connect(signer).delegate(member)).wait();
  }
  await (await dtest.sealMinting()).wait();

  // All dependencies are deployed fresh on the selected chain. Never reuse a different chain's receipt.
  const receipt = { network: hre.network.name, chainId, deployedAt: new Date().toISOString(),
    DTEST: dtest.target, Governance: gov.target, PlatformConfig: config.target,
    INVX: invx.target, MockUSDC: usdc.target, ReserveStaking: staking.target, InvoiceNFT: invoices.target,
    treasury: owner.address, members, votingPeriodSeconds: 180, timelockDelay: 60,
    deploymentBlock: await ethers.provider.getBlockNumber() };
  for (const name of ["DTEST", "Governance", "PlatformConfig", "INVX", "MockUSDC", "ReserveStaking", "InvoiceNFT"]) {
    if ((await ethers.provider.getCode(receipt[name])) === "0x") throw new Error(`Missing code: ${name}`);
  }
  if (await config.owner() !== gov.target || await invoices.owner() !== config.target
      || !await staking.isAuthorizedLocker(config.target) || !await staking.isAuthorizedLocker(invoices.target)
      || await invoices.platformFeeBps() !== await config.platformFeeBps()
      || !await dtest.mintingSealed() || !await gov.permissionsSealed() || !await staking.collateralAdminSealed()) throw new Error("Post-deployment verification failed");
  const dir = path.join(root, "warranty-tracker/src/config");
  if (publish) {
  for (const [name, file] of [["DTEST", "dtestAbi"], ["Governance", "governanceAbi"], ["PlatformConfig", "platformConfigAbi"],
      ["InvoiceNFT", "governanceInvoiceAbi"], ["ReserveStaking", "governanceStakingAbi"], ["INVX", "governanceInvxAbi"]]) {
    fs.writeFileSync(path.join(dir, file + ".json"), JSON.stringify((await hre.artifacts.readArtifact(name)).abi, null, 2));
  }
  fs.writeFileSync(path.join(dir, "governanceDeployment.json"), JSON.stringify(receipt, null, 2));
  fs.writeFileSync(path.join(root, `deployments/governance-${isLocal ? "local" : "sepolia"}.json`), JSON.stringify(receipt, null, 2));
  }
  console.log("Deployment verified. DAO workspace uses chain", chainId);
  console.log("Members:", members.join(", "));
  if (!isLocal) console.log("Each member must self-delegate DTEST from the DAO Voting Power tab.");
  return { receipt, dtest, invx, staking, invoices, gov, config };
}
if (!process.env.GOVERNANCE_VERIFY) deployGovernance().catch(err => { console.error(err.message); process.exitCode = 1; });
