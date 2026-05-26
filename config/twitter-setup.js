require("dotenv").config({ quiet: true });
const passport = require("passport");
const TwitterStrategy = require("passport-twitter").Strategy;
const { UserAccount } = require("../models/models");
const {
  initSignConnectTransactionService,
} = require("../src/services/sign-connect-transaction.service");

passport.serializeUser((user, done) => {
  done(null, user);
});

passport.deserializeUser((user, done) => {
  done(null, user);
});

passport.use(
  new TwitterStrategy(
    {
      consumerKey: process.env.TWITTER_CONSUMER_KEY,
      consumerSecret: process.env.TWITTER_CONSUMER_SECRET,
      callbackURL:
        process.env.ENV === "PRODUCTION"
          ? process.env.TWITTER_CALLBACK_PROD
          : process.env.TWITTER_CALLBACK_DEV,
      passReqToCallback: true,
    },
    async (req, token, tokenSecret, profile, done) => {
      try {
        const userId = req.session?.twitter_auth_context?.userId;

        const network = req.session?.twitter_auth_context?.network;

        if (!userId) {
          return done(new Error("No userId in session context"));
        }

        const existingTwitter = await UserAccount.findOne({
          "twitter.id": profile._json.id_str,
          userId: { $ne: userId },
        });

        if (existingTwitter) {
          return done(null, false, {
            code: "TWITTER_ALREADY_LINKED",
            message: "Twitter account already linked to another user",
          });
        }

        const account = await UserAccount.findOne({
          userId,
        });

        const wallet = account?.address?.[network];

        const initData = await initSignConnectTransactionService({
          user: account,
          signRequest: {
            contractId: wallet,
            network,
            callFunction: "add_id_wallet_map",
            args: [
              { value: profile._json.id_str, type: "scSpecTypeString" },
              { value: "x", type: "scSpecTypeString" },
            ],
            sId: "",
          },
        });

        const twitterData = {
          twitter: {
            id: profile._json.id_str,
            name: profile._json.name,
            screenName: profile._json.screen_name,
            profileImageUrl: profile._json.profile_image_url_https,
          },
        };

        delete req.session.pending_twitter_link;
        req.session.pending_twitter_link = {
          userId,
          wallet,
          network,
          twitterData,
          initData,
          expiresAt: Date.now() + 5 * 60 * 1000,
          consumed: false,
        };

        // await UserAccount.updateOne(
        //   { userId },
        //   { $set: twitterData, $addToSet: { linkedAccounts: "twitter" } }
        // );

        req.session.save((err) => {
          if (err) return done(err);

          return done(null, {
            userId,
            pendingTwitterLink: true,
            ...twitterData,
          });
        });
      } catch (err) {
        console.error("[passport] Twitter OAuth error:", err);
        done(err);
      }
    }
  )
);

module.exports = passport;
