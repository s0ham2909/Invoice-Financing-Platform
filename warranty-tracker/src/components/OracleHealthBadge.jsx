import React, { useState } from "react";
import { useOraclePrice } from "../hooks/useOraclePrice";
import { CHAINLINK_SEPOLIA_FEEDS, PLATFORM_PRICE_ORACLE_ADDRESS } from "../config/oracleConfig";

export default function OracleHealthBadge() {
  const [isOpen, setIsOpen] = useState(false);
  const ethData = useOraclePrice("ETH/USD");
  const btcData = useOraclePrice("BTC/USD");
  const usdcData = useOraclePrice("USDC/USD");

  const feeds = [
    { key: "ETH/USD", label: "ETH / USD", data: ethData },
    { key: "BTC/USD", label: "BTC / USD", data: btcData },
    { key: "USDC/USD", label: "USDC / USD", data: usdcData },
  ];

  const getStatusColor = (status) => {
    switch (status) {
      case "fresh":
        return "bg-emerald-500";
      case "aging":
        return "bg-amber-400";
      case "stale":
        return "bg-rose-500";
      case "unavailable":
      default:
        return "bg-gray-400";
    }
  };

  const getStatusBadge = (status) => {
    switch (status) {
      case "fresh":
        return (
          <span className="px-2 py-0.5 text-[10px] font-bold rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
            Fresh
          </span>
        );
      case "aging":
        return (
          <span className="px-2 py-0.5 text-[10px] font-bold rounded-full bg-amber-50 text-amber-700 border border-amber-200">
            Aging
          </span>
        );
      case "stale":
        return (
          <span className="px-2 py-0.5 text-[10px] font-bold rounded-full bg-rose-50 text-rose-700 border border-rose-200">
            Stale
          </span>
        );
      default:
        return (
          <span className="px-2 py-0.5 text-[10px] font-bold rounded-full bg-gray-100 text-gray-600 border border-gray-200">
            Unavailable
          </span>
        );
    }
  };

  const formatAge = (age) => {
    if (age === null || age === undefined) return "N/A";
    if (age < 60) return `${age}s ago`;
    if (age < 3600) return `${Math.floor(age / 60)}m ago`;
    return `${(age / 3600).toFixed(1)}h ago`;
  };

  const isOracleLive =
    PLATFORM_PRICE_ORACLE_ADDRESS &&
    PLATFORM_PRICE_ORACLE_ADDRESS !== "0x0000000000000000000000000000000000000000";

  return (
    <div className="relative inline-block text-left">
      {/* ── Badge Button ── */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-3 py-1.5 rounded-xl border border-gray-200 bg-white hover:bg-gray-50 shadow-xs transition-all text-xs font-semibold cursor-pointer"
        title="Chainlink Decentralized Oracle Health"
      >
        <span className={`w-2 h-2 rounded-full ${getStatusColor(ethData.status)} animate-pulse`} />
        <span className="text-gray-700">ETH/USD:</span>
        <span className="font-mono font-bold text-gray-900">
          {ethData.price ? `$${parseFloat(ethData.price).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "Price Unavailable"}
        </span>
        {ethData.ageSeconds !== null && (
          <span className="text-[10px] text-gray-600 font-normal">
            ({formatAge(ethData.ageSeconds)})
          </span>
        )}
        <span className="text-gray-600 text-[10px] ml-0.5">▼</span>
      </button>

      {/* ── Oracle Health Popover ── */}
      {isOpen && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setIsOpen(false)}
          />
          <div className="absolute right-0 mt-2 w-80 bg-white rounded-2xl shadow-xl border border-gray-200 p-4 z-50 animate-in fade-in zoom-in-95 duration-100">
            <div className="flex items-center justify-between pb-3 border-b border-gray-100">
              <div className="flex items-center gap-2">
                <span className="text-base">🔮</span>
                <span className="text-xs font-bold text-gray-800 uppercase tracking-wider">
                  Chainlink Oracle Health
                </span>
              </div>
              <span className="text-[10px] px-2 py-0.5 rounded-md font-mono bg-indigo-50 text-indigo-700 border border-indigo-200">
                Sepolia
              </span>
            </div>

            <div className="text-[11px] text-gray-500 mt-2 mb-3">
              Source:{" "}
              {isOracleLive ? (
                <span className="font-semibold text-indigo-600">
                  PlatformPriceOracle ({PLATFORM_PRICE_ORACLE_ADDRESS.slice(0, 6)}...{PLATFORM_PRICE_ORACLE_ADDRESS.slice(-4)})
                </span>
              ) : (
                <span className="font-semibold text-emerald-600">
                  Direct Chainlink Aggregator Feeds
                </span>
              )}
            </div>

            <div className="space-y-2.5">
              {feeds.map((feed) => {
                const config = CHAINLINK_SEPOLIA_FEEDS[feed.key];
                const age = feed.data.ageSeconds;
                const price = feed.data.price;

                return (
                  <div
                    key={feed.key}
                    className="p-2.5 rounded-xl border border-gray-100 bg-gray-50/70 hover:bg-gray-50 transition-colors"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-gray-800">
                        {feed.label}
                      </span>
                      {getStatusBadge(feed.data.status)}
                    </div>

                    <div className="mt-1.5 flex items-baseline justify-between">
                      <span className="font-mono text-sm font-bold text-gray-900">
                        {price
                          ? `$${parseFloat(price).toLocaleString(undefined, {
                              minimumFractionDigits: feed.key === "USDC/USD" ? 4 : 2,
                              maximumFractionDigits: feed.key === "USDC/USD" ? 4 : 2,
                            })}`
                          : "Unavailable"}
                      </span>
                      <span className="text-[10px] text-gray-500 font-mono">
                        {formatAge(age)}
                      </span>
                    </div>

                    <div className="mt-1 flex items-center justify-between text-[10px] text-gray-400">
                      <span>Heartbeat: {config.heartbeat < 3600 ? `${config.heartbeat}s` : `${config.heartbeat / 3600}h`}</span>
                      <span>MaxAge: {config.maxAge < 3600 ? `${config.maxAge}s` : `${(config.maxAge / 3600).toFixed(1)}h`}</span>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="mt-3 pt-2.5 border-t border-gray-100 flex items-center justify-between text-[10px] text-gray-400">
              <span>Auto-refresh: 30s</span>
              <button
                onClick={() => {
                  ethData.refetch();
                  btcData.refetch();
                  usdcData.refetch();
                }}
                className="text-indigo-600 hover:text-indigo-700 font-bold hover:underline cursor-pointer"
              >
                ↻ Refresh Now
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
