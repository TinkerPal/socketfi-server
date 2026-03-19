require("dotenv").config({ quiet: true });
const router = require("express").Router();
const passport = require("passport");

const CLIENT_URL =
	process.env.NODE_ENV === "production"
		? process.env.CLIENT_URL
		: process.env.CLIENT_URL || "http://localhost:5173";

router.get("/twitter/callback", (req, res, next) => {
	passport.authenticate("twitter", (err, user) => {
		if (err || !user) {
			console.error("[twitter-callback] Auth failed:", err?.message);
			return res.redirect(`${CLIENT_URL}/settings?twitter=failed`);
		}
		return res.redirect(`${CLIENT_URL}/settings?twitter=success`);
	})(req, res, next);
});

module.exports = router;
