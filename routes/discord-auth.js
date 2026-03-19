require("dotenv").config({ quiet: true });
const router = require("express").Router();
const passport = require("passport");

const CLIENT_URL =
	process.env.NODE_ENV === "production"
		? process.env.CLIENT_URL
		: process.env.CLIENT_URL || "http://localhost:5173";

router.get("/discord/callback", (req, res, next) => {
	passport.authenticate("discord", (err, user) => {
		if (err || !user) {
			console.error("[discord-callback] Auth failed:", err?.message);
			return res.redirect(`${CLIENT_URL}/settings?discord=failed`);
		}
		return res.redirect(`${CLIENT_URL}/settings?discord=success`);
	})(req, res, next);
});

module.exports = router;
