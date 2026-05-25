const { generateAuthenticationOptions } = require("@simplewebauthn/server");

const { pushProgress } = require("../utils/progress");

const {
  walletTxNonce,
  internalSigner,
} = require("../services/stellar.service");

const { encodeData } = require("../services/intent.service");

const { rp_id, sameSiteConfig } = require("../../configs/allowed-origins");
const { contracts } = require("../../soroban/contracts");

const crypto = require("crypto");
const { createWalletChallenge } = require("../../soroban/soroban-methods");

async function initCreateWalletPop(req, res, next) {
  try {
    const {
      credentialIdHex,
      credentialPublicKeyHex,
      transports = [],
      network,
      username,
    } = req.createRequest;

    const nonce = crypto.randomBytes(32);

    const challenge = await createWalletChallenge(nonce, network);

    console.log("the challenge is", challenge);
    const options = await generateAuthenticationOptions({
      rpID: rp_id,
      challenge: Buffer.from(challenge, "hex"),
      userVerification: "required",
      allowCredentials: [
        {
          id: new Uint8Array(Buffer.from(credentialIdHex, "hex")),
          type: "public-key",
          transports,
        },
      ],
    });

    res.cookie(
      "createInfo",
      JSON.stringify({
        challenge: options.challenge,
        createdChallenge: challenge,
        nonce: nonce,
        credentialIdHex,
        username,
        credentialPublicKeyHex,
      }),
      {
        httpOnly: true,
        maxAge: 60000,
        secure: true,
        sameSite: sameSiteConfig,
      }
    );

    return res.json({
      options,
      createPopAccess: true,
      network,
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  initCreateWalletPop,
};
