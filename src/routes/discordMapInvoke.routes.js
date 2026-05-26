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

async function loadPendingDiscordLink(req, res, next) {
	const pending = req.session?.pending_discord_link;

	console.log("Pending Discord Link in session:", pending); // Debug log

	if (!pending) {
		return res.status(404).json({ error: "No pending Discord link" });
	}

	if (pending.consumed) {
		return res.status(409).json({ error: "Discord link already used" });
	}

	const regValdatorSigs = [];
	for (let node of nodes) {
		const nodeSig = await nodeIdMapSig(
			node.url,
			pending.wallet,
			"discord",
			pending.discordData.discord.id,
		);
		regValdatorSigs.push(nodeSig);
	}

	req.invoke = {
		type: "id-mapping",
		contractId: pending.wallet,
		network: pending.network,
		callFunction: "add_id_wallet_map",
		args: [pending.discordData.discord.id, "discord"],
		validatorSigs: regValdatorSigs,
		sigData: req.body.sigData,
		txDetails: pending.initData.signInfo,
		sId: "",
	};

	req.cookies = req.cookies || {};
	req.cookies.signInfo = JSON.stringify(pending.initData.signInfo);

	req.pendingDiscordLink = pending;

	next();
}

async function saveDiscordAfterInvoke(req, res, next) {
	const originalJson = res.json.bind(res);

	res.json = async (data) => {
		try {
			if (data?.data?.status === "SUCCESS" && req.pendingDiscordLink) {
				await UserAccount.updateOne(
					{ userId: req.pendingDiscordLink.userId },
					{
						$set: {
							discord: {
								id: req.pendingDiscordLink.discordData.discord.id,
								username: req.pendingDiscordLink.discordData.discord.username,
								name: req.pendingDiscordLink.discordData.discord.name,
								profileImageUrl:
									req.pendingDiscordLink.discordData.discord.profileImageUrl,
							},
						},
						$addToSet: { linkedAccounts: "discord" },
					},
					{ runValidators: true },
				);

				delete req.session.pending_discord_link;
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
	"/discord/link/confirm",
	requireAccessToken,
	loadUserFromToken,
	loadPendingDiscordLink,
	verifyPasskeySignature,
	verifySignedIntent,
	maybeRunDappMiddleware,
	saveDiscordAfterInvoke,
	invokeAnyContract,
);

module.exports = router;
