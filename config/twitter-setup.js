require("dotenv").config({ quiet: true });
const passport = require("passport");
const TwitterStrategy = require("passport-twitter").Strategy;
const { UserAccount } = require("../models/models");

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

				if (!userId) {
					return done(new Error("No userId in session context"));
				}

				const twitterData = {
					twitterId: profile._json.id_str,
					twitterProfile: {
						name: profile._json.name,
						screenName: profile._json.screen_name,
						profileImageUrl: profile._json.profile_image_url_https,
					},
				};

				await UserAccount.updateOne({ userId }, { $set: twitterData });

				done(null, { userId, ...twitterData });
			} catch (err) {
				console.error("[passport] Twitter OAuth error:", err);
				done(err);
			}
		},
	),
);

module.exports = passport;
