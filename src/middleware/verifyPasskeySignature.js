const { verifyAuthenticationResponse } = require("@simplewebauthn/server");

const { httpError } = require("../utils/errors");
const { pushProgress } = require("../utils/progress");
const { safeJsonParse, assertCredentialMatches } = require("../utils/webauthn");

const {
  base64UrlToUint8Array,
  base64urlToBuffer,
  derSignatureTo64Bytes,
  buildWebAuthnDigest,
} = require("../../services/webauthn.service");

const { expectedOrigin, rp_id } = require("../../configs/allowed-origins");

async function verifyPasskeySignature(req, res, next) {
  try {
    const { sigData, type = null } = req.invoke;
    const user = req.user;

    let signInfoRaw =
      type === "id-mapping" ? req.invoke?.txDetails : req.cookies?.signInfo;

    if (!signInfoRaw) {
      pushProgress(req, {
        step: "transaction creation",
        status: "error",
        detail: "Signature info not found",
      });

      return next(httpError(400, "Signature info not found"));
    }

    const signInfo =
      typeof signInfoRaw === "string"
        ? safeJsonParse(signInfoRaw)
        : signInfoRaw;

    if (!signInfo) {
      return next(httpError(400, "Invalid signature info"));
    }

    const credentialMatches = assertCredentialMatches(
      user,
      sigData,
      base64UrlToUint8Array
    );

    if (!credentialMatches) {
      return next(httpError(400, "Invalid signature data received"));
    }

    const derSig = base64urlToBuffer(sigData?.response?.signature);

    const signature = derSignatureTo64Bytes(derSig, {
      enforceLowS: true,
    });

    const signed = buildWebAuthnDigest(sigData);

    const verification = await verifyAuthenticationResponse({
      response: sigData,
      expectedChallenge: signInfo.challenge,
      expectedOrigin,
      expectedRPID: rp_id,
      requireUserVerification: true,
      authenticator: {
        credentialID: new Uint8Array(Buffer.from(user?.passkey?.id, "hex")),
        credentialPublicKey: new Uint8Array(
          Buffer.from(user?.passkey?.publicKey, "hex")
        ),
        counter: user.passkey.counter,
        transports: user.passkey.transports,
      },
    });

    if (!verification.verified) {
      return next(httpError(400, "Passkey verification failed"));
    }

    req.passkey = {
      signInfo,
      signature,
      signed,
      verification,
    };

    next();
  } catch (error) {
    next(error);
  }
}

module.exports = verifyPasskeySignature;
