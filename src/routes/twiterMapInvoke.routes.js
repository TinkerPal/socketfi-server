const express = require("express");

const requireAccessToken = require("../middleware/requireAccessToken");
const loadUserFromToken = require("../middleware/loadUserFromToken");
const verifyPasskeySignature = require("../middleware/verifyPasskeySignature");
const verifySignedIntent = require("../middleware/verifySignedIntent");
const maybeRunDappMiddleware = require("../middleware/maybeRunDappMiddleware");
const { invokeAnyContract } = require("../controllers/anyInvoke.controller");

const nodes = require("../../signer-nodes/signer-nodes");
const {
  signaturePop,
  nodeIdMapSig,
} = require("../../bls-nodes/bls-node-methods");
const { UserAccount } = require("../models");

const router = express.Router();

async function loadPendingTwitterLink(req, res, next) {
  const pending = req.session?.pending_twitter_link;

  if (!pending) {
    return res.status(404).json({ error: "No pending Twitter link" });
  }

  if (pending.consumed) {
    return res.status(409).json({ error: "Twitter link already used" });
  }

  const regValdatorSigs = [];
  for (let node of nodes) {
    const nodeSig = await nodeIdMapSig(
      node.url,
      pending.wallet,
      "x",
      pending.twitterData.twitter.id
    );
    regValdatorSigs.push(nodeSig);
  }

  req.invoke = {
    type: "id-mapping",
    contractId: pending.wallet,
    network: pending.network,
    callFunction: "add_id_wallet_map",
    args: [pending.twitterData.twitter.id, "x"],
    validatorSigs: regValdatorSigs,
    sigData: req.body.sigData,
    txDetails: pending.initData.signInfo,
    sId: req.body?.sId,
  };

  req.cookies = req.cookies || {};
  req.cookies.signInfo = JSON.stringify(pending.initData.signInfo);

  req.pendingTwitterLink = pending;

  next();
}

async function saveTwitterAfterInvoke(req, res, next) {
  const originalJson = res.json.bind(res);

  res.json = async (data) => {
    try {
      console.log("the data for binding", data);
      if (data?.data?.txHash && req.pendingTwitterLink) {
        await UserAccount.updateOne(
          { userId: req.pendingTwitterLink.userId },
          {
            $set: {
              twitter: {
                id: req.pendingTwitterLink.twitterData.twitter.id,
                username: req.pendingTwitterLink.twitterData.twitter.username,
                name: req.pendingTwitterLink.twitterData.twitter.name,
                profileImageUrl:
                  req.pendingTwitterLink.twitterData.twitter.profileImageUrl,
              },
            },
            $addToSet: { linkedAccounts: "twitter" },
          },
          { runValidators: true }
        );

        delete req.session.pending_twitter_link;
        await new Promise((resolve, reject) => {
          req.session.save((err) => {
            if (err) reject(err);
            else resolve();
          });
        });
      }

      return originalJson(data);
    } catch (err) {
      return next(err);
    }
  };

  next();
}

router.post(
  "/twitter/link/confirm",
  requireAccessToken,
  loadUserFromToken,
  loadPendingTwitterLink,
  verifyPasskeySignature,
  verifySignedIntent,
  maybeRunDappMiddleware,
  saveTwitterAfterInvoke,
  invokeAnyContract
);

module.exports = router;
