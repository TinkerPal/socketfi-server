const baseApi = "https://amm-api.aqua.network/api/external/v1";

async function findSwapPathSoroswap(tokenIn, tokenOut, amountIn) {
  return [tokenIn, tokenOut];
}

module.exports = { findSwapPathSoroswap };
