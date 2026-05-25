const { generateAuthenticationOptions } = require("@simplewebauthn/server");

const { httpError } = require("../utils/errors");
const {
  walletTxNonce,
  internalSigner,
} = require("../services/stellar.service");
const { encodeData } = require("../services/intent.service");
const { rp_id } = require("../../configs/allowed-origins");

async function initSignConnectTransactionService({ user, signRequest }) {
  if (!user) {
    throw httpError(401, "User is required");
  }

  if (!signRequest) {
    throw httpError(400, "Sign request is required");
  }

  const { contractId, network, callFunction, args = [] } = signRequest;

  if (!network || !contractId || !callFunction) {
    throw httpError(400, "request body is incomplete");
  }

  if (!user.passkey?.id) {
    throw httpError(400, "User passkey is missing");
  }

  const callFunctionName =
    typeof callFunction === "string" ? callFunction : callFunction?.name;

  if (!callFunctionName) {
    throw httpError(400, "Invalid callFunction");
  }

  console.log("the signed data", signRequest);

  const { challenge, valid_until_ledger } = await walletTxNonce(
    internalSigner.publicKey(),
    network,
    contractId,
    "get_tx_payload",
    callFunctionName,
    args,
    null
  );

  const options = await generateAuthenticationOptions({
    rpID: rp_id,
    challenge: Buffer.from(challenge, "hex"),
    allowCredentials: [
      {
        id: new Uint8Array(Buffer.from(user.passkey.id, "hex")),
        type: "public-key",
        transports: user.passkey.transports || [],
      },
    ],
  });

  const signInfo = {
    userId: user.userId,
    username: user.username.toLowerCase(),
    valid_until_ledger,
    data: encodeData({
      contractId,
      network,
      callFunction,
    }),
    challenge: options.challenge,
  };

  return {
    options,
    signAccess: true,
    signInfo,
  };
}

module.exports = {
  initSignConnectTransactionService,
};
