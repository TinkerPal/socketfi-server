const baseApi = "https://amm-api.aqua.network/api/external/v1";

async function findSwapPathAqua(tokenInAddress, tokenOutAddress, amount) {
  const headers = { "Content-Type": "application/json" };
  const body = JSON.stringify({
    token_in_address: tokenInAddress,
    token_out_address: tokenOutAddress,
    amount: amount.toString(),
  });

  const estimateResponse = await fetch(`${baseApi}/find-path/`, {
    method: "POST",
    body,
    headers,
  });
  const estimateResult = await estimateResponse.json();

  if (!estimateResult.success) {
    throw new Error("Estimate failed");
  }

  return estimateResult;
}

module.exports = { findSwapPathAqua };
