const { generateAuthenticationOptions } = require("@simplewebauthn/server");

const { pushProgress } = require("../utils/progress");

const {
  walletTxNonce,
  internalSigner,
} = require("../services/stellar.service");

const { encodeData } = require("../services/intent.service");

const { rp_id, sameSiteConfig } = require("../../configs/allowed-origins");

async function initSignTransaction(req, res, next) {
  try {
    const user = req.user;

    const { contractId, network, callFunction, args, sId } = req.signRequest;

    pushProgress(req, {
      step: "transaction authentication",
      status: "start",
      detail: "Retrieving User Details...",
    });

    pushProgress(req, {
      step: "transaction authentication",
      status: "progress",
      detail: "Authenticating User Credentials...",
    });

    const { challenge, valid_until_ledger } = await walletTxNonce(
      internalSigner.publicKey(),
      network,
      contractId,
      "get_tx_payload",
      callFunction?.name,
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
          transports: user.passkey.transports,
        },
      ],
    });

    res.cookie(
      "signInfo",
      JSON.stringify({
        userId: user.userId,
        username: user.username.toLowerCase(),
        valid_until_ledger,

        data: encodeData({
          contractId,
          network,
          callFunction,
        }),

        challenge: options.challenge,
      }),
      {
        httpOnly: true,
        maxAge: 60000,
        secure: true,
        sameSite: sameSiteConfig,
      }
    );

    pushProgress(req, {
      step: "transaction authentication",
      status: "progress",
      detail: "User Authentication Initialized",
    });

    return res.json({
      options,
      signAccess: true,
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  initSignTransaction,
};
