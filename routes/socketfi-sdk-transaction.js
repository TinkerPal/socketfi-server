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
const { UserAccount, authenticateToken } = require("../models/models");
const { createAuthCode, consumeAuthCode } = require("../lib/auth-code-store");
const nodes = require("../signer-nodes/signer-nodes");
const {
  getUserByUsername,
  base64UrlToUint8Array,
  recordTransaction,
} = require("../helper-functions");
const { signatureAggregator } = require("../bls-nodes/bls-node-methods");

const router = express.Router();

const TEMP_ACCESS_SECRET = process.env.TEMP_ACCESS_SECRET;

if (!TEMP_ACCESS_SECRET && process.env.NODE_ENV === "production") {
  throw new Error("TEMP_ACCESS_SECRET is required in production");
}

const TEMP_ACCESS_ISSUER = "socketfi-api";
const TEMP_ACCESS_AUDIENCE = "socketfi-hosted-auth";
const VALID_MODES = new Set(["signin", "signup"]);
const VALID_NETWORKS = new Set(["PUBLIC", "TESTNET"]);

const StellarSdk = require("@stellar/stellar-sdk");
const redis = require("../lib/redis");
const { encodeData } = require("../soroban/utils");
const { walletTxNonce, internalSigner } = require("../soroban/soroban-methods");
const { invokeContract } = require("../soroban/soroban-methods");
const { invokeContractScVal } = require("../soroban/soroban-methods");

const TX_INTENT_TTL_SECONDS = 300; // 5 minutes

function sha256Json(value) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(value))
    .digest("hex");
}

function validateArgsXdr(argsXdr = []) {
  if (!Array.isArray(argsXdr)) {
    throw new Error("argsXdr must be an array");
  }

  return argsXdr.map((argXdr) => {
    if (typeof argXdr !== "string") {
      throw new Error("Each argsXdr item must be a base64 XDR string");
    }

    // validates it is real ScVal XDR
    StellarSdk.xdr.ScVal.fromXDR(argXdr, "base64");

    return argXdr;
  });
}

// router.post("/transaction-intents", async (req, res) => {
//   try {
//     const {
//       contractId,
//       callFunction,
//       argsXdr = [],
//       txDetails = {},
//       display = {},
//       network = "TESTNET",
//       sId = "",
//     } = req.body;

//     if (!contractId || !callFunction?.name) {
//       return res.status(400).json({
//         success: false,
//         error: "contractId and callFunction.name are required",
//       });
//     }

//     const authHeader = req.headers.authorization;

//     if (!authHeader?.startsWith("Bearer ")) {
//       return res.status(401).json({
//         success: false,
//         error: "Authorization header is missing",
//       });
//     }

//     const accessToken = authHeader.split(" ")[1];
//     const accessVerification = authenticateToken(accessToken);

//     const user = await getUserByUsername(accessVerification.username);

//     if (!user) {
//       return res.status(401).json({
//         success: false,
//         error: "No user found or user not authorized",
//       });
//     }

//     const validatedArgsXdr = validateArgsXdr(argsXdr);

//     const txSession = crypto.randomBytes(32).toString("base64url");

//     const txHash = sha256Json({
//       userId: user.userId,
//       walletAddress: user.address?.[network],
//       network,
//       contractId,
//       callFunction,
//       argsXdr: validatedArgsXdr,
//     });

//     const intent = {
//       txSession,
//       txHash,
//       userId: user.userId,
//       username: user.username.toLowerCase(),
//       walletAddress: user.address?.[network],
//       network,
//       contractId,
//       callFunction,
//       argsXdr: validatedArgsXdr,
//       txDetails,
//       display,
//       sId,
//       createdAt: Date.now(),
//     };

//     await redis.set(
//       `socketfi:tx-intent:${txSession}`,
//       JSON.stringify(intent),
//       "EX",
//       TX_INTENT_TTL_SECONDS
//     );

//     return res.json({
//       success: true,
//       txSession,
//       expiresIn: TX_INTENT_TTL_SECONDS,
//       redirectTo: `http://localhost:8080/transaction?txSession=${encodeURIComponent(
//         txSession
//       )}`,
//     });
//   } catch (error) {
//     console.error("[transaction-intents/create]", error);

//     return res.status(400).json({
//       success: false,
//       error: error.message || "Failed to create transaction intent",
//     });
//   }
// });

router.post("/transaction-intents", async (req, res) => {
  try {
    const {
      contractId,
      callFunction,
      argsXdr = [],
      txDetails = {},
      display = {},
      network = "TESTNET",
      sId = "",
    } = req.body;

    if (!contractId || !callFunction?.name) {
      return res.status(400).json({
        success: false,
        error: "contractId and callFunction.name are required",
      });
    }

    const authHeader = req.headers.authorization;

    if (!authHeader?.startsWith("Bearer ")) {
      return res.status(401).json({
        success: false,
        error: "Authorization header is missing",
      });
    }

    const accessToken = authHeader.split(" ")[1];
    const accessVerification = authenticateToken(accessToken);

    const user = await getUserByUsername(accessVerification.username);

    if (!user) {
      return res.status(401).json({
        success: false,
        error: "No user found or user not authorized",
      });
    }

    const walletAddress = user.address?.[network];

    if (!walletAddress) {
      return res.status(400).json({
        success: false,
        error: `User has no wallet address for ${network}`,
      });
    }

    const validatedArgsXdr = validateArgsXdr(argsXdr);

    const txSession = crypto.randomBytes(32).toString("base64url");

    const txHash = sha256Json({
      userId: user.userId,
      walletAddress,
      network,
      contractId,
      callFunction,
      argsXdr: validatedArgsXdr,
    });

    const txAccess = jwt.sign(
      {
        type: "transaction_intent",
        txSession,
        txHash,
        userId: user.userId,
        username: user.username.toLowerCase(),
      },
      TEMP_ACCESS_SECRET,
      {
        expiresIn: `${TX_INTENT_TTL_SECONDS}s`,
        issuer: TEMP_ACCESS_ISSUER,
        audience: TEMP_ACCESS_AUDIENCE,
      }
    );

    const intent = {
      txSession,
      txHash,
      userId: user.userId,
      username: user.username.toLowerCase(),
      walletAddress,
      network,
      contractId,
      callFunction,
      argsXdr: validatedArgsXdr,
      txDetails,
      display,
      sId,
      createdAt: Date.now(),
    };

    await redis.set(
      `socketfi:tx-intent:${txSession}`,
      JSON.stringify(intent),
      "EX",
      TX_INTENT_TTL_SECONDS
    );

    return res.json({
      success: true,
      txSession,
      txAccess,
      expiresIn: TX_INTENT_TTL_SECONDS,
      redirectTo: `http://localhost:8080/transaction?txSession=${encodeURIComponent(
        txSession
      )}&txAccess=${encodeURIComponent(txAccess)}`,
    });
  } catch (error) {
    console.error("[transaction-intents/create]", error);

    return res.status(400).json({
      success: false,
      error: error.message || "Failed to create transaction intent",
    });
  }
});

router.get("/transaction-intents/:txSession", async (req, res) => {
  try {
    const { txSession } = req.params;

    const raw = await redis.get(`socketfi:tx-intent:${txSession}`);

    if (!raw) {
      return res.status(404).json({
        success: false,
        error: "Transaction intent expired or not found",
      });
    }

    const intent = JSON.parse(raw);

    return res.json({
      success: true,
      transaction: {
        txSession: intent.txSession,
        network: intent.network,
        contractId: intent.contractId,
        callFunction: intent.callFunction,
        walletAddress: intent.walletAddress,
        txDetails: intent.txDetails,
        display: intent.display,
        txHash: intent.txHash,
      },
    });
  } catch (error) {
    console.error("[transaction-intents/get]", error);

    return res.status(400).json({
      success: false,
      error: error.message || "Failed to fetch transaction intent",
    });
  }
});

router.post("/transaction-intents/init", async (req, res) => {
  try {
    const { txSession } = req.body;

    if (!txSession) {
      return res.status(400).json({
        success: false,
        error: "txSession is required",
      });
    }

    const raw = await redis.get(`socketfi:tx-intent:${txSession}`);

    if (!raw) {
      return res.status(404).json({
        success: false,
        error: "Transaction intent expired or not found",
      });
    }

    const intent = JSON.parse(raw);

    const authHeader = req.headers["authorization"];

    if (!authHeader?.startsWith("Bearer ")) {
      return res.status(401).json({
        success: false,
        error: "Authorization header is missing",
      });
    }

    const txAccess = authHeader.split(" ")[1];

    const accessVerification = jwt.verify(txAccess, TEMP_ACCESS_SECRET, {
      issuer: TEMP_ACCESS_ISSUER,
      audience: TEMP_ACCESS_AUDIENCE,
    });

    if (
      accessVerification.type !== "transaction_intent" ||
      accessVerification.txSession !== txSession ||
      accessVerification.txHash !== intent.txHash
    ) {
      return res.status(403).json({
        success: false,
        error: "Invalid transaction access token",
      });
    }

    const user = await getUserByUsername(accessVerification.username);

    if (!user) {
      return res.status(400).json({
        success: false,
        error: "No user found or user not authorized",
      });
    }

    if (user.username.toLowerCase() !== intent.username.toLowerCase()) {
      return res.status(403).json({
        success: false,
        error: "Authenticated user does not match transaction intent",
      });
    }

    const options = await generateAuthenticationOptions({
      rpID: rp_id,
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
        txSession: intent.txSession,
        txHash: intent.txHash,
        userId: user.userId,
        username: user.username.toLowerCase(),
        data: encodeData({
          txSession: intent.txSession,
          txHash: intent.txHash,
          contractId: intent.contractId,
          network: intent.network,
          callFunction: intent.callFunction,
          argsXdr: intent.argsXdr,
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

    return res.json({
      success: true,
      options,
      signAccess: true,
      txSession: intent.txSession,
      txHash: intent.txHash,
    });
  } catch (error) {
    console.error(
      "[transaction-intents/init]",
      error.response ? error.response.data : error.message
    );

    return res.status(400).json({
      success: false,
      error: error.message || "No user found or user not authorized",
    });
  }
});

router.post("/transaction-intents/confirm", async (req, res) => {
  const { txSession, sigData } = req.body;

  try {
    if (!txSession || !sigData) {
      return res.status(400).json({
        success: false,
        error: "txSession and sigData are required",
      });
    }

    const raw = await redis.get(`socketfi:tx-intent:${txSession}`);

    if (!raw) {
      return res.status(404).json({
        success: false,
        error: "Transaction intent expired or not found",
      });
    }

    const intent = JSON.parse(raw);

    console.log("the intent final", intent);

    const signInfo = req.cookies.signInfo
      ? JSON.parse(req.cookies.signInfo)
      : null;

    console.log("the signInfo", signInfo);

    if (!signInfo) {
      return res.status(400).json({
        success: false,
        error: "Signature info not found",
      });
    }

    if (
      signInfo.txSession !== intent.txSession ||
      signInfo.txHash !== intent.txHash
    ) {
      return res.status(400).json({
        success: false,
        error: "Invalid signature session",
      });
    }

    const user = await getUserByUsername(signInfo.username);

    if (!user) {
      return res.status(400).json({
        success: false,
        error: "No user found or user not authorized",
      });
    }

    const areEqual =
      Buffer.from(
        new Uint8Array(Buffer.from(user?.passkey?.id, "hex"))
      ).compare(Buffer.from(base64UrlToUint8Array(sigData.id))) === 0;

    if (!areEqual) {
      return res.status(400).json({
        success: false,
        error: "Invalid signature data received",
      });
    }

    const verification = await verifyAuthenticationResponse({
      response: sigData,
      expectedChallenge: signInfo.challenge,
      expectedOrigin: expectedOrigin,
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
      return res.status(400).json({
        success: false,
        error: "Transaction approval verification failed",
      });
    }

    const dataValid =
      encodeData({
        txSession: intent.txSession,
        txHash: intent.txHash,
        contractId: intent.contractId,
        network: intent.network,
        callFunction: intent.callFunction,
        argsXdr: intent.argsXdr,
      }) === signInfo.data;

    if (
      user.username.toLowerCase() !== signInfo.username ||
      user.userId !== signInfo.userId ||
      !dataValid
    ) {
      return res.status(400).json({
        success: false,
        error: "Something wrong with signed transaction",
      });
    }

    const args = (intent.argsXdr || []).map((argXdr) =>
      StellarSdk.xdr.ScVal.fromXDR(argXdr, "base64")
    );

    const txNonceRes = await walletTxNonce(
      internalSigner.publicKey(),
      intent.network,
      intent.contractId,
      "get_tx_payload",
      intent.callFunction?.name,
      null,
      args
    );

    const txNonce = txNonceRes?.results[0]?.returnValueJson?.bytes;

    console.log("the intent is", intent);

    console.log("the tx nonce is ", txNonce);

    const signatureAggregate = await signatureAggregator(
      intent.network,
      user.passkey.publicKey,
      intent.contractId,
      txNonce
    );

    console.log("the signature is", signatureAggregate);

    const callArgs = [
      ...args,
      StellarSdk.nativeToScVal(signatureAggregate, { type: "bytes" }),
    ];

    const txResponse = await invokeContractScVal(
      intent.network,
      intent.contractId,
      intent.callFunction?.name,
      callArgs
    );

    if (!txResponse) {
      return res.status(400).json({
        success: false,
        error: "Transaction Submission Failed",
      });
    }

    if (intent.txDetails) {
      const txRecord = {
        id: intent?.userId,
        txId: txResponse?.txHash,
        walletContractId: intent?.walletAddress,
        type: intent?.callFunction?.name,
        network: intent.network,
      };

      await recordTransaction(txRecord);
    }

    await redis.del(`socketfi:tx-intent:${txSession}`);

    res.clearCookie("signInfo", {
      httpOnly: true,
      secure: true,
      sameSite: sameSiteConfig,
    });

    return res.status(200).json({
      success: true,
      message: "transaction successful",
      data: txResponse,
    });
  } catch (error) {
    console.error(
      "[transaction-intents/confirm]",
      error.response ? error.response.data : error.message
    );

    return res.status(400).json({
      success: false,
      error: error.response ? error.response.data : error.message,
    });
  }
});

module.exports = { router };
