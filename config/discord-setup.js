// require("dotenv").config({ quiet: true });
// const passport = require("passport");
// const { Strategy: DiscordStrategy } = require("discord-strategy");
// const { UserAccount } = require("../models/models");

// passport.use(
// 	new DiscordStrategy(
// 		{
// 			clientID: process.env.DISCORD_CLIENT_ID,
// 			clientSecret: process.env.DISCORD_CLIENT_SECRET,
// 			callbackURL:
// 				process.env.ENV === "PRODUCTION"
// 					? process.env.DISCORD_CALLBACK_PROD
// 					: process.env.DISCORD_CALLBACK_DEV,
// 			scope: ["identify", "email"],
// 			passReqToCallback: true,
// 		},
// 		async (req, accessToken, refreshToken, profile, done) => {
// 			try {
// 				const userId = req.session?.discord_auth_context?.userId;

// 				if (!userId) {
// 					return done(new Error("No userId in session context"));
// 				}

// 				const discordData = {
// 					discordId: profile.id,
// 					discordProfile: {
// 						username: profile.username,
// 						discriminator: profile.discriminator,
// 						avatar: profile.avatar
// 							? `https://cdn.discordapp.com/avatars/${profile.id}/${profile.avatar}`
// 							: null,
// 						email: profile.email || null,
// 					},
// 				};

// 				await UserAccount.updateOne({ userId }, { $set: discordData });

// 				done(null, { userId, ...discordData });
// 			} catch (err) {
// 				console.error("[passport] Discord OAuth error:", err);
// 				done(err);
// 			}
// 		},
// 	),
// );

// module.exports = passport;

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
				const jwt = require("jsonwebtoken");

				// 🔥 Extract state from query
				const { state } = req.query;

				console.log({ state });

				if (!state) {
					return done(new Error("Missing state"));
				}

				let decoded;
				try {
					decoded = jwt.verify(state, process.env.JWT_SECRET);
				} catch (e) {
					return done(new Error("Invalid or expired state"));
				}

				const { userId } = decoded;

				const existingDiscord = await UserAccount.findOne({
					"discord.id": profile.id,
					userId: { $ne: userId },
				});

				if (existingDiscord) {
					return done(new Error("Discord account already linked to another user"));
				}

				const discordData = {
					discord: {
						id: profile.id,
						username: profile.username,
						discriminator: profile.discriminator,
						imageUrl: profile.avatar
							? `https://cdn.discordapp.com/avatars/${profile.id}/${profile.avatar}`
							: null,
						email: profile.email || null,
					},
				};

				await UserAccount.updateOne(
					{ userId },
					{ $set: discordData, $addToSet: { linkedAccounts: "discord" } },
				);

				done(null, { userId, ...discordData });
			} catch (err) {
				console.error("[passport] Discord OAuth error:", err);
				done(err);
			}
		},
	),
);

module.exports = passport;
