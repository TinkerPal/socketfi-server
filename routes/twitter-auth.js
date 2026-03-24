require("dotenv").config({ quiet: true });
const router = require("express").Router();
const passport = require("passport");

const CLIENT_URL =
	process.env.ENV === "PRODUCTION"
		? process.env.CLIENT_URL
		: "http://localhost:5173";

router.get("/twitter/callback", (req, res, next) => {
	passport.authenticate("twitter", (err, user) => {
		console.log({ err, user }, req.session);
		if (err || !user) {
			const errorMsg = err?.message
				? encodeURIComponent(err.message)
				: "Twitter authentication failed";
			console.error("[twitter-callback] Auth failed:", err?.message);
			return res.redirect(
				`${CLIENT_URL}/account-configurations?twitter=failed&error=${errorMsg}`,
			);
		}
		return res.redirect(`${CLIENT_URL}/account-configurations`);
	})(req, res, next);
});

module.exports = router;
