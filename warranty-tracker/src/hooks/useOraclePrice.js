import { useState, useEffect, useCallback, useRef } from "react";
import { ethers } from "ethers";
import {
  PLATFORM_PRICE_ORACLE_ADDRESS,
  PLATFORM_PRICE_ORACLE_ABI,
  CHAINLINK_SEPOLIA_FEEDS,
  AGGREGATOR_V3_ABI,
} from "../config/oracleConfig";

const DEFAULT_RPC = "https://ethereum-sepolia-rpc.publicnode.com";

/**
 * Custom React hook to read Chainlink prices from either:
 * 1) PlatformPriceOracle contract if deployed on Sepolia, OR
 * 2) Direct Chainlink AggregatorV3Interface feeds as fallback.
 *
 * Runs without requiring a connected wallet via read-only JsonRpcProvider,
 * cached for ~30 seconds.
 */
export function useOraclePrice(symbol = "ETH/USD") {
  const [data, setData] = useState({
    symbol,
    price: null,             // numeric / formatted price string (e.g. "2238.50")
    rawPrice: null,          // BigInt raw answer
    price18: null,           // BigInt price normalised to 18 decimals
    decimals: 8,
    updatedAt: null,         // timestamp (seconds)
    ageSeconds: null,        // age relative to local clock (seconds)
    status: "loading",       // "fresh", "aging", "stale", "unavailable", "loading"
    isHealthy: false,
    error: null,
    source: "init",          // "oracle" or "direct_feed"
  });

  const lastFetchRef = useRef(0);

  const fetchPrice = useCallback(async () => {
    // Avoid slamming RPC if called too frequently (< 15 seconds)
    const nowMs = Date.now();
    if (nowMs - lastFetchRef.current < 15000 && data.price !== null) {
      return;
    }
    lastFetchRef.current = nowMs;

    try {
      const rpcUrl = import.meta.env.VITE_SEPOLIA_RPC_URL || DEFAULT_RPC;
      const provider = new ethers.JsonRpcProvider(rpcUrl);

      const isOracleDeployed =
        PLATFORM_PRICE_ORACLE_ADDRESS &&
        PLATFORM_PRICE_ORACLE_ADDRESS !== ethers.ZeroAddress &&
        PLATFORM_PRICE_ORACLE_ADDRESS !== "0x0000000000000000000000000000000000000000";

      let rawAnswer = null;
      let updatedAtSec = null;
      let feedDecimals = 8;
      let maxAge = 4500;
      let sourceUsed = "direct_feed";

      if (isOracleDeployed) {
        try {
          const oracle = new ethers.Contract(
            PLATFORM_PRICE_ORACLE_ADDRESS,
            PLATFORM_PRICE_ORACLE_ABI,
            provider
          );

          const healthy = await oracle.isHealthy(symbol);
          if (healthy) {
            rawAnswer = await oracle.safePrice(symbol);
            const p18 = await oracle.safePrice18(symbol);
            const feedConfig = await oracle.feeds(symbol);
            feedDecimals = Number(feedConfig.decimals);
            maxAge = Number(feedConfig.maxAge);
            sourceUsed = "oracle";

            // Also read feed's latestRoundData for exact timestamp
            const feedContract = new ethers.Contract(feedConfig.feed, AGGREGATOR_V3_ABI, provider);
            const roundData = await feedContract.latestRoundData();
            updatedAtSec = Number(roundData.updatedAt);

            const nowSec = Math.floor(Date.now() / 1000);
            const age = Math.max(0, nowSec - updatedAtSec);

            // Compute freshness
            let healthStatus = "fresh";
            if (age > maxAge) {
              healthStatus = "stale";
            } else if (age > maxAge * 0.75) {
              healthStatus = "aging";
            }

            setData({
              symbol,
              price: ethers.formatUnits(rawAnswer, feedDecimals),
              rawPrice: rawAnswer,
              price18: p18,
              decimals: feedDecimals,
              updatedAt: updatedAtSec,
              ageSeconds: age,
              status: healthStatus,
              isHealthy: healthStatus !== "stale",
              error: null,
              source: sourceUsed,
            });
            return;
          }
        } catch (e) {
          console.warn(`Oracle read failed for ${symbol}, trying fallback:`, e.message);
        }
      }

      // Fallback: Direct Chainlink Feed
      const feedMeta = CHAINLINK_SEPOLIA_FEEDS[symbol];
      if (!feedMeta) {
        throw new Error(`Feed not supported for symbol: ${symbol}`);
      }

      const feed = new ethers.Contract(feedMeta.address, AGGREGATOR_V3_ABI, provider);
      feedDecimals = Number(await feed.decimals());
      const [, answer, , updatedAt] = await feed.latestRoundData();

      rawAnswer = answer;
      updatedAtSec = Number(updatedAt);
      maxAge = feedMeta.maxAge;

      const nowSec = Math.floor(Date.now() / 1000);
      const age = Math.max(0, nowSec - updatedAtSec);

      // Perform the 3 SafePriceConsumer checks
      const isPositive = rawAnswer > 0n;
      const hasUpdated = updatedAtSec !== 0;
      const isFresh = age <= maxAge;

      let healthStatus = "fresh";
      if (!isPositive || !hasUpdated) {
        healthStatus = "unavailable";
      } else if (!isFresh) {
        healthStatus = "stale";
      } else if (age > maxAge * 0.75) {
        healthStatus = "aging";
      }

      // Normalise to 18 decimals
      let p18 = null;
      if (isPositive) {
        if (feedDecimals === 18) {
          p18 = rawAnswer;
        } else if (feedDecimals < 18) {
          p18 = rawAnswer * (10n ** BigInt(18 - feedDecimals));
        } else {
          p18 = rawAnswer / (10n ** BigInt(feedDecimals - 18));
        }
      }

      setData({
        symbol,
        price: isPositive ? ethers.formatUnits(rawAnswer, feedDecimals) : null,
        rawPrice: rawAnswer,
        price18: p18,
        decimals: feedDecimals,
        updatedAt: updatedAtSec,
        ageSeconds: age,
        status: healthStatus,
        isHealthy: isPositive && hasUpdated && isFresh,
        error: isPositive ? null : "Invalid price received",
        source: "direct_feed",
      });
    } catch (err) {
      setData((prev) => ({
        ...prev,
        status: "unavailable",
        isHealthy: false,
        error: err.message,
      }));
    }
  }, [symbol]);

  // Initial fetch and 30-second interval polling
  useEffect(() => {
    fetchPrice();
    const interval = setInterval(() => {
      fetchPrice();
    }, 30000);
    return () => clearInterval(interval);
  }, [fetchPrice]);

  // Expose usdToEth and ethToUsd calculation helpers
  const ethToUsd = useCallback(
    (weiAmount) => {
      if (!data.price18 || !data.isHealthy) return null;
      try {
        const wei = typeof weiAmount === "bigint" ? weiAmount : ethers.parseEther(weiAmount.toString());
        const usd18 = (wei * data.price18) / 10n ** 18n;
        return ethers.formatUnits(usd18, 18);
      } catch {
        return null;
      }
    },
    [data.price18, data.isHealthy]
  );

  const usdToEth = useCallback(
    (usdAmount) => {
      if (!data.price18 || !data.isHealthy || data.price18 === 0n) return null;
      try {
        const usd18 = ethers.parseUnits(usdAmount.toString(), 18);
        const wei = (usd18 * 10n ** 18n) / data.price18;
        return ethers.formatEther(wei);
      } catch {
        return null;
      }
    },
    [data.price18, data.isHealthy]
  );

  return {
    ...data,
    refetch: fetchPrice,
    ethToUsd,
    usdToEth,
  };
}
