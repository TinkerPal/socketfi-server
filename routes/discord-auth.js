require("dotenv").config({ quiet: true });
const router = require("express").Router();
const passport = require("passport");

const CLIENT_URL =
	process.env.ENV === "PRODUCTION"
		? process.env.CLIENT_URL
		: "http://localhost:5173";

router.get("/discord/callback", (req, res, next) => {
	passport.authenticate("discord", (err, user) => {
		console.log({ user, err });
		if (err || !user) {
			const errorMsg = err?.message
				? encodeURIComponent(err.message)
				: "Discord authentication failed";
			console.error("[discord-callback] Auth failed:", err?.message);
			return res.redirect(
				`${CLIENT_URL}/settings/connect?discord=failed&error=${errorMsg}`,
			);
		}
		return res.redirect(`${CLIENT_URL}/settings/connect`);
	})(req, res, next);
});

module.exports = router;
