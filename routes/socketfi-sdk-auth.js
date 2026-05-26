const express = require("express");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const {
  isAllowedOrigin,
  sameSiteConfig,
  rp_id,
  expectedOrigin,
} = require("../configs/allowed-origins");
const {
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
  generateRegistrationOptions,
  verifyRegistrationResponse,
} = require("@simplewebauthn/server");
const { UserAccount } = require("../models/models");
const { createAuthCode, consumeAuthCode } = require("../lib/auth-code-store");
const nodes = require("../signer-nodes/signer-nodes");
const {
  createContract,
  createUser,
  getUserByUsername,
} = require("../helper-functions");
const {
  nodeInitGenKey,
  nodeCreateFailure,
  nodeCreateSuccess,
} = require("../bls-nodes/bls-node-methods");

const router = express.Router();

const TEMP_ACCESS_SECRET = process.env.TEMP_ACCESS_SECRET;

if (!TEMP_ACCESS_SECRET && process.env.NODE_ENV === "production") {
  throw new Error("TEMP_ACCESS_SECRET is required in production");
}

const TEMP_ACCESS_ISSUER = "socketfi-api";
const TEMP_ACCESS_AUDIENCE = "socketfi-hosted-auth";
const VALID_MODES = new Set(["signin", "signup"]);
const VALID_NETWORKS = new Set(["PUBLIC", "TESTNET"]);

function generateTempAccess(payload) {
  return jwt.sign(payload, TEMP_ACCESS_SECRET || "dev-temp-access-secret", {
    expiresIn: "90s",
    issuer: TEMP_ACCESS_ISSUER,
    audience: TEMP_ACCESS_AUDIENCE,
    jwtid: crypto.randomUUID(),
  });
}

function validateTempAccess(token) {
  if (!token || typeof token !== "string") {
    throw new Error("Temp access token is required");
  }

  const decoded = jwt.verify(
    token,
    TEMP_ACCESS_SECRET || "dev-temp-access-secret",
    {
      issuer: TEMP_ACCESS_ISSUER,
      audience: TEMP_ACCESS_AUDIENCE,
    }
  );

  if (decoded.type !== "socketfi_hosted_auth") {
    throw new Error("Invalid temp access type");
  }

  if (!decoded.clientId || typeof decoded.clientId !== "string") {
    throw new Error("Invalid clientId");
  }

  if (!decoded.origin || typeof decoded.origin !== "string") {
    throw new Error("Invalid origin");
  }

  if (!isAllowedOrigin(decoded.origin)) {
    throw new Error("Origin not allowed");
  }

  if (!VALID_MODES.has(decoded.mode)) {
    throw new Error("Invalid auth mode");
  }

  if (!VALID_NETWORKS.has(decoded.network)) {
    throw new Error("Invalid network");
  }

  return decoded;
}

function tempAccessMiddleware(req, res, next) {
  try {
    const token =
      req.body.tempAccess ||
      req.query.tempAccess ||
      req.headers["x-temp-access"];

    const decoded = validateTempAccess(token);

    req.tempAccess = decoded;

    next();
  } catch (error) {
    return res.status(401).json({
      error: "Invalid or expired authentication session",
    });
  }
}

router.post("/get-temp-access", async (req, res) => {
  try {
    const { clientId, origin, network = "PUBLIC", mode } = req.body;

    if (!clientId || !origin || !mode) {
      return res.status(400).json({
        error: "clientId, origin and mode are required",
      });
    }

    if (!VALID_MODES.has(mode)) {
      return res.status(400).json({
        error: "mode must be signin or signup",
      });
    }

    if (!VALID_NETWORKS.has(network)) {
      return res.status(400).json({
        error: "network must be PUBLIC or TESTNET",
      });
    }

    if (!isAllowedOrigin(origin)) {
      return res.status(403).json({
        error: "Origin not allowed",
      });
    }

    const tempAccess = generateTempAccess({
      type: "socketfi_hosted_auth",
      clientId,
      origin,
      network,
      mode,
    });

    return res.json({ tempAccess });
  } catch (error) {
    console.error("[oauth/get-temp-access]", error);
    return res.status(500).json({
      error: "Failed to generate temp access",
    });
  }
});

router.post("/init-auth", tempAccessMiddleware, async (req, res) => {
  try {
    const { clientId, origin, network, mode } = req.tempAccess;
    const { username } = req.body;
    const VALID_MODES = ["signin", "signup"];

    if (!VALID_MODES.includes(mode)) {
      return res.status(400).json({
        error: "Invalid mode value",
      });
    }

    if (mode === "signin") {
      const options = await generateAuthenticationOptions({
        rpID: rp_id,
        userVerification: "required",
      });

      res.cookie(
        "authInfo",
        JSON.stringify({
          challenge: options.challenge,
          network,
          usernameLess: true,
          rpID: rp_id,
        }),
        {
          httpOnly: true,
          maxAge: 120000,
          secure: true,
          sameSite: sameSiteConfig,
        }
      );

      return res.json({
        options,
        usernameLess: true,
      });
    }

    if (mode === "signup") {
      const cleanUsername = username?.toLowerCase() || null;

      const userIdBytes = crypto.randomBytes(16);
      const userId = userIdBytes.toString("base64url");
      const publicId = `socketfi-${crypto.randomBytes(8).toString("hex")}`;
      const displayName = cleanUsername || publicId;

      const options = await generateRegistrationOptions({
        rpID: rp_id,
        rpName: "SocketFi",

        userID: userId,
        userName: displayName,
        userDisplayName: displayName,

        authenticatorSelection: {
          residentKey: "required",
          userVerification: "required",
        },
      });

      console.log("fine here 3");

      res.cookie(
        "authInfo",
        JSON.stringify({
          challenge: options.challenge,
          userId,
          publicId,
          username: displayName,
          network,
          registration: true,
          rpID: rp_id,
        }),
        {
          httpOnly: true,
          maxAge: 120000,
          secure: true,
          sameSite: sameSiteConfig,
        }
      );

      return res.json({
        options,
        registration: true,
        id: userId,
        publicId,
      });
    }

    return res.status(400).json({
      error: "Invalid auth mode",
    });
  } catch (error) {
    console.error("[oauth/init-auth]", error);
    return res.status(500).json({
      error: "Failed to initialize authentication",
    });
  }
});

router.post("/verify-auth", tempAccessMiddleware, async (req, res) => {
  try {
    const { clientId, origin, network, mode } = req.tempAccess;
    const { authData } = req.body;

    const authInfo = JSON.parse(req?.cookies?.authInfo || "{}");

    if (!authInfo?.challenge) {
      return res.status(400).json({ error: "Auth info not found" });
    }

    const clientData = JSON.parse(
      Buffer.from(authData.response.clientDataJSON, "base64url").toString(
        "utf8"
      )
    );

    const responseType = clientData.type;

    if (responseType === "webauthn.get") {
      const credentialIdHex = Buffer.from(authData.id, "base64url").toString(
        "hex"
      );

      if (mode === "signin") {
        const user = await UserAccount.getUserByPasskeyId(credentialIdHex);

        if (!user) {
          return res.status(404).json({
            verified: false,
            error: "No account found for this passkey",
          });
        }

        const verification = await verifyAuthenticationResponse({
          response: authData,
          expectedChallenge: authInfo.challenge,
          expectedOrigin,
          expectedRPID: rp_id,
          requireUserVerification: true,
          authenticator: {
            credentialID: new Uint8Array(Buffer.from(user.passkey.id, "hex")),
            credentialPublicKey: new Uint8Array(
              Buffer.from(user.passkey.publicKey, "hex")
            ),
            counter: user.passkey.counter,
            transports: user.passkey.transports,
          },
        });

        if (!verification.verified) {
          return res.status(400).json({
            verified: false,
            error: "Login verification failed",
          });
        }

        user.passkey.counter = verification.authenticationInfo.newCounter;
        await user.save();
        const clientUser = {
          username: user.username,
          linkedAccounts: user.linkedAccounts,
          userId: user.userId,
          passkey: user.passkey.publicKey,
          address: user.address,
          email: user.email || null,
          twitter: user.twitter || null,
          discord: user.discord || null,
          telegram: user.telegram || null,
        };

        const code = await createAuthCode({
          clientId,
          origin,
          network,
          mode,
          userProfile: clientUser,
        });

        const returnTo = origin;
        const safeReturnTo = new URL(returnTo);

        if (safeReturnTo.origin !== origin) {
          return res.status(400).json({
            error: "Invalid returnTo origin",
          });
        }

        safeReturnTo.searchParams.set("socketfi_auth", "success");
        safeReturnTo.searchParams.set("code", code);

        return res.json({
          verified: true,
          redirectTo: safeReturnTo.toString(),
        });
      }
    }

    if (responseType !== "webauthn.create") {
      return res.status(400).json({
        verified: false,
        error: "Unsupported WebAuthn response type",
      });
    }

    const verification = await verifyRegistrationResponse({
      response: authData,
      expectedChallenge: authInfo.challenge,
      expectedOrigin,
      expectedRPID: rp_id,
      requireUserVerification: true,
    });

    if (!verification.verified) {
      return res.status(400).json({
        verified: false,
        error: "Registration verification failed",
      });
    }

    const blsKeysData = [];
    const resultingPk = verification.registrationInfo.credentialPublicKey;
    const passkeyBuffer = Buffer.from(resultingPk);

    for (let i = 0; i < nodes.length; i++) {
      const blsKey = await nodeInitGenKey(nodes[i].url, network);
      blsKeysData.push(blsKey);
    }

    if (nodes.length !== blsKeysData.length) {
      return res.status(400).json({
        error: `Incomplete BLS Keys initialization, ${blsKeysData.length} of ${nodes.length}`,
      });
    }

    const blsBuffers = blsKeysData.map((blsKeypair) =>
      Buffer.from(blsKeypair.publicKey, "hex")
    );

    const args = [
      { value: passkeyBuffer, type: "scSpecTypeBytes" },
      { value: blsBuffers, type: "scSpecTypeBytes" },
    ];

    const smartWalletAddress = await createContract(network, args);

    if (!smartWalletAddress) {
      return res.status(400).json({
        error:
          "An error occurred while creating smart wallet contract, try again later.",
      });
    }

    const credentialIdHex = Buffer.from(
      verification.registrationInfo.credentialID
    ).toString("hex");

    const username = authInfo.username || authInfo.publicId;

    await createUser(
      username,
      authInfo.userId,
      {
        id: credentialIdHex,
        publicKey: Buffer.from(
          verification.registrationInfo.credentialPublicKey
        ).toString("hex"),
        counter: verification.registrationInfo.counter,
        deviceType: verification.registrationInfo.credentialDeviceType,
        backedUp: verification.registrationInfo.credentialBackedUp,
        transports:
          authData?.response?.transports || authData?.transports || [],
      },
      smartWalletAddress,
      network
    );

    console.log("the contract is", smartWalletAddress);

    const user = await getUserByUsername(username);

    for (let i = 0; i < blsKeysData.length; i++) {
      try {
        if (user) {
          await nodeCreateSuccess(
            blsKeysData[i].successCallback,
            user.passkey.publicKey,
            user.address[network]
          );
        } else {
          await nodeCreateFailure(blsKeysData[i].failureCallback);
        }
      } catch (nodeError) {
        console.error("BLS NODE CALLBACK ERROR:", nodeError.message);
      }
    }

    const clientUser = {
      username: user.username,
      linkedAccounts: user.linkedAccounts,
      userId: user.userId,
      passkey: user.passkey.publicKey,
      address: user.address,
      email: user.email || null,
      twitter: user.twitter || null,
      discord: user.discord || null,
      telegram: user.telegram || null,
    };

    const code = await createAuthCode({
      clientId,
      origin,
      network,
      mode,
      userProfile: clientUser,
    });

    const returnTo = origin;
    const safeReturnTo = new URL(returnTo);

    if (safeReturnTo.origin !== origin) {
      return res.status(400).json({
        error: "Invalid returnTo origin",
      });
    }

    safeReturnTo.searchParams.set("socketfi_auth", "success");
    safeReturnTo.searchParams.set("code", code);

    return res.json({
      verified: true,
      redirectTo: safeReturnTo.toString(),
    });
  } catch (error) {
    console.error("[oauth/verify-auth]", error);
    return res.status(500).json({
      error: "Failed to verify authentication",
    });
  }
});

router.post("/authorize", tempAccessMiddleware, async (req, res) => {
  try {
    const { clientId, origin, network, mode } = req.tempAccess;
    const { authData, challengeId } = req.body;

    if (!authData || !challengeId) {
      return res.status(400).json({
        error: "authData and challengeId are required",
      });
    }

    if (mode === "signin") {
      const session = await verifyPasskeyLogin({
        clientId,
        origin,
        network,
        challengeId,
        authData,
      });

      return res.json({
        success: true,
        mode,
        session,
      });
    }

    if (mode === "signup") {
      const session = await verifyPasskeySignup({
        clientId,
        origin,
        network,
        challengeId,
        authData,
      });

      return res.json({
        success: true,
        mode,
        session,
      });
    }

    return res.status(400).json({
      error: "Invalid auth mode",
    });
  } catch (error) {
    console.error("[oauth/authorize]", error);
    return res.status(401).json({
      error: "Authentication failed",
    });
  }
});

router.post("/success", async (req, res) => {
  try {
    const { code, clientId, origin } = req.body;

    if (!code || !clientId || !origin) {
      return res.status(400).json({
        error: "code, clientId and origin are required",
      });
    }

    const record = await consumeAuthCode({
      code,
      clientId,
      origin,
    });

    const { passkey, userId, ...rest } = record.session || record.userProfile;

    // const credentialIdHex = Buffer.from(passkey, "base64url").toString("hex");
    const user = await UserAccount.findOne({
      userId,
    });

    const accessToken = await user.generateSDkAuthToken({ origin, clientId });

    const session = { socketfiAccessToken: accessToken, userProfile: rest };

    return res.json({
      session: session,
    });
  } catch (error) {
    console.error("[oauth/success]", error);

    return res.status(401).json({
      error: error.message || "Invalid or expired authorization code",
    });
  }
});

router.post("/init-transaction", tempAccessMiddleware, async (req, res) => {
  try {
    const { clientId, origin, network, mode } = req.tempAccess;
    const { contractId, callFunction, sId = "" } = req.body;

    if (!network || !contractId || !callFunction) {
      return res.status(400).json({
        error: "network, contractId and callFunction are required",
      });
    }

    const authHeader = req.headers.authorization;

    if (!authHeader?.startsWith("Bearer ")) {
      return res.status(401).json({
        error: "Authorization header is missing",
      });
    }

    const accessToken = authHeader.split(" ")[1];
    const accessVerification = authenticateToken(accessToken);

    const user = await getUserByUsername(accessVerification.username);

    if (!user) {
      return res.status(400).json({
        error: "No user found or user not authorized",
      });
    }

    const options = await generateAuthenticationOptions({
      rpID: rp_id,
      userVerification: "required",
      allowCredentials: [
        {
          id: new Uint8Array(Buffer.from(user.passkey.id, "hex")),
          type: "public-key",
          transports: user.passkey.transports,
        },
      ],
    });

    res.cookie(
      "sdkSignInfo",
      JSON.stringify({
        userId: user.userId,
        username: user.username.toLowerCase(),
        network,
        data: encodeData({ contractId, network, callFunction }),
        challenge: options.challenge,
      }),
      {
        httpOnly: true,
        maxAge: 120000,
        secure: true,
        sameSite: sameSiteConfig,
      }
    );

    return res.json({
      options,
      signAccess: true,
    });
  } catch (error) {
    console.error("[sdk/init-sign-transaction]", error);

    return res.status(400).json({
      error: error.message || "No user found or user not authorized",
    });
  }
});

router.post("/any-invoke-with-sig", tempAccessMiddleware, async (req, res) => {
  const {
    contractId,
    callFunction,
    args = [],
    sigData,
    txDetails = null,
    sId = "",
  } = req.body;

  try {
    const { network } = req.tempAccess;

    if (!network || !contractId || !callFunction || !sigData) {
      return res.status(400).json({
        error: "network, contractId, callFunction and sigData are required",
      });
    }

    const signInfo = JSON.parse(req.cookies.sdkSignInfo || "{}");

    if (!signInfo?.challenge) {
      return res.status(400).json({
        error: "Signature info not found",
      });
    }

    const authHeader = req.headers.authorization;

    if (!authHeader?.startsWith("Bearer ")) {
      return res.status(401).json({
        error: "Authorization header is missing",
      });
    }

    const accessToken = authHeader.split(" ")[1];

    const accessVerification = authenticateToken(accessToken);
    const user = await getUserByUsername(accessVerification.username);

    if (!user) {
      return res.status(400).json({
        error: "No user found or user not authorized",
      });
    }

    const credentialIdHex = Buffer.from(sigData.id, "base64url").toString(
      "hex"
    );

    if (credentialIdHex !== user.passkey.id) {
      return res.status(400).json({
        error: "Invalid signature data received",
      });
    }

    const verification = await verifyAuthenticationResponse({
      response: sigData,
      expectedChallenge: signInfo.challenge,
      expectedOrigin,
      expectedRPID: rp_id,
      requireUserVerification: true,
      authenticator: {
        credentialID: new Uint8Array(Buffer.from(user.passkey.id, "hex")),
        credentialPublicKey: new Uint8Array(
          Buffer.from(user.passkey.publicKey, "hex")
        ),
        counter: user.passkey.counter,
        transports: user.passkey.transports,
      },
    });

    if (!verification.verified) {
      return res.status(400).json({
        error: "Transaction approval verification failed",
      });
    }

    user.passkey.counter = verification.authenticationInfo.newCounter;
    await user.save();

    const dataValid =
      encodeData({ contractId, network, callFunction }) === signInfo.data;

    if (
      user.username.toLowerCase() !== signInfo.username ||
      user.userId !== signInfo.userId ||
      signInfo.network !== network ||
      !dataValid
    ) {
      return res.status(400).json({
        error: "Something wrong with signed transaction",
      });
    }

    const txNonceRes = await walletTxNonce(
      internalSigner.publicKey(),
      network,
      contractId,
      "get_tx_payload",
      callFunction.name,
      args
    );

    const txNonce = txNonceRes?.results?.[0]?.returnValueJson?.bytes;

    if (!txNonce) {
      return res.status(400).json({
        error: "Unable to fetch transaction payload",
      });
    }

    const signatureAggregate = await signatureAggregator(
      network,
      user.passkey.publicKey,
      contractId,
      txNonce
    );

    const callArgs = [
      ...args,
      {
        value: signatureAggregate,
        type: "scSpecTypeBytes",
      },
    ];

    const txResponse = await invokeContract(
      network,
      contractId,
      callFunction.name,
      callArgs
    );

    if (!txResponse) {
      return res.status(400).json({
        error: "Transaction Submission Failed",
      });
    }

    if (txDetails) {
      await recordTransaction({
        ...txDetails,
        txId: txResponse.txHash,
        network,
      });
    }

    res.clearCookie("sdkSignInfo", {
      httpOnly: true,
      secure: true,
      sameSite: sameSiteConfig,
    });

    return res.status(200).json({
      message: "transaction successful",
      data: txResponse,
    });
  } catch (error) {
    console.error("[sdk/any-invoke-with-sig]", error);

    return res.status(400).json({
      error: error.response ? error.response.data : error.message,
    });
  }
});

module.exports = { router, tempAccessMiddleware };
