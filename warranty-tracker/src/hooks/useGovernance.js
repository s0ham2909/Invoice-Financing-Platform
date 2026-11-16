import { useState, useEffect, useMemo, useCallback } from "react";
import { ethers } from "ethers";
import { useWallet } from "../context/WalletContext";
import { GOVERNANCE_DEPLOYMENT as addresses, GOVERNANCE_CHAIN_ID, DTEST_ABI, GOVERNANCE_ABI, PLATFORM_CONFIG_ABI, PROPOSAL_TYPES, PROPOSAL_STATES } from "../config/governanceConfig";
import invoiceAbi from "../config/governanceInvoiceAbi.json";
import stakingAbi from "../config/governanceStakingAbi.json";
import invxAbi from "../config/governanceInvxAbi.json";

export function governanceError(err) {
  if (err.code === 4001 || err.code === "ACTION_REJECTED") return "Transaction rejected in your wallet.";
  const interfaces = [GOVERNANCE_ABI, PLATFORM_CONFIG_ABI, invoiceAbi, stakingAbi, DTEST_ABI].map(abi => new ethers.Interface(abi));
  let data = err.data || err.info?.error?.data;
  if (typeof data === "object") data = data?.data;
  for (let depth = 0; depth < 2 && typeof data === "string"; depth++) {
    for (const iface of interfaces) {
      try {
        const parsed = iface.parseError(data);
        if (parsed?.name === "ExecutionFailed") { data = parsed.args[0]; break; }
        if (parsed) return `${parsed.name}: ${parsed.args.map(String).join(", ")}`;
      } catch { /* Try the next contract ABI. */ }
    }
  }
  return err.reason || err.shortMessage || err.message || "Transaction failed";
}

export function useGovernance() {
  const { account, signer, chainId } = useWallet();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [actionError, setActionError] = useState("");
  const [actionPending, setActionPending] = useState(false);
  const [revision, setRevision] = useState(0);
  const contracts = useMemo(() => {
    if (!signer || chainId !== GOVERNANCE_CHAIN_ID || addresses.Governance === ethers.ZeroAddress) return null;
    return Object.fromEntries([["gov", "Governance", GOVERNANCE_ABI], ["token", "DTEST", DTEST_ABI],
      ["config", "PlatformConfig", PLATFORM_CONFIG_ABI], ["invoices", "InvoiceNFT", invoiceAbi],
      ["staking", "ReserveStaking", stakingAbi], ["invx", "INVX", invxAbi]]
      .map(([key, name, abi]) => [key, new ethers.Contract(addresses[name], abi, signer)]));
  }, [signer, chainId]);
  useEffect(() => {
    let cancelled = false;
    let busy = false;
    async function refresh() {
      if (busy || !contracts) return;
      busy = true;
      try {
        const provider = signer.provider;
        const block = await provider.getBlock("latest");
        const opts = { blockTag: block.number };
        const code = await Promise.all(Object.values(contracts).map(c => provider.getCode(c.target, block.number)));
        if (code.some(c => c === "0x")) throw new Error("DAO contracts are missing. Run the deployment command for this network; a local node restart clears contracts.");
        const { gov, token, config, invoices, staking, invx } = contracts;
        const [rawParams, count, balance, power, delegatee, fee, stake, invxBalance, guardian, totalSupply, tokenAddress, configOwner, invoiceOwner] = await Promise.all([
          gov.params(opts), gov.proposalCount(opts), token.balanceOf(account, opts), token.getVotes(account, opts), token.delegates(account, opts),
          invoices.platformFeeBps(opts), staking.stakedBalance(account, opts), invx.balanceOf(account, opts), gov.owner(opts), token.totalSupply(opts),
          gov.token(opts), config.owner(opts), invoices.owner(opts),
        ]);
        if (tokenAddress !== token.target || configOwner !== gov.target || invoiceOwner !== config.target) throw new Error("DAO deployment wiring does not match. Redeploy this workspace.");
        const proposals = await Promise.all(Array.from({ length: Number(count) }, (_, j) => Number(count) - j).map(async id => {
          const [p, state, rules, hasVoted] = await Promise.all([gov.getProposal(id, opts), gov.state(id, opts), gov.proposalParams(id, opts), gov.hasVoted(id, account, opts)]);
          const [powerAtSnapshot, supply] = await Promise.all([token.getPastVotes(account, p.snapshotBlock, opts), token.getPastTotalSupply(p.snapshotBlock, opts)]);
          const fmt = ethers.formatEther;
          let action;
          try {
            const decoded = config.interface.parseTransaction({ data: p.data });
            action = decoded.name === "setPlatformFeeBps" ? `Set fee to ${Number(decoded.args[0]) / 100}%`
              : `Invoice #${decoded.args[0]}: deduct ${fmt(decoded.args[2])} INVX from ${decoded.args[1]}. Reason: ${decoded.args[3]}`;
          } catch { action = "Unrecognized action"; }
          return { id, proposer: p.proposer, target: p.target, description: p.description, action,
            proposalTypeLabel: PROPOSAL_TYPES[Number(p.proposalType)], deadline: Number(p.deadline), eta: Number(p.eta),
            votesFor: fmt(p.votesFor), votesAgainst: fmt(p.votesAgainst), votesAbstain: fmt(p.votesAbstain),
            totalVotes: fmt(p.votesFor + p.votesAgainst + p.votesAbstain), state: Number(state), stateLabel: PROPOSAL_STATES[Number(state)],
            hasVoted, userVoterWeight: fmt(powerAtSnapshot), canVote: powerAtSnapshot > 0n,
            quorumRequired: fmt(supply * rules.quorumBps / 10000n) };
        }));
        const invoiceCount = Number(await invoices.totalMinted(opts));
        const rows = await Promise.all(Array.from({ length: invoiceCount }, (_, id) => id).map(async id => {
          const [inv, repaid, cost, penalized] = await Promise.all([invoices.getInvoice(id, opts), invoices.isRepaid(id, opts), invoices.financingCost(id, opts), config.invoicePenalized(id, opts)]);
          return { id, number: inv.invoiceNumber, borrower: inv.borrower, investor: inv.investor, amount: inv.amount,
            dueDate: Number(inv.dueDate), financed: inv.isFinanced, repaid, cost, penalized };
        }));
        if (!cancelled) {
          setData({ account, chainId: addresses.chainId, proposals, invoices: rows, tokenBalance: ethers.formatEther(balance), votingPower: ethers.formatEther(power), delegatee,
            blockTimestamp: block.timestamp, fee: Number(fee), stake: ethers.formatEther(stake), invxBalance: ethers.formatEther(invxBalance),
            proposalThreshold: ethers.formatEther(rawParams.proposalThreshold), timelockDelay: Number(rawParams.timelockDelay),
            quorum: ethers.formatEther(totalSupply * rawParams.quorumBps / 10000n), guardian });
          setError("");
        }
      } catch (err) { if (!cancelled) setError(governanceError(err)); }
      finally { busy = false; }
    }
    void refresh();
    const timer = setInterval(refresh, 4000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [contracts, signer, account, revision]);
  const run = useCallback(async (contract, method, args = []) => {
    setActionPending(true); setActionError(""); setStatus("Confirm the transaction in your wallet...");
    try {
      if (!contracts || !contract || error) throw new Error(error || "Connect to the DAO network first.");
      if (Number((await signer.provider.getNetwork()).chainId) !== GOVERNANCE_CHAIN_ID) throw new Error("Wrong network");
      await contract[method].staticCall(...args);
      const tx = await contract[method](...args);
      setStatus(`Transaction submitted: ${tx.hash}`);
      await tx.wait();
      setStatus(`Confirmed: ${tx.hash}`);
      setRevision(r => r + 1);
      return true;
    } catch (err) { setActionError(governanceError(err)); setStatus(""); return false; }
    finally { setActionPending(false); }
  }, [contracts, error, signer]);
  return { account, chainId, contracts, data: contracts && data?.account === account && data?.chainId === chainId ? data : null, error, actionError, status, actionPending, run,
    refetch: () => setRevision(r => r + 1) };
}
