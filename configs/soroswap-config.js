require("dotenv").config({ quiet: true });

const BigNumber = require("bignumber.js");
import { SoroswapSDK, SupportedProtocols, TradeType } from "@soroswap/sdk";

const soroswapClient = new SoroswapSDK({
  apiKey: process.env.SOROSWAP_API_KEY,
});

async function getQuote(tokenIn, tokenOut, amount) {
  const stroops = new BigNumber(amount).multipliedBy(1e7).integerValue();
  const amountIn = BigInt(stroops.toFixed(0));

  const quote = await soroswapClient.quote({
    assetIn: tokenIn,
    assetOut: tokenOut,
    amount: amountIn,
    tradeType: TradeType.EXACT_IN,
    protocols: [SupportedProtocols?.[protocol]],
  });

  return quote;
}

async function findSwapPathSoroswap(tokenIn, tokenOut, amountIn) {
  return [tokenIn, tokenOut];
}

module.exports = { findSwapPathSoroswap, getQuote };
