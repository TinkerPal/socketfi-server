require("dotenv").config({ quiet: true });
const router = require("express").Router();
const passport = require("passport");
console.log("TWITTER AUTH ROUTES FILE LOADED");
const CLIENT_URL =
  process.env.ENV === "PRODUCTION"
    ? process.env.CLIENT_URL
    : "http://localhost:5173";

router.get("/twitter/callback", (req, res, next) => {
  passport.authenticate("twitter", (err, user, info) => {
    if (err || !user) {
      const message =
        err?.message || info?.message || "Twitter authentication failed";

      const code = err?.code || info?.code || "TWITTER_AUTH_FAILED";

      console.error("[twitter-callback] Auth failed:", {
        error: err?.message,
        info,
      });

      return res.redirect(
        `${CLIENT_URL}/settings/connect?twitter=failed&code=${encodeURIComponent(
          code
        )}&error=${encodeURIComponent(message)}`
      );
    }

    return res.redirect(
      `${CLIENT_URL}/settings/connect?twitter=pending_onchain`
    );
  })(req, res, next);
});

router.get("/twitter/link/options", (req, res) => {
  const pending = req.session?.pending_twitter_link;

  if (!pending) {
    return res.status(404).json({ error: "No pending Twitter link" });
  }

  // if (Date.now() > Number(pending.expiresAt)) {
  //   return res.status(410).json({
  //     error: "Pending Twitter link expired",
  //     debug: {
  //       now: Date.now(),
  //       expiresAt: pending.expiresAt,
  //       diffMs: Number(pending.expiresAt) - Date.now(),
  //     },
  //   });
  // }

  return res.json({
    options: pending.initData.options,
    signAccess: pending.initData.signAccess,
    twitter: pending.twitterData.twitter,
    network: pending.network,
    walletContractId: pending.wallet,
  });
});
router.post("/twitter/link/cancel", (req, res) => {
  delete req.session.pending_twitter_link;
  return res.json({ success: true });
});

module.exports = router;
