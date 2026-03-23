require("dotenv").config({ quiet: true });
const passport = require("passport");
const TwitterStrategy = require("passport-twitter").Strategy;

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
				done(null, profile);
			} catch (err) {
				done(err);
			}
		}
	)
);

module.exports = passport;
