require("dotenv").config({ quiet: true });
const passport = require("passport");
const { Strategy: DiscordStrategy } = require("discord-strategy");
const { UserAccount } = require("../models/models");

passport.use(
	new DiscordStrategy(
		{
			clientID: process.env.DISCORD_CLIENT_ID,
			clientSecret: process.env.DISCORD_CLIENT_SECRET,
			callbackURL:
				process.env.ENV === "PRODUCTION"
					? process.env.DISCORD_CALLBACK_PROD
					: process.env.DISCORD_CALLBACK_DEV,
			scope: ["identify", "email"],
			passReqToCallback: true,
		},
		async (req, accessToken, refreshToken, profile, done) => {
			try {
				const userId = req.session?.discord_auth_context?.userId;

				if (!userId) {
					return done(new Error("No userId in session context"));
				}

				const discordData = {
					discordId: profile.id,
					discordProfile: {
						username: profile.username,
						discriminator: profile.discriminator,
						avatar: profile.avatar
							? `https://cdn.discordapp.com/avatars/${profile.id}/${profile.avatar}`
							: null,
						email: profile.email || null,
					},
				};

				await UserAccount.updateOne({ userId }, { $set: discordData });

				done(null, { userId, ...discordData });
			} catch (err) {
				console.error("[passport] Discord OAuth error:", err);
				done(err);
			}
		},
	),
);

module.exports = passport;
