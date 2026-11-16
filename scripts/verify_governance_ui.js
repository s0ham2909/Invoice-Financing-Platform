// Optional offline browser regression. Uses unlocked IN-MEMORY Hardhat accounts, never real wallets.
// PLAYWRIGHT_MODULE may point to an existing playwright-core installation.
import hre from "hardhat";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const resultsDir = path.join(root, "test-results");
fs.mkdirSync(resultsDir, { recursive: true });
if (hre.network.name !== "hardhat") throw new Error("Browser verification only runs on an isolated in-memory Hardhat chain.");
process.env.GOVERNANCE_VERIFY = "1";
const { deployGovernance } = await import("./deploy_governance.js");
const { receipt, gov, invoices, config, staking } = await deployGovernance({ publish: false });
const { build } = await import("../warranty-tracker/node_modules/vite/dist/node/index.js");
const built = await build({ root: path.join(root, "warranty-tracker"), logLevel: "error",
  plugins: [{ name: "in-memory-dao-fixture", enforce: "pre", load(id) {
    if (id.endsWith("/governanceDeployment.json")) return JSON.stringify(receipt);
  } }], build: { write: false } });
const files = new Map((Array.isArray(built) ? built : [built]).flatMap(b => b.output).map(f => [f.fileName, f.type === "chunk" ? f.code : f.source]));
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright-core");
const browser = await chromium.launch({ headless: true, env: { ...process.env, CHROME_LOG_FILE: path.join(resultsDir, "chromium.log") }, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}) });
const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
const pageErrors = [];
page.on("pageerror", err => pageErrors.push(err.message));
page.on("dialog", dialog => dialog.accept());
page.setDefaultTimeout(20000);
await page.exposeFunction("testRpc", async ({ method, params = [] }) => hre.network.provider.send(method, params));
await page.addInitScript(({ member }) => {
  const listeners = new Map();
  const wallet = { selected: member, chainId: "0x7a69", rejectNext: false,
    on(name, cb) { const set = listeners.get(name) || new Set(); set.add(cb); listeners.set(name, set); },
    removeListener(name, cb) { listeners.get(name)?.delete(cb); },
    changeAccount(address) { wallet.selected = address; listeners.get("accountsChanged")?.forEach(cb => cb(address ? [address] : [])); },
    changeChain(chainId) { wallet.chainId = chainId; listeners.get("chainChanged")?.forEach(cb => cb(chainId)); },
    async request({ method, params = [] }) {
      if (method === "eth_accounts" || method === "eth_requestAccounts") return wallet.selected ? [wallet.selected] : [];
      if (method === "eth_chainId") return wallet.chainId;
      if (method === "wallet_switchEthereumChain") { wallet.changeChain(params[0].chainId); return null; }
      if (method === "eth_sendTransaction" && wallet.rejectNext) { wallet.rejectNext = false; throw Object.assign(new Error("User rejected"), { code: 4001 }); }
      return window.testRpc({ method, params });
    } };
  window.ethereum = wallet;
}, { member: receipt.members[0] });
await page.route("**/*", async route => {
  const url = new URL(route.request().url());
  const name = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
  const file = files.get(name);
  if (file === undefined) return route.fulfill({ status: 404, body: "Not found" });
  await route.fulfill({ status: 200, contentType: name.endsWith(".js") ? "text/javascript" : name.endsWith(".css") ? "text/css" : name.endsWith(".html") ? "text/html" : "application/octet-stream", body: Buffer.from(file) });
});
async function text(value) { await page.getByText(value, { exact: false }).first().waitFor(); }
async function button(name) { await page.getByRole("button", { name, exact: false }).first().click(); }
async function advance(seconds) { await hre.network.provider.send("evm_increaseTime", [seconds]); await hre.network.provider.send("evm_mine"); await button("Refresh"); }
async function member(index) {
  await page.evaluate(address => window.ethereum.changeAccount(address), receipt.members[index]);
  await text(index === 0 ? "50000.0 DTEST" : "20000.0 DTEST");
}
async function passCurrent() {
  await button("Vote For"); await text("You have voted on this proposal");
  await advance(181); await text("Succeeded"); await button("Queue in Timelock");
  await text("Queued"); await advance(61); await button("Execute Proposal on Blockchain"); await text("Executed");
}
try {
  await page.goto("http://defispace.test/");
  await text("50000.0 DTEST");
  await button("Create proposal");
  await page.getByLabel("Reason", { exact: true }).fill("Change financing fee to 1.5 percent");
  await button("Submit proposal");
  await text("Change financing fee to 1.5 percent");
  await button("Vote For"); await text("You have voted on this proposal");
  assert.equal(await page.getByRole("button", { name: /Vote For/ }).count(), 0, "Duplicate voting must be blocked in the UI");
  await member(1); await button("Vote Against"); await text("You have voted on this proposal");
  await advance(181); await text("Succeeded"); await button("Queue in Timelock"); await text("Queued");
  assert.equal(await page.getByRole("button", { name: /Timelock Delay Running/ }).isDisabled(), true);
  await advance(61); await button("Execute Proposal on Blockchain"); await text("Executed");
  assert.equal(await invoices.platformFeeBps(), 150n);
  console.log("PASS: create, two weighted votes, duplicate-vote UI, queue, timelock and binding fee execution");
  await member(0); await button("Invoices & collateral");
  await button("Approve and deposit");
  await page.getByText("Your balance: 1000.0 INVX · Deposited collateral: 1000.0 INVX", { exact: true }).waitFor();
  await page.getByLabel("Invoice reference").fill("UI-DEFAULT");
  await button("Create invoice"); await text("#0 · UI-DEFAULT · 0.01 ETH");
  await member(1); await button("Finance for"); await page.getByText(/Awaiting repayment/).waitFor();
  await member(0);
  await advance(86401);
  await button("Create proposal");
  await page.getByLabel("Action", { exact: true }).selectOption("penalty");
  await page.getByLabel("Overdue invoice").selectOption("0");
  await page.getByLabel("Reason", { exact: true }).fill("Supplier default on UI-DEFAULT");
  await button("Submit proposal");
  // Restrict interactions to the newest card while the previous proposal remains visible.
  const penaltyCard = page.getByTestId("proposal-2");
  await penaltyCard.getByRole("button", { name: /Vote For/ }).click();
  await penaltyCard.getByText(/You have voted on this proposal/).waitFor();
  await advance(181);
  await penaltyCard.getByRole("button", { name: /Queue in Timelock/ }).click();
  await penaltyCard.getByText("Queued", { exact: true }).waitFor();
  await advance(61);
  await penaltyCard.getByRole("button", { name: /Execute Proposal on Blockchain/ }).click();
  await penaltyCard.getByText("Executed", { exact: true }).waitFor();
  await page.waitForFunction(() => !document.querySelector('[role="status"]')?.textContent.includes("submitted"));
  for (let i = 0; i < 20 && await staking.stakedBalance(receipt.members[0]) !== hre.ethers.parseEther("700"); i++) await page.waitForTimeout(250);
  assert.equal(await config.invoicePenalized(0), true);
  assert.equal(await staking.stakedBalance(receipt.members[0]), hre.ethers.parseEther("700"));
  await button("Invoices & collateral"); await button("Repay 0.01 ETH");
  for (let i = 0; i < 20 && !await invoices.isRepaid(0); i++) await page.waitForTimeout(250);
  assert.equal(await invoices.isRepaid(0), true);
  console.log("PASS: collateral approval/deposit, invoice zero, financing, overdue penalty and actual repayment");
  await page.evaluate(() => window.ethereum.changeChain("0x1")); await text("Your wallet is on chain 1. This DAO workspace uses chain 31337.");
  await button("Switch to DAO network"); await text("50000.0 DTEST");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: path.join(resultsDir, "dao-mobile.png"), fullPage: true });
  console.log("Mobile overflow:", await page.evaluate(() => [...document.querySelectorAll("body *")].filter(e => e.getBoundingClientRect().right > window.innerWidth + 1).slice(0, 10).map(e => ({ tag: e.tagName, class: e.className, right: e.getBoundingClientRect().right }))));
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), "Mobile layout must fit the viewport");
  await button("Disconnect"); await page.getByRole("button", { name: "Connect MetaMask", exact: true }).waitFor();
  assert.deepEqual(pageErrors, []);
  console.log("PASS: account/network changes, mobile layout, disconnect and zero browser runtime errors");
  assert.equal(await gov.proposalCount(), 2n);
} catch (err) {
  console.error((await page.locator("body").innerText()).slice(-10000));
  console.error("Browser errors:", pageErrors);
  throw err;
} finally { await browser.close(); }
