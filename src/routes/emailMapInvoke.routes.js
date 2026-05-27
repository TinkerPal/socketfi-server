const express = require("express");

const requireAccessToken = require("../middleware/requireAccessToken");
const loadUserFromToken = require("../middleware/loadUserFromToken");
const verifyPasskeySignature = require("../middleware/verifyPasskeySignature");
const verifySignedIntent = require("../middleware/verifySignedIntent");
const maybeRunDappMiddleware = require("../middleware/maybeRunDappMiddleware");
const { invokeAnyContract } = require("../controllers/anyInvoke.controller");

const nodes = require("../../signer-nodes/signer-nodes");
const { nodeIdMapSig } = require("../../bls-nodes/bls-node-methods");
const { UserAccount, EmailVerification } = require("../models");

const router = express.Router();

async function loadPendingEmailLink(req, res, next) {
	const pendingId = req.query?.pendingId;

	if (!pendingId) {
		return res
			.status(400)
			.json({ error: "Pending ID is required for email link" });
	}

	const pending = await EmailVerification.findOne({
		_id: pendingId,
	});

	if (!pending) {
		return res.status(404).json({ error: "Pending email link not found" });
	}

	const payload = pending.payload;

	if (!payload) {
		return res.status(500).json({ error: "No payload found for pending link" });
	}
	console.log("Pending Payload", payload);

	const regValdatorSigs = [];
	for (let node of nodes) {
		const nodeSig = await nodeIdMapSig(
			node.url,
			payload.wallet,
			"email",
			payload.emailData.email.address,
		);
		regValdatorSigs.push(nodeSig);
	}

	req.invoke = {
		type: "id-mapping",
		contractId: payload.wallet,
		network: payload.network,
		callFunction: "add_id_wallet_map",
		args: [payload.emailData.email.address, "email"],
		validatorSigs: regValdatorSigs,
		sigData: req.body.sigData,
		txDetails: payload.initData.signInfo,
		sId: "",
	};

	req.pendingEmailLink = payload;
	req.userId = pending.userId;

	await EmailVerification.deleteOne({ _id: pending._id });

	next();
}

async function saveEmailAfterInvoke(req, res, next) {
	const originalJson = res.json.bind(res);

	console.log("Pending Email Link:", req.pendingEmailLink, req.userId);

	res.json = async (data) => {
		console.log({ data });
		try {
			if (data?.data?.status === "SUCCESS" && req.pendingEmailLink) {
				await UserAccount.updateOne(
					{ userId: req.userId },
					{
						$set: {
							email: {
								address: req.pendingEmailLink.emailData.email.address,
								verified: true,
							},
						},
						$addToSet: { linkedAccounts: "email" },
					},
					{ runValidators: true },
				);
			}

			return originalJson(data);
		} catch (err) {
			return next(err);
		}
	};

	next();
}

router.post(
	"/email/link/confirm",
	requireAccessToken,
	loadUserFromToken,
	loadPendingEmailLink,
	verifyPasskeySignature,
	verifySignedIntent,
	maybeRunDappMiddleware,
	saveEmailAfterInvoke,
	invokeAnyContract,
);

module.exports = router;
