require("dotenv").config({ quiet: true });
const passport = require("passport");
const { Strategy: DiscordStrategy } = require("discord-strategy");
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

				const network = req.session?.discord_auth_context?.network;

				if (!userId) {
					return done(new Error("No userId in session context"));
				}

				const existingDiscord = await UserAccount.findOne({
					"discord.id": profile.id,
					userId: { $ne: userId },
				});

				if (existingDiscord) {
					return done(null, false, {
						code: "DISCORD_ALREADY_LINKED",
						message: "Discord account already linked to another user",
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
							{ value: profile.id, type: "scSpecTypeString" },
							{ value: "discord", type: "scSpecTypeString" },
						],
						sId: "",
					},
				});

				const discordData = {
					discord: {
						id: profile.id,
						username: profile.username,
						discriminator: profile.discriminator,
						avatar: profile.avatar
							? `https://cdn.discordapp.com/avatars/${profile.id}/${profile.avatar}`
							: null,
						email: profile.email || null,
					},
				};

				delete req.session.pending_discord_link;
				req.session.pending_discord_link = {
					userId,
					wallet,
					network,
					discordData,
					initData,
					expiresAt: Date.now() + 5 * 60 * 1000,
					consumed: false,
				};

				req.session.save((err) => {
					if (err) return done(err);

					return done(null, {
						userId,
						pendingDiscordLink: true,
						...discordData,
					});
				});
			} catch (err) {
				console.error("[passport] Discord OAuth error:", err);
				done(err);
			}
		},
	),
);

module.exports = passport;
