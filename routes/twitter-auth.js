require("dotenv").config({ quiet: true });
const router = require("express").Router();
const passport = require("passport");

const CLIENT_URL =
	process.env.ENV === "PRODUCTION"
		? process.env.CLIENT_URL
		: "http://localhost:5173";

router.get("/twitter/callback", (req, res, next) => {
	passport.authenticate("twitter", (err, user) => {
		console.log({ err, user });
		if (err || !user) {
			console.error("[twitter-callback] Auth failed:", err?.message);
			return res.redirect(
				`${CLIENT_URL}/account-configurations?twitter=failed`,
			);
		}
		return res.redirect(`${CLIENT_URL}/account-configurations`);
	})(req, res, next);
});

module.exports = router;
