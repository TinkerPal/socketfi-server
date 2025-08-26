const { bls12_381 } = require("@noble/curves/bls12-381");
const { Buffer } = require("buffer");
const nodes = require("../signer-nodes/signer-nodes");
const { default: axios } = require("axios");
const { bytesToPoint, pointToBytes } = require("./bls-helper");

async function nodeInitGenKey(BASE_URL, network) {
  const res = await axios.post(
    `${BASE_URL}/generate-bls-keypair/${network.toLowerCase()}`,
    {}
  );

  if (res?.data) {
    console.log("bls generated");
    return res.data;
  }
}

async function nodeCreateFailure(failureCallbackUrl) {
  const res = await axios.delete(`${failureCallbackUrl}`, {});

  if (res?.data) {
    return res.data;
  }
}
async function nodeCreateSuccess(successCallbackUrl, passkey, smartWalletId) {
  const res = await axios.post(`${successCallbackUrl}`, {
    passkey: passkey,
    smart_wallet_id: smartWalletId,
  });

  if (res?.data) {
    return res.data;
  }
}

async function nodeSignPayload(
  BASE_URL,
  network,
  passkey,
  smartWalletId,
  payload
) {
  const res = await axios.post(
    `${BASE_URL}/bls/sign/payload/${network.toLowerCase()}`,
    {
      passkey: passkey,
      smart_wallet_id: smartWalletId,
      payload: payload,
    }
  );

  if (res?.data) {
    return bytesToPoint(Buffer.from(res?.data?.signature, "hex"));
    // return Buffer.from(res?.data?.signature, "hex");
  }
}

// async function signatureAggregator(network, passkey, smartWalletId, payload) {
//   let aggregatedSignature;

//   const sig = await nodeSignPayload(
//     nodes[0].url,
//     network,
//     passkey,
//     smartWalletId,
//     payload
//   );

//   return sig;
// }
async function signatureAggregator(network, passkey, smartWalletId, payload) {
  let aggregatedSignature;

  for (let i = 0; i < nodes.length; i++) {
    const sig = await nodeSignPayload(
      nodes[i].url,
      network,
      passkey,
      smartWalletId,
      payload
    );

    const signG2 = bls12_381.G2.Point.fromAffine(sig);

    if (i === 0) {
      aggregatedSignature = signG2;
    } else {
      aggregatedSignature = aggregatedSignature.add(signG2);
    }
  }

  const finalAggregatedSig = pointToBytes(aggregatedSignature.toAffine());

  return finalAggregatedSig;
}

module.exports = {
  nodeInitGenKey,
  nodeCreateFailure,
  nodeCreateSuccess,
  signatureAggregator,
};

// signatureAggregator(
//   "PUBLIC",
//   "1111",
//   "AAAA",
//   "7f8cbaf9b9f4fd6b69fd4e8d526b9579f8743611c20b13375f5d7119361db309c"
// );
// nodeInitGenKey(nodes[0].url, "PUBLIC");
// nodeCreateFailure(nodes[0].url, 3, "PUBLIC");
// nodeCreateSuccess(nodes[0].url, 3, "PUBLIC", "1111", "AAAA");
