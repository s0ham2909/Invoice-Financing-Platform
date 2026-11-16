import React from "react";

export default function ProposalCard({
  proposal,
  account,
  guardian,
  blockTimestamp,
  castVote,
  queue,
  execute,
  cancel,
  actionPending,
}) {
  const {
    id,
    proposer,
    proposalTypeLabel,
    description,
    target,
    deadline,
    eta,
    votesFor,
    votesAgainst,
    votesAbstain,
    totalVotes,
    state,
    stateLabel,
    hasVoted,
    userVoterWeight,
    quorumRequired,
  } = proposal;

  const totalVotesNum = Number(totalVotes) || 0;
  const quorumNum = Number(quorumRequired) || 0;
  const quorumProgress = Math.min(100, (totalVotesNum / (quorumNum || 1)) * 100);

  const votesForNum = Number(votesFor) || 0;
  const votesAgainstNum = Number(votesAgainst) || 0;
  const votesAbstainNum = Number(votesAbstain) || 0;
  const nonAbstainTotal = votesForNum + votesAgainstNum;

  const forPct = nonAbstainTotal > 0 ? (votesForNum / nonAbstainTotal) * 100 : 0;
  const againstPct = nonAbstainTotal > 0 ? (votesAgainstNum / nonAbstainTotal) * 100 : 0;

  // Time remaining calculated from blockchain block timestamp
  const votingTimeLeft = Math.max(0, deadline - blockTimestamp);
  const timelockTimeLeft = Math.max(0, eta - blockTimestamp);

  const formatSeconds = (sec) => {
    if (sec <= 0) return "0s";
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return m > 0 ? `${m}m ${s}s` : `${s}s`;
  };

  // State badge styling
  const stateBadgeStyle = {
    0: "bg-yellow-100 text-yellow-800 border-yellow-200", // Pending
    1: "bg-green-100 text-green-800 border-green-200",   // Active
    2: "bg-gray-100 text-gray-700 border-gray-200",     // Defeated
    3: "bg-blue-100 text-blue-800 border-blue-200",     // Succeeded
    4: "bg-purple-100 text-purple-800 border-purple-200", // Queued
    5: "bg-emerald-100 text-emerald-800 border-emerald-200", // Executed
    6: "bg-red-100 text-red-800 border-red-200",         // Cancelled
    7: "bg-rose-100 text-rose-800 border-rose-200",       // Expired
  }[state] || "bg-gray-100 text-gray-800 border-gray-200";

  const isProposer = account && proposer.toLowerCase() === account.toLowerCase();

  return (
    <div data-testid={`proposal-${id}`} className="bg-white rounded-2xl p-6 border border-gray-100 shadow-sm hover:shadow-md transition-shadow space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-gray-100 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-gray-400">#{id}</span>
            <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-indigo-50 text-indigo-700 border border-indigo-100">
              {proposalTypeLabel}
            </span>
            <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold border ${stateBadgeStyle}`}>
              {stateLabel}
            </span>
          </div>
          <h4 className="text-base font-bold text-gray-900 mt-2">{description}</h4><p className="mt-2 text-sm text-indigo-800 break-words">{proposal.action}</p>
          <p className="text-xs text-gray-400 font-mono mt-1">
            Proposer: {proposer.slice(0, 8)}...{proposer.slice(-6)} • Target: {target.slice(0, 8)}...{target.slice(-6)}
          </p>
        </div>

        {/* Live Block Countdown */}
        <div className="text-right">
          {state === 0 && (
            <span className="text-xs font-medium text-yellow-600 bg-yellow-50 px-3 py-1 rounded-lg">
              Snapshot Pending (Mining)
            </span>
          )}
          {state === 1 && (
            <span className="text-xs font-medium text-green-700 bg-green-50 px-3 py-1 rounded-lg">
              ⏱️ Voting ends in {formatSeconds(votingTimeLeft)}
            </span>
          )}
          {state === 4 && (
            <span className="text-xs font-medium text-purple-700 bg-purple-50 px-3 py-1 rounded-lg">
              ⏳ Timelock: {timelockTimeLeft > 0 ? formatSeconds(timelockTimeLeft) : "Ready to Execute!"}
            </span>
          )}
        </div>
      </div>

      {/* Quorum Progress Bar */}
      <div>
        <div className="flex justify-between text-xs text-gray-500 mb-1">
          <span>Quorum Participation: {totalVotesNum.toLocaleString()} / {quorumNum.toLocaleString()} Votes</span>
          <span className="font-semibold">{quorumProgress.toFixed(1)}%</span>
        </div>
        <div className="w-full bg-gray-100 rounded-full h-2 overflow-hidden">
          <div
            className={`h-2 rounded-full transition-all duration-500 ${
              totalVotesNum >= quorumNum ? "bg-green-500" : "bg-indigo-500"
            }`}
            style={{ width: `${quorumProgress}%` }}
          />
        </div>
      </div>

      {/* Vote Breakdown Bars */}
      <div className="space-y-2">
        <div className="flex justify-between text-xs font-medium">
          <span className="text-green-600">👍 For: {votesForNum.toLocaleString()} ({forPct.toFixed(1)}%)</span>
          <span className="text-red-600">👎 Against: {votesAgainstNum.toLocaleString()} ({againstPct.toFixed(1)}%)</span>
          <span className="text-gray-400">⚪ Abstain: {votesAbstainNum.toLocaleString()}</span>
        </div>
        <div className="flex h-3 rounded-full overflow-hidden bg-gray-100">
          <div className="bg-green-500 transition-all duration-500" style={{ width: `${forPct}%` }} />
          <div className="bg-red-500 transition-all duration-500" style={{ width: `${againstPct}%` }} />
        </div>
      </div>

      {/* User Voting Status */}
      {hasVoted && (
        <div className="p-3 bg-indigo-50 rounded-xl text-xs text-indigo-700 flex items-center justify-between">
          <span>✅ You have voted on this proposal</span>
          <span className="font-semibold font-mono">{userVoterWeight} Votes</span>
        </div>
      )}

      {state === 1 && !hasVoted && <p className="text-sm">Your snapshot voting power: {userVoterWeight} DTEST. {proposal.canVote ? "" : "Delegating or receiving tokens now only affects future proposals."}</p>}
      {/* Action Buttons */}
      <div className="pt-2 flex flex-wrap gap-3">
        {state === 1 && !hasVoted && (
          <>
            <button
              onClick={() => castVote(id, 1)}
              disabled={actionPending || (state === 1 && !proposal.canVote)}
              className="flex-1 py-2 px-3 bg-green-600 hover:bg-green-700 text-white rounded-xl text-xs font-semibold shadow-sm transition-all active:scale-98"
            >
              👍 Vote For
            </button>
            <button
              onClick={() => castVote(id, 0)}
              disabled={actionPending || (state === 1 && !proposal.canVote)}
              className="flex-1 py-2 px-3 bg-red-600 hover:bg-red-700 text-white rounded-xl text-xs font-semibold shadow-sm transition-all active:scale-98"
            >
              👎 Vote Against
            </button>
            <button
              onClick={() => castVote(id, 2)}
              disabled={actionPending || (state === 1 && !proposal.canVote)}
              className="py-2 px-3 bg-gray-200 hover:bg-gray-300 text-gray-700 rounded-xl text-xs font-semibold transition-all"
            >
              Abstain
            </button>
          </>
        )}

        {state === 3 && (
          <button
            onClick={() => queue(id)}
            disabled={actionPending || (state === 1 && !proposal.canVote)}
            className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-semibold shadow-sm transition-all"
          >
            ⏱️ Queue in Timelock
          </button>
        )}

        {state === 4 && (
          <button
            onClick={() => execute(id)}
            disabled={actionPending || timelockTimeLeft > 0}
            className={`w-full py-2.5 rounded-xl text-sm font-semibold shadow-sm transition-all ${
              timelockTimeLeft > 0
                ? "bg-gray-200 text-gray-400 cursor-not-allowed"
                : "bg-emerald-600 hover:bg-emerald-700 text-white"
            }`}
          >
            {timelockTimeLeft > 0
              ? `⏳ Timelock Delay Running (${formatSeconds(timelockTimeLeft)})`
              : "⚡ Execute Proposal on Blockchain"}
          </button>
        )}

        {/* Proposer / Guardian Cancel */}
        {((state === 0 || state === 1) && isProposer || (account?.toLowerCase() === guardian?.toLowerCase() && [0,1,2,3,4].includes(state))) && (
          <button
            onClick={() => cancel(id)}
            disabled={actionPending || (state === 1 && !proposal.canVote)}
            className="py-2 px-3 border border-red-200 text-red-600 hover:bg-red-50 rounded-xl text-xs font-medium transition-all"
          >
            Cancel Proposal
          </button>
        )}
      </div>
    </div>
  );
}
