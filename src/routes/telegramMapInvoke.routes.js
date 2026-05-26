const express = require("express");

const requireAccessToken = require("../middleware/requireAccessToken");
const loadUserFromToken = require("../middleware/loadUserFromToken");
const verifyPasskeySignature = require("../middleware/verifyPasskeySignature");
const verifySignedIntent = require("../middleware/verifySignedIntent");
const maybeRunDappMiddleware = require("../middleware/maybeRunDappMiddleware");
const { invokeAnyContract } = require("../controllers/anyInvoke.controller");

const nodes = require("../../signer-nodes/signer-nodes");
const { nodeIdMapSig } = require("../../bls-nodes/bls-node-methods");
const { UserAccount, TelegramLinking } = require("../models");

const router = express.Router();

async function loadPendingTelegramLink(req, res, next) {
	const pendingId = req.query?.pendingId;

	if (!pendingId) {
		return res
			.status(400)
			.json({ error: "Pending ID is required for Telegram link" });
	}

	const pending = await TelegramLinking.findOne({
		_id: pendingId,
		status: "VERIFIED",
	});

	if (!pending) {
		return res.status(404).json({ error: "Pending Telegram link not found" });
	}

	const payload = pending.payload;

	if (!payload) {
		return res.status(500).json({ error: "No payload found for pending link" });
	}

	const regValdatorSigs = [];
	for (let node of nodes) {
		const nodeSig = await nodeIdMapSig(
			node.url,
			payload.wallet,
			"telegram",
			payload.telegramData.telegram.id,
		);
		regValdatorSigs.push(nodeSig);
	}

	req.invoke = {
		type: "id-mapping",
		contractId: payload.wallet,
		network: payload.network,
		callFunction: "add_id_wallet_map",
		args: [payload.telegramData.telegram.id, "telegram"],
		validatorSigs: regValdatorSigs,
		sigData: req.body.sigData,
		txDetails: payload.initData.signInfo,
		sId: "",
	};

	req.pendingTelegramLink = payload;
	req.userId = pending.userId;

	await TelegramLinking.deleteOne({ _id: pending._id });

	next();
}

async function saveTelegramAfterInvoke(req, res, next) {
	const originalJson = res.json.bind(res);

	res.json = async (data) => {
		try {
			if (data?.data?.status === "SUCCESS" && req.pendingTelegramLink) {
				await UserAccount.updateOne(
					{ userId: req.userId },
					{
						$set: {
							telegram: {
								id: req.pendingTelegramLink.telegramData.telegram.id,
								username:
									req.pendingTelegramLink.telegramData.telegram.username,
								name: req.pendingTelegramLink.telegramData.telegram.name,
								profileImageUrl:
									req.pendingTelegramLink.telegramData.telegram.profileImageUrl,
							},
						},
						$addToSet: { linkedAccounts: "telegram" },
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
	"/telegram/link/confirm",
	requireAccessToken,
	loadUserFromToken,
	loadPendingTelegramLink,
	verifyPasskeySignature,
	verifySignedIntent,
	maybeRunDappMiddleware,
	saveTelegramAfterInvoke,
	invokeAnyContract,
);

module.exports = router;
