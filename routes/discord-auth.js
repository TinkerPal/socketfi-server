require("dotenv").config({ quiet: true });
const router = require("express").Router();
const passport = require("passport");
console.log("DISCORD AUTH ROUTES FILE LOADED here");
const CLIENT_URL =
	process.env.ENV === "PRODUCTION"
		? process.env.CLIENT_URL
		: "http://localhost:5173";

router.get("/discord/callback", (req, res, next) => {
	passport.authenticate("discord", (err, user, info) => {
		if (err || !user) {
			const message =
				err?.message || info?.message || "Discord authentication failed";

			const code = err?.code || info?.code || "DISCORD_AUTH_FAILED";

			console.error("[discord-callback] Auth failed:", {
				error: err?.message,
				info,
			});

			return res.redirect(
				`${CLIENT_URL}/settings/connect?discord=failed&code=${encodeURIComponent(
					code,
				)}&error=${encodeURIComponent(message)}`,
			);
		}

		return res.redirect(
			`${CLIENT_URL}/settings/connect?discord=pending_onchain`,
		);
	})(req, res, next);
});

router.get("/discord/link/options", (req, res) => {
	const pending = req.session?.pending_discord_link;

	if (!pending) {
		return res.status(404).json({ error: "No pending Discord link" });
	}

	return res.json({
		options: pending.initData.options,
		signAccess: pending.initData.signAccess,
		discord: pending.discordData.discord,
		network: pending.network,
		walletContractId: pending.wallet,
	});
});

module.exports = router;
