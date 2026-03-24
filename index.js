require("dotenv").config({ quiet: true });

const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const { randomUUID, randomInt } = require("crypto");
const mongoose = require("mongoose");
const swaggerUi = require("swagger-ui-express");
const { swaggerSpec } = require("./swagger");
const passport = require("passport");
const session = require("express-session");
require("./config/twitter-setup");
require("./config/discord-setup");

const {
	generateAuthenticationOptions,
	generateRegistrationOptions,
	verifyRegistrationResponse,
	verifyAuthenticationResponse,
} = require("@simplewebauthn/server");
const base64url = require("base64url");
var StellarSdk = require("@stellar/stellar-sdk");
const { nativeToScVal, StrKey } = StellarSdk;
const bufferStorage = {};

const {
	MONGODB_URI,
	authenticateToken,
	TokenList,
	EmailVerification,
	TelegramLinking,
	UserAccount,
} = require("./models/models");
const { sendOtpEmail } = require("./services/email-service");
const { sendOtpToTelegram } = require("./services/telegram-service");
const {
	getUserByUsername,
	createUser,
	createContract,
	base64UrlToUint8Array,
	attachContractToUser,
	findUserByAddress,
	recordTransaction,
	getTransactionsByUserId,
	reduceToAddressMap,
	reduceRows,
	normalizeTokenRows,
	getLoyaltyPoints,
	normalizeVersionRows,
} = require("./helper-functions");
const nodes = require("./signer-nodes/signer-nodes");
const {
	nodeInitGenKey,
	nodeCreateSuccess,
	nodeCreateFailure,
	signatureAggregator,
} = require("./bls-nodes/bls-node-methods");
const {
	internalSigner,
	RpcServer,
	contractGet,
	invokeContract,
	invokeContractScVal,
	BASE_FEE,
} = require("./soroban/soroban-methods");
const { sseProgress } = require("./tracker/progress-tracker");
const { progress } = require("./tracker/progress");
const contracts = require("./soroban/contracts");
const { encodeData, processArgs, toBaseUnits } = require("./soroban/utils");
const { findSwapPathAqua } = require("./configs/aqua-config");
const { findSwapPathSoroswap, getQuote } = require("./configs/soroswap-config");
const { bestUsdQuote } = require("./soroban/price-computation");
const { isReservedUsername } = require("./models/reserved_usernames");
const {
	normalizeAccessSettings,
} = require("./soroban/account-settings-helper");
const jwt = require("jsonwebtoken");
const MongoDBStore = require("connect-mongodb-session")(session);

const store = new MongoDBStore({
	uri: MONGODB_URI,
	collection: "sessions",
	expires: 1000 * 60 * 10, // 10 minutes
});

store.on("error", (err) => console.error("Session store error:", err));

const sameSiteConfig = process.env.ENV === "PRODUCTION" ? "none" : "none";

const port = process.env.PORT || 3000;

const app = express();
app.use(express.json());
app.use(cookieParser());

mongoose
	.connect(MONGODB_URI)
	.then(() => {
		console.log("✅ Connected to MongoDB");
	})
	.catch((err) => {
		console.error("❌ Error connecting to MongoDB:", err.message);
	});

const allowedOrigins = [
	"https://socket.fi",
	"https://app.socket.fi",
	"http://localhost:5173",
];

const CLIENT_URL =
	process.env.ENV === "PRODUCTION"
		? process.env.CLIENT_URL
		: "http://localhost:5173";

const rp_id =
	process.env.ENV === "PRODUCTION" ? process.env.RP_ID : "localhost";

const expectedOrigin = [
	CLIENT_URL,
	"android:apk-key-hash:nUBmf6HB48iZc6HdxHVr7fPSg8ff1gG6xTkK3e0CbQ4",
];

app.use(
	cors({
		origin: allowedOrigins,
		methods: ["GET", "POST"],
		credentials: true,
		allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
	}),
);

app.use(
	"/api-docs",
	swaggerUi.serve,
	swaggerUi.setup(swaggerSpec, {
		explorer: true,
		customSiteTitle: "SocketFi API Docs",
	}),
);

app.set("trust proxy", 1);

app.use(
	session({
		name: "socketfiSession",
		secret:
			process.env.SESSION_SECRET || "fallback-secret-change-in-production",
		resave: false,
		saveUninitialized: false,
		store,
		cookie: {
			sameSite: process.env.ENV === "PRODUCTION" ? "none" : "lax",
			secure: process.env.ENV === "PRODUCTION" ? true : false,
			httpOnly: process.env.ENV === "PRODUCTION" ? true : false,
			maxAge: 10 * 60 * 1000,
			domain: process.env.ENV === "PRODUCTION" ? ".socket.fi" : undefined, // Add this
			path: "/",
		},
	}),
);

app.use(passport.initialize());
app.use(passport.session());

const twitterAuthRouter = require("./routes/twitter-auth");
const discordAuthRouter = require("./routes/discord-auth");
const { default: axios } = require("axios");
app.use("/auth", twitterAuthRouter);
app.use("/auth", discordAuthRouter);

app.get("/process/progress/:id", sseProgress);

app.get("/auth/get-account", async (req, res) => {
	const { username } = req.query; // use query parameters for GET

	if (!username) {
		return res.status(400).json({ error: "A valid username is required" });
	}

	if (username.length < 6) {
		return res
			.status(400)
			.json({ error: "Username must be at least 6 characters" });
	}

	if (isReservedUsername(username)) {
		res.json({
			description: "This username isn’t available. enter a different username",
			isReserved: true,
		});
	}

	const user = await getUserByUsername(username);

	if (user) {
		res.json({
			description: "Username taken — log in if it’s yours",
			existingUser: true,
			id: user.id,
		});
	} else {
		res.json({
			description: "Username available — sign up to claim it",
			existingUser: false, // should be false if username is available
			id: "",
		});
	}
});

app.get("/user", async (req, res) => {
	try {
		const authHeader = req.headers["authorization"];
		if (!authHeader) {
			return res.status(401).json({ error: "Authorization header is missing" });
		}

		const accessToken = authHeader.split(" ")[1];

		let accessVerification;
		try {
			accessVerification = authenticateToken(accessToken);
		} catch (e) {
			return res.status(401).json({ error: "Invalid token" });
		}

		const { userId, username } = accessVerification;
		const user = await getUserByUsername(username);

		if (!user) {
			return res.status(404).json({ error: "User not found" });
		}

		const clientUser = {
			username: user.username,
			linkedAccounts: user.linkedAccounts,
			userId: user.userId,
			address: user.address,
			email: user.email || null,
			emailVerified: user.emailVerified || false,
			twitterId: user.twitterId || null,
			twitterProfile: user.twitterProfile || null,
			discordId: user.discordId || null,
			discordProfile: user.discordProfile || null,
			telegramId: user.telegramId || null,
			telegramUsername: user.telegramUsername || null,
		};

		res.json({ user: clientUser });
	} catch (error) {
		console.error("Error fetching user:", error);
		res.status(500).json({ error: "Internal server error" });
	}
});

app.post("/init-auth", async (req, res) => {
	const { username, network } = req.body;

	if (!username || !network) {
		return res
			.status(400)
			.json({ error: "username and platform are required" });
	}

	if (isReservedUsername(username)) {
		return res.status(409).json({
			ok: false,
			code: "USERNAME_UNAVAILABLE",
			error:
				"That username isn’t available. Please choose a different username.",
		});
	}

	const user = await getUserByUsername(username);

	if (user) {
		const options = await generateAuthenticationOptions({
			rpID: rp_id,
			allowCredentials: [
				{
					id: new Uint8Array(Buffer.from(user.passkey.id, "hex")),
					type: "public-key",
					transports: user.passkey.transports,
				},
			],
		});

		progress.push(user.id, {
			step: "initialization",
			status: "start",
			detail: "Account login initialized",
		});

		res.cookie(
			"authInfo",
			JSON.stringify({
				userId: user.id,
				username: username.toLowerCase(),
				challenge: options.challenge,
			}),
			{
				httpOnly: true,
				maxAge: 120000,
				secure: true,
				sameSite: sameSiteConfig,
			},
		);

		console.dir(
			{ options: options, existingUser: true, id: user.id },
			{ depth: null },
		);
		res.json({ options: options, existingUser: true, id: user.id });
	} else {
		const options = await generateRegistrationOptions({
			rpID: rp_id,
			rpName: "SocketFi",
			userName: username.toLowerCase(),
			userID: base64url.encode(randomUUID()),
		});

		progress.push(options.user.id, {
			step: "initialization",
			status: "start",
			detail: "Account creation initialized",
		});

		res.cookie(
			"authInfo",
			JSON.stringify({
				userId: options.user.id,
				username: username.toLowerCase(),
				challenge: options.challenge,
			}),
			{
				httpOnly: true,
				maxAge: 120000,
				secure: true,
				sameSite: sameSiteConfig,
			},
		);

		console.dir(
			{ options: options, existingUser: false, id: options.user.id },
			{ depth: null },
		);

		res.json({ options: options, existingUser: false, id: options.user.id });
	}
});

app.post("/verify-auth", async (req, res) => {
	const { authData, id, network = "" } = req.body;

	console.log("authInfo cookie:", req.cookies.authInfo);
	console.log("authData:", JSON.stringify(authData, null, 2));

	try {
		const authInfo = JSON.parse(req?.cookies?.authInfo);

		if (!authInfo) {
			return res.status(400).json({ error: "Auth info not found" });
		}

		if (isReservedUsername(authInfo.username)) {
			return res.status(409).json({
				ok: false,
				code: "USERNAME_UNAVAILABLE",
				error:
					"That username isn’t available. Please choose a different username.",
			});
		}

		const user = await getUserByUsername(authInfo.username);

		if (user) {
			const areEqual =
				Buffer.from(
					new Uint8Array(Buffer.from(user?.passkey?.id, "hex")),
				).compare(Buffer.from(base64UrlToUint8Array(authData.id))) === 0;
			progress.push(id, {
				step: "login verification",
				status: "start",
				detail: "Verifying Login Credentials",
			});

			if (areEqual) {
				let verification;

				try {
					verification = await verifyAuthenticationResponse({
						response: authData,
						expectedChallenge: authInfo.challenge,
						expectedOrigin: expectedOrigin,
						expectedRPID: rp_id,
						authenticator: {
							credentialID: new Uint8Array(
								Buffer.from(user?.passkey?.id, "hex"),
							),
							credentialPublicKey: new Uint8Array(
								Buffer.from(user?.passkey?.publicKey, "hex"),
							),
							counter: user.passkey.counter,
							transports: user.passkey.transports,
						},
					});
				} catch (e) {
					console.log("the verification error", e);
				}

				if (verification.verified) {
					const accessToken = await user.generateAuthToken();

					progress.push(id, {
						step: "retriving data",
						status: "start",
						detail: "Fetching User's Information",
					});

					const clientUser = {
						username: user.username,
						linkedAccounts: user.linkedAccounts,
						userId: user.userId,
						passkey: user.passkey.publicKey,
						address: user.address,
						email: user.email || null,
						emailVerified: user.emailVerified || false,
						twitterId: user.twitterId || null,
						twitterProfile: user.twitterProfile || null,
						discordId: user.discordId || null,
						discordProfile: user.discordProfile || null,
						telegramId: user.telegramId || null,
						telegramUsername: user.telegramUsername || null,
					};

					progress.push(id, {
						step: "account login",
						status: "done",
						detail: "Login verification successful",
					});

					console.log("the access token", accessToken);

					res.clearCookie("authInfo");
					return res.json({
						verified: verification.verified,
						accessToken: accessToken,
						userProfile: clientUser,
					});
				}
			}
		}

		console.log("Find 1", {
			response: authData,
			expectedChallenge: authInfo.challenge,
			expectedOrigin: expectedOrigin,
			expectedRPID: rp_id,
		});

		const verification = await verifyRegistrationResponse({
			response: authData,
			expectedChallenge: authInfo.challenge,
			expectedOrigin: expectedOrigin,
			expectedRPID: rp_id,
		});

		progress.push(id, {
			step: "new account verification",
			status: "start",
			detail: "Verifying Account Creation Credentials",
		});

		if (verification.verified) {
			const blsKeysData = [];
			const resultingPk = verification.registrationInfo.credentialPublicKey;

			const passkeyBuffer = Buffer.from(resultingPk, "hex");
			progress.push(id, {
				step: "key generation",
				status: "start",
				detail: "Generating Wallet BLS Keys",
			});

			for (let i = 0; i < nodes.length; i++) {
				const blsKey = await nodeInitGenKey(nodes[i].url, network);
				blsKeysData.push(blsKey);
			}

			if (nodes.length !== blsKeysData.length) {
				return res.status(400).json({
					error: `Incomplete BLS Keys initialization, ${blsKeysData.length} of ${nodes.length}`,
				});
			}

			const blsBuffers = blsKeysData.map((blsKeypair) =>
				Buffer.from(blsKeypair.publicKey, "hex"),
			);

			const args = [
				{ value: authInfo.username, type: "scSpecTypeString" },
				{ value: passkeyBuffer, type: "scSpecTypeBytes" },
				{
					value: blsBuffers,
					type: "scSpecTypeBytes",
				},
			];

			progress.push(id, {
				step: "contract deployment",
				status: "start",
				detail: "Deploying Account Contract",
			});

			const smartWalletAddress = await createContract(network, args);

			if (!smartWalletAddress) {
				return res.status(400).json({
					error: `An Error occured while creating smart wallet contract, try again later!`,
				});
			}

			progress.push(id, {
				step: "Account Profile",
				status: "start",
				detail: "Creating User Profile",
			});

			await createUser(
				authInfo.username,
				Buffer.from(verification.registrationInfo.credentialID).toString("hex"),
				{
					id: Buffer.from(verification.registrationInfo.credentialID).toString(
						"hex",
					),
					publicKey: Buffer.from(
						verification.registrationInfo.credentialPublicKey,
					).toString("hex"),
					counter: verification.registrationInfo.counter,
					deviceType: verification.registrationInfo.credentialDeviceType,
					backedUp: verification.registrationInfo.credentialBackedUp,
					transports: req.body.transports,
				},

				smartWalletAddress,
				network,
			);

			const user = await getUserByUsername(authInfo.username);

			for (let i = 0; i < blsKeysData.length; i++) {
				if (user) {
					await nodeCreateSuccess(
						blsKeysData[i].successCallback,
						user?.passkey?.publicKey,
						user?.address[network],
					);
				} else {
					await nodeCreateFailure(blsKeysData[i].failureCallback);
				}
			}

			const accessToken = await user.generateAuthToken();

			const clientUser = {
				username: user.username,
				linkedAccounts: user.linkedAccounts,
				userId: user.userId,
				address: user.address,
				email: user.email || null,
				emailVerified: user.emailVerified || false,
				twitterId: user.twitterId || null,
				twitterProfile: user.twitterProfile || null,
			};

			progress.push(id, {
				step: "Account Creation",
				status: "done",
				detail: "Account Creation Successful",
			});
			res.clearCookie("authInfo");

			return res.json({
				verified: verification.verified,
				accessToken: accessToken,
				userProfile: clientUser,
			});
		}
	} catch (e) {
		console.error("FULL VERIFY ERROR:", e);
		progress.push(id, {
			step: "Verification Error",
			status: "error",
			detail: "Verifying Login Failed",
		});

		return res
			.status(400)
			.json({ verified: false, error: "Verification failed" });
	}
});

app.post("/init-add-email", async (req, res) => {
	const { email } = req.body;

	if (!email) {
		return res.status(400).json({ error: "email is required" });
	}

	const normalizedEmail = String(email).trim().toLowerCase();

	const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
	if (!emailRegex.test(normalizedEmail)) {
		return res.status(400).json({ error: "Invalid email format" });
	}

	const authHeader = req.headers["authorization"];
	if (!authHeader) {
		return res.status(401).json({ error: "Authorization header is missing" });
	}

	const accessToken = authHeader.split(" ")[1];
	let accessVerification;
	try {
		accessVerification = authenticateToken(accessToken);
	} catch (e) {
		return res.status(401).json({ error: "Invalid token" });
	}

	const { userId } = accessVerification;
	// const userId = "jhfkjfkfjflkflkf";

	const existing = await EmailVerification.findOne({
		userId,
		email: normalizedEmail,
	}).lean();

	if (!existing) {
		const alreadyVerified = await UserAccount.findOne({
			email: normalizedEmail,
		}).lean();

		if (alreadyVerified && alreadyVerified.userId !== userId) {
			return res.status(409).json({ error: "This email is taken" });
		}
	}

	const otp = String(randomInt(100000, 999999));
	const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

	await EmailVerification.findOneAndUpdate(
		{ userId, email: normalizedEmail },
		{ otp, expiresAt, attempts: 0 },
		{ upsert: true, setDefaultsOnInsert: true },
	);

	try {
		await sendOtpEmail(normalizedEmail, otp);
	} catch (e) {
		console.error(
			"[init-add-email] Failed to send OTP email:",
			e?.message || e?.code || e,
		);
		return res
			.status(500)
			.json({ error: "Failed to send verification email", detail: e?.message });
	}

	return res.json({ message: "Verification code sent" });
});

app.post("/verify-email", async (req, res) => {
	const { email, otp } = req.body;

	if (!email || !otp) {
		return res.status(400).json({ error: "email and otp are required" });
	}

	const normalizedEmail = String(email).trim().toLowerCase();

	const authHeader = req.headers["authorization"];
	if (!authHeader) {
		return res.status(401).json({ error: "Authorization header is missing" });
	}

	const accessToken = authHeader.split(" ")[1];
	let accessVerification;
	try {
		accessVerification = authenticateToken(accessToken);
	} catch (e) {
		return res.status(401).json({ error: "Invalid token" });
	}

	const { userId } = accessVerification;

	// const userId = "jhfkjfkfjflkflkf";

	const verification = await EmailVerification.findOne({
		userId,
		email: normalizedEmail,
	}).lean();

	if (!verification) {
		return res
			.status(404)
			.json({ error: "No pending verification for this email" });
	}

	if (new Date() > verification.expiresAt) {
		await EmailVerification.deleteOne({ userId, email: normalizedEmail });
		return res
			.status(410)
			.json({ error: "Verification code has expired. Request a new one." });
	}

	if (verification.attempts >= 5) {
		await EmailVerification.deleteOne({ userId, email: normalizedEmail });
		return res
			.status(429)
			.json({ error: "Too many failed attempts. Request a new code." });
	}

	if (verification.otp !== otp) {
		await EmailVerification.updateOne(
			{ userId, email: normalizedEmail },
			{ $inc: { attempts: 1 } },
		);
		return res.status(400).json({ error: "Invalid verification code" });
	}

	await UserAccount.updateOne(
		{ userId },
		{ email: normalizedEmail, emailVerified: true },
	);
	await EmailVerification.deleteOne({ userId, email: normalizedEmail });

	return res.json({ message: "Email verified and added successfully" });
});

app.get("/init-twitter-auth", async (req, res) => {
	const { token } = req.query;
	if (!token) {
		return res.status(401).json({ error: "token query param is required" });
	}
	let accessVerification;
	try {
		accessVerification = authenticateToken(token);
	} catch (e) {
		return res.status(401).json({ error: "Invalid token" });
	}

	console.log({ accessVerification });

	const { userId } = accessVerification;

	req.session.twitter_auth_context = { userId };

	passport.authenticate("twitter")(req, res, (err, user, info) => {
		if (err) {
			console.error("[init-twitter-auth] Passport error:", err);
			return res
				.status(500)
				.json({ error: "Unexpected passport error", detail: err.message });
		}
		if (!user) {
			console.error("[init-twitter-auth] No user returned:", info);
			return res
				.status(500)
				.json({ error: "Unexpected passport error", detail: "no user" });
		}
	});
});

// app.get("/init-twitter-auth", async (req, res) => {
// 	const { token } = req.query;

// 	if (!token) {
// 		return res.status(401).json({ error: "token required" });
// 	}

// 	let accessVerification;
// 	try {
// 		accessVerification = authenticateToken(token);
// 	} catch (e) {
// 		return res.status(401).json({ error: "Invalid token" });
// 	}

// 	const { userId } = accessVerification;

// 	// 🔥 Create short-lived state token
// 	const state = jwt.sign(
// 		{ userId },
// 		process.env.JWT_SECRET,
// 		{ expiresIn: "5m" }, // short expiry
// 	);

// 	console.log({ state });

// 	// 🔥 Pass state into OAuth
// 	passport.authenticate("twitter", {
// 		state,
// 	})(req, res);
// });

// app.get("/init-discord-auth", async (req, res) => {
// 	if (!process.env.DISCORD_CLIENT_ID || !process.env.DISCORD_CLIENT_SECRET) {
// 		console.error(
// 			"[init-discord-auth] Missing DISCORD_CLIENT_ID or DISCORD_CLIENT_SECRET",
// 		);
// 		return res.status(500).json({ error: "Discord OAuth not configured" });
// 	}

// 	const { token } = req.query;

// 	if (!token) {
// 		return res
// 			.status(401)
// 			.json({ error: "accessToken query param is required" });
// 	}

// 	let accessVerification;
// 	try {
// 		accessVerification = authenticateToken(token);
// 	} catch (e) {
// 		return res.status(401).json({ error: "Invalid token" });
// 	}

// 	const { userId } = accessVerification;

// 	// const userId = "jhfkjfkfjflkflkf";

// 	req.session.discord_auth_context = { userId };

// 	passport.authenticate("discord")(req, res, (err, user, info) => {
// 		if (err) {
// 			console.error("[init-discord-auth] Passport error:", err);
// 			return res
// 				.status(500)
// 				.json({ error: "Unexpected passport error", detail: err.message });
// 		}
// 		if (!user) {
// 			console.error("[init-discord-auth] No user returned:", info);
// 			return res
// 				.status(500)
// 				.json({ error: "Unexpected passport error", detail: "no user" });
// 		}
// 	});
// });

app.get("/init-discord-auth", async (req, res) => {
	const { token } = req.query;

	if (!token) {
		return res.status(401).json({ error: "token required" });
	}

	let accessVerification;
	try {
		accessVerification = authenticateToken(token);
	} catch (e) {
		return res.status(401).json({ error: "Invalid token" });
	}

	const { userId } = accessVerification;

	// 🔥 Create short-lived state token
	const state = jwt.sign(
		{ userId },
		process.env.JWT_SECRET,
		{ expiresIn: "5m" }, // short expiry
	);

	console.log({ state });

	// 🔥 Pass state into OAuth
	passport.authenticate("discord", {
		state,
	})(req, res);
});

app.post("/init-telegram-link", async (req, res) => {
	const { username } = req.body;

	if (!username) {
		return res.status(400).json({ error: "username is required" });
	}

	const usernameRegex = /^[a-zA-Z0-9_]{5,32}$/;
	if (!usernameRegex.test(username)) {
		return res.status(400).json({
			error:
				"Invalid Telegram username format. Must be 5-32 characters, alphanumeric with underscores only.",
		});
	}

	const authHeader = req.headers["authorization"];
	if (!authHeader) {
		return res.status(401).json({ error: "Authorization header is missing" });
	}

	const accessToken = authHeader.split(" ")[1];
	let accessVerification;
	try {
		accessVerification = authenticateToken(accessToken);
	} catch (e) {
		return res.status(401).json({ error: "Invalid token" });
	}

	const { userId } = accessVerification;
	// const userId = "jhfkjfkfjflkflkf";

	const normalizedUsername = String(username).trim().toLowerCase();

	const alreadyLinked = await UserAccount.findOne({
		telegramUsername: normalizedUsername,
	}).lean();

	if (alreadyLinked && alreadyLinked.userId !== userId) {
		return res.status(409).json({
			error: "This Telegram account is already linked to another user",
		});
	}

	const existingPending = await TelegramLinking.findOne({
		userId,
		status: "PENDING",
	}).lean();

	if (existingPending) {
		if (
			existingPending.telegramUsername === normalizedUsername &&
			new Date(existingPending.expiresAt) > new Date()
		) {
			return res.json({
				pendingId: existingPending._id,
				expiresAt: existingPending.expiresAt,
				message:
					"Pending linking request already exists. Go to the bot and press /start.",
			});
		}
		await TelegramLinking.deleteOne({ _id: existingPending._id });
	}

	await TelegramLinking.deleteMany({ userId, status: "OTP_SENT" });

	const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

	await TelegramLinking.findOneAndUpdate(
		{ userId, telegramUsername: normalizedUsername },
		{
			userId,
			telegramUsername: normalizedUsername,
			status: "PENDING",
			expiresAt,
		},
		{ upsert: true, setDefaultsOnInsert: true, new: true },
	);

	return res.json({
		pendingId: existingPending?._id,
		expiresAt,
		message:
			"Telegram linking initiated. Please go to the bot and press /start.",
	});
});

app.post("/verify-telegram-otp", async (req, res) => {
	const { otp } = req.body;

	if (!otp) {
		return res.status(400).json({ error: "otp is required" });
	}

	const authHeader = req.headers["authorization"];
	if (!authHeader) {
		return res.status(401).json({ error: "Authorization header is missing" });
	}

	const accessToken = authHeader.split(" ")[1];
	let accessVerification;
	try {
		accessVerification = authenticateToken(accessToken);
	} catch (e) {
		return res.status(401).json({ error: "Invalid token" });
	}

	const { userId } = accessVerification;

	const verification = await TelegramLinking.findOne({
		userId,
		otpCode: String(otp).trim(),
		status: "OTP_SENT",
	}).lean();

	if (!verification) {
		return res.json({ success: false, error: "Invalid or expired OTP" });
	}

	if (new Date() > verification.expiresAt) {
		await TelegramLinking.deleteOne({ _id: verification._id });
		return res.json({ success: false, error: "OTP has expired" });
	}

	if (!verification.telegramUsername || !verification.telegramChatId) {
		await TelegramLinking.deleteOne({ _id: verification._id });
		return res.json({
			success: false,
			error: "Telegram account not found. Please try again.",
		});
	}

	const user = await UserAccount.findOne({ userId }).lean();
	if (!user) {
		await TelegramLinking.deleteOne({ _id: verification._id });
		return res.json({ success: false, error: "User not found" });
	}

	if (user.telegramId) {
		await TelegramLinking.deleteOne({ _id: verification._id });
		return res.json({
			success: false,
			error: "Telegram account already linked",
		});
	}

	await UserAccount.updateOne(
		{ userId },
		{
			telegramId: verification.telegramChatId,
			telegramUsername: verification.telegramUsername,
			telegramChatId: verification.telegramChatId,
		},
	);

	await TelegramLinking.deleteOne({ _id: verification._id });

	return res.json({
		success: true,
		message: "Telegram account linked successfully",
	});
});

app.post("/telegram/webhook", async (req, res) => {
	const update = req.body;

	console.log("[telegram-webhook] Received:", JSON.stringify(update));

	try {
		if (!update.message || !update.message.text) {
			return res.json({ ok: true });
		}

		const chatId = String(update.message.chat.id);
		const username = update.message.from?.username?.toLowerCase();
		const firstName = update.message.from?.first_name;
		const text = update.message.text.trim();

		console.log("[telegram-webhook] ChatId:", chatId, "Username:", username, "Text:", text);

		if (!text.startsWith("/start")) {
			return res.json({ ok: true });
		}

		if (!username) {
			await require("./services/telegram-service").sendTelegramMessage(
				chatId,
				`👋 Welcome to SocketFi${
					firstName ? `, ${firstName}` : ""
				}!\n\nTo link your Telegram account, please go to the app and initiate the linking process.`,
			);
			return res.json({ ok: true });
		}

		const pendingRequest = await TelegramLinking.findOne({
			telegramUsername: username,
			status: "PENDING",
		}).lean();

		console.log("[telegram-webhook] Pending request:", pendingRequest);

		if (!pendingRequest || new Date(pendingRequest.expiresAt) < new Date()) {
			await require("./services/telegram-service").sendTelegramMessage(
				chatId,
				`👋 Welcome to SocketFi${
					firstName ? `, ${firstName}` : ""
				}!\n\nTo link your Telegram account, please go to the app and initiate the linking process.`,
			);
			return res.json({ ok: true });
		}

		const existingOtpSent = await TelegramLinking.findOne({
			telegramUsername: username,
			status: "OTP_SENT",
		}).lean();

		if (existingOtpSent && new Date(existingOtpSent.expiresAt) > new Date()) {
			await require("./services/telegram-service").sendTelegramMessage(
				chatId,
				`⏰ You already have an OTP sent. Please check your messages and enter the code in the app.\n\nIf you need a new OTP, please initiate a new linking request from the app.`,
			);
			return res.json({ ok: true });
		}

		if (existingOtpSent) {
			await TelegramLinking.deleteOne({ _id: existingOtpSent._id });
		}

		const otp = String(randomInt(100000, 999999));
		const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

		await TelegramLinking.findOneAndUpdate(
			{ _id: pendingRequest._id },
			{
				otpCode: otp,
				telegramChatId: chatId,
				status: "OTP_SENT",
				expiresAt,
			},
		);

		console.log(`[telegram-webhook] OTP generated for ${username}: ${otp}`);

		await require("./services/telegram-service").sendOtpToTelegram(chatId, otp);

		return res.json({ ok: true });
	} catch (error) {
		console.error("[telegram-webhook] Error:", error.message);
		return res.status(500).json({ ok: false, error: error.message });
	}
});

app.get("/telegram/set-webhook", async (req, res) => {
	try {
		const response = await axios.post(process.env.TELEGRAM_WEBHOOK_ENDPOINT, {
			url: process.env.TELEGRAM_WEBHOOK_URL,
		});

		console.log(response.data.description);
		res.json({ response: response.data.description });
	} catch (error) {
		console.error(`⚠️ Failed to set Telegram webhook: ${error}`);
		res.status(500).json({ error: error.message });
	}
});

app.get("/telegram/get-webhook-info", async (req, res) => {
	try {
		const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
		const response = await axios.get(`https://api.telegram.org/bot${BOT_TOKEN}/getWebhookInfo`);
		res.json(response.data);
	} catch (error) {
		console.error(`⚠️ Failed to get webhook info: ${error}`);
		res.status(500).json({ error: error.message });
	}
});

//Activates (creates) account on a given network
//If the user already has an account on a network
// and want to create an account on another network,
//this endpoint initializes it
app.post("/init-activate-account", async (req, res) => {
	try {
		const { network } = req.body;

		if (!network) {
			return res
				.status(400)
				.json({ error: "Network is required for this request" });
		}

		const authHeader = req.headers["authorization"];

		if (!authHeader) {
			return res.status(401).json({ error: "Authorization header is missing" });
		}

		const accessToken = authHeader.split(" ")[1];

		const accessVerification = authenticateToken(accessToken);

		const user = await getUserByUsername(accessVerification.username);

		if (!user) {
			return res
				.status(400)
				.json({ error: "No user found or invalid access token" });
		}

		const options = await generateAuthenticationOptions({
			rpID: rp_id,
			allowCredentials: [
				{
					id: new Uint8Array(Buffer.from(user.passkey.id, "hex")),
					type: "public-key",
					transports: user.passkey.transports,
				},
			],
		});

		progress.push(user.id, {
			step: "initialization",
			status: "start",
			detail: "Account Activation initialized",
		});

		res.cookie(
			"activateInfo",
			JSON.stringify({
				userId: user.id,
				username: user.username.toLowerCase(),
				data: encodeData({ network }),
				challenge: options.challenge,
			}),
			{ httpOnly: true, maxAge: 60000, secure: true, sameSite: sameSiteConfig },
		);
		res.json({ options: options, signActivation: true, id: user.id });
	} catch (error) {
		console.error(
			"Error:",
			error.response ? error.response.data : error.message,
		);
	}
});

app.post("/activate-account", async (req, res) => {
	try {
		const { network, activationData, txDetails = null } = req.body;

		if (!network || !activationData) {
			return res.status(400).json({ error: "request body is incomplete" });
		}

		const activationInfo = JSON.parse(req.cookies.activateInfo);
		if (!activationInfo) {
			return res.status(400).json({ error: "Signature info not found" });
		}

		const authHeader = req.headers["authorization"];

		if (!authHeader) {
			return res.status(401).json({ error: "Authorization header is missing" });
		}

		const accessToken = authHeader.split(" ")[1];

		const accessVerification = authenticateToken(accessToken);

		const user = await getUserByUsername(accessVerification.username);

		if (!user) {
			return res
				.status(400)
				.json({ error: "No user found or user not authorized" });
		}

		const areEqual =
			Buffer.from(
				new Uint8Array(Buffer.from(user?.passkey?.id, "hex")),
			).compare(Buffer.from(base64UrlToUint8Array(activationData.id))) === 0;

		if (!areEqual) {
			return res.status(400).json({ error: "Invalid signature data received" });
		}

		const verification = await verifyAuthenticationResponse({
			response: activationData,
			expectedChallenge: activationInfo.challenge,
			expectedOrigin: expectedOrigin,
			expectedRPID: rp_id,
			authenticator: {
				credentialID: new Uint8Array(Buffer.from(user?.passkey?.id, "hex")),
				credentialPublicKey: new Uint8Array(
					Buffer.from(user?.passkey?.publicKey, "hex"),
				),
				counter: user.passkey.counter,
				transports: user.passkey.transports,
			},
		});

		if (verification.verified) {
			const blsKeysData = [];

			// return;
			const passkeyBuffer = Buffer.from(user.passkey?.publicKey, "hex");
			progress.push(user?.id, {
				step: "key generation",
				status: "start",
				detail: "Generating Wallet BLS Keys",
			});

			for (let i = 0; i < nodes.length; i++) {
				const blsKey = await nodeInitGenKey(nodes[i].url, network);
				blsKeysData.push(blsKey);
			}

			if (nodes.length !== blsKeysData.length) {
				return res.status(400).json({
					error: `Incomplete BLS Keys initialization, ${blsKeysData.length} of ${nodes.length}`,
				});
			}

			const blsBuffers = blsKeysData.map((blsKeypair) =>
				Buffer.from(blsKeypair.publicKey, "hex"),
			);

			const args = [
				{ value: user.username, type: "scSpecTypeString" },
				{ value: passkeyBuffer, type: "scSpecTypeBytes" },
				{
					value: blsBuffers,
					type: "scSpecTypeBytes",
				},
			];

			progress.push(user?.id, {
				step: "contract deployment",
				status: "start",
				detail: "Deploying Account Contract",
			});

			const smartWalletAddress = await createContract(network, args);

			if (!smartWalletAddress) {
				return res.status(400).json({
					error: `An Error occured while creating smart wallet contract, try again later!`,
				});
			}
			progress.push(user?.id, {
				step: "Updating Profile",
				status: "start",
				detail: "Updating User Profile",
			});

			await attachContractToUser(user.userId, smartWalletAddress, network);

			const updatedUser = await getUserByUsername(accessVerification.username);

			for (let i = 0; i < blsKeysData.length; i++) {
				if (user) {
					await nodeCreateSuccess(
						blsKeysData[i].successCallback,
						user?.passkey?.publicKey,
						smartWalletAddress,
					);
				} else {
					await nodeCreateFailure(blsKeysData[i].failureCallback);
				}
			}

			const clientUser = {
				username: updatedUser.username,
				linkedAccounts: updatedUser.linkedAccounts,
				userId: updatedUser.userId,
				passkey: updatedUser.passkey.publicKey,
				address: updatedUser.address,
				email: updatedUser.email || null,
				emailVerified: updatedUser.emailVerified || false,
				twitterId: updatedUser.twitterId || null,
				twitterProfile: updatedUser.twitterProfile || null,
				discordId: updatedUser.discordId || null,
				discordProfile: updatedUser.discordProfile || null,
				telegramId: updatedUser.telegramId || null,
				telegramUsername: updatedUser.telegramUsername || null,
			};

			progress.push(user?.id, {
				step: "Account Creation",
				status: "done",
				detail: "Account Creation Successful",
			});
			res.clearCookie("activateInfo");

			return res.json({
				verification: verification.verified,
				userProfile: clientUser,
				accessToken: accessToken,
			});
		}
	} catch (error) {
		console.error(
			"Error:",
			error.response ? error.response.data : error.message,
		);
	}
});

app.post("/load-contract-specs", async (req, res) => {
	const { contractId, network } = req.body;

	if (!contractId || !network) {
		return res
			.status(400)
			.json({ error: "Contract ID and network are  required" });
	}

	try {
		const server = RpcServer(network, "json");
		const spec = await server.getContractSpec(contractId);

		res.status(200).json({
			message: "contract specs loaded successfully",
			spec: spec,
		});
	} catch (error) {
		console.error(
			"Error:",
			error.response ? error.response.data : error.message,
		);

		return res.status(400).json({
			error: error.response ? error.response.data : error.message,
		});
	}
});

app.post("/access-load-wallet", async (req, res) => {
	const { wallet, username, network } = req.body;

	if ((!wallet && !network) || (!username && !network)) {
		return res
			.status(400)
			.json({ error: "wallet address or username and network are  required" });
	}

	try {
		let user;
		if (wallet && network) {
			user = await findUserByAddress(wallet, { network: network });
			if (!user) {
				return res.status(400).json({
					error: "No account found with the entered wallet address.",
				});
			}
		} else if (username && network) {
			user = await getUserByUsername(username);
			if (!user) {
				return res.status(400).json({
					error: "No account found with the entered username.",
				});
			}
		}
		const server = RpcServer(network, "json");
		const spec = await server.getContractSpec(user.address[network]);

		res.status(200).json({
			message: "contract specs loaded successfully",
			spec: spec,
			wallet: user.address[network],
		});
	} catch (error) {
		console.error(
			"Error:",
			error.response ? error.response.data : error.message,
		);

		return res.status(400).json({
			error: error.response ? error.response.data : error.message,
		});
	}
});

app.post("/any-invoke-external", async (req, res) => {
	const {
		pubKey,
		contractId,
		network,
		callFunction,
		memo = "",
		sId = "",
	} = req.body;

	console.dir(req.body, { depth: null });
	console.log("the body", req.body);

	try {
		// 🔹 Notify start
		progress.push(sId, {
			step: "transaction creation",
			status: "start",
			detail: "Creating transaction...",
		});

		// 🔹 Validate request
		if (!pubKey || !network || !contractId || !callFunction) {
			progress.push(sId, {
				step: "transaction creation",
				status: "error",
				detail: "Request body is incomplete",
			});
			return res.status(400).json({ error: "Request body is incomplete" });
		}

		// 🔹 Build invoke args
		const invokeArgs = [callFunction.name];
		for (const eachArg of callFunction?.inputs || []) {
			if (eachArg?.type === "Wasm") {
				const wasmUpload = bufferStorage[pubKey];
				if (!wasmUpload) {
					throw new Error("Wasm upload not found in bufferStorage");
				}
				invokeArgs.push(StellarSdk.nativeToScVal(wasmUpload));
				delete bufferStorage[pubKey];
			} else {
				invokeArgs.push(processArgs(eachArg));
			}
		}

		// 🔹 Notify args prepared
		progress.push(sId, {
			step: "transaction creation",
			status: "progress",
			detail: "Arguments prepared, building transaction...",
		});

		// 🔹 Build transaction
		const server = RpcServer(network, "json");
		const source = await server.getAccount(pubKey);
		const contract = new StellarSdk.Contract(contractId);

		const txBuilderAny = new StellarSdk.TransactionBuilder(source, {
			fee: BASE_FEE,
			networkPassphrase: StellarSdk.Networks[network],
		})
			.setTimeout(StellarSdk.TimeoutInfinite)
			.addOperation(contract.call(...invokeArgs));

		if (memo?.length > 0) {
			txBuilderAny.addMemo(StellarSdk.Memo.text(memo));
		}

		const txBuilder = txBuilderAny.build().toXDR();

		// 🔹 Notify transaction built
		progress.push(sId, {
			step: "transaction creation",
			status: "progress",
			detail: "Transaction built, preparing with server...",
		});

		const preparedTransaction = await server.prepareTransaction(txBuilder);

		// 🔹 Notify success
		progress.push(sId, {
			step: "transaction submission",
			status: "progress",
			detail: "Signing Prepared Transaction",
			txXdr: preparedTransaction,
		});

		if (callFunction.name === "deposit") {
			const user = await findUserByAddress(contractId, { network: network });
			await TokenList.addTokenToList(
				user.userId,
				network,
				callFunction.inputs[1].value,
			);
		}

		// 🔹 Send response back to client
		res.status(200).json({
			message: "Prepare invoke external successful",
			xdr: preparedTransaction,
		});
	} catch (error) {
		console.error(
			"Error:",
			error.response ? error.response.data : error.message,
		);

		// 🔹 Notify error
		progress.push(sId, {
			step: "transaction creation",
			status: "error",
			detail: error.message || "Transaction Creation Failed",
		});

		return res.status(400).json({
			error: error.response ? error.response.data : error.message,
		});
	}
});

app.post("/submit-transaction-external", async (req, res) => {
	const { signedTx, network, txDetails = null, sId = "" } = req.body;

	console.dir(req.body, { depth: null });

	if (!signedTx || !network) {
		return res
			.status(400)
			.json({ error: "signed transaction and network required" });
	}

	try {
		progress.push(sId, {
			step: "transaction submission",
			status: "start",
			detail: "Submitting Transaction",
		});
		const server = RpcServer(network, "json");

		const sendResponse = await server.sendTransaction(signedTx);

		if (sendResponse) {
			if (txDetails) {
				await recordTransaction({ ...txDetails, txId: sendResponse?.txHash });
			}

			progress.push(sId, {
				step: "transaction submission",
				status: "done",
				detail: "Transaction Submission Successful",
				eid: `txHash_${sendResponse?.txHash}`,
			});

			res.status(200).json({
				message: "transaction submited",
				data: sendResponse,
			});
		}
	} catch (error) {
		console.error(
			"Error:",
			error.response ? error.response.data : error.message,
		);
	}
});

app.post("/init-sign-transaction", async (req, res) => {
	try {
		const { contractId, network, callFunction, sId = "" } = req.body;

		if (!network || !contractId || !callFunction) {
			progress.push(sId, {
				step: "transaction authentication",
				status: "error",
				detail: "Request body is incomplete",
			});
			return res.status(400).json({ error: "request body is incomplete" });
		}

		const authHeader = req.headers["authorization"];

		if (!authHeader) {
			progress.push(sId, {
				step: "transaction authentication",
				status: "error",
				detail: "Authorization header is missing",
			});
			return res.status(401).json({ error: "Authorization header is missing" });
		}

		progress.push(sId, {
			step: "transaction authentication",
			status: "start",
			detail: "Retrieving User Details...",
		});
		const accessToken = authHeader.split(" ")[1];

		const accessVerification = authenticateToken(accessToken);

		const user = await getUserByUsername(accessVerification.username);

		if (!user) {
			progress.push(sId, {
				step: "transaction authentication",
				status: "error",
				detail: "No user found or user not authorized",
			});
			return res
				.status(400)
				.json({ error: "No user found or user not authorized" });
		}

		progress.push(sId, {
			step: "transaction authentication",
			status: "progress",
			detail: "Authenticating User Credentials...",
		});

		const options = await generateAuthenticationOptions({
			rpID: rp_id,
			allowCredentials: [
				{
					id: new Uint8Array(Buffer.from(user.passkey.id, "hex")),
					type: "public-key",
					transports: user.passkey.transports,
				},
			],
		});

		res.cookie(
			"signInfo",
			JSON.stringify({
				userId: user.userId,
				username: user.username.toLowerCase(),
				data: encodeData({ contractId, network, callFunction }),
				challenge: options.challenge,
			}),
			{ httpOnly: true, maxAge: 60000, secure: true, sameSite: sameSiteConfig },
		);

		progress.push(sId, {
			step: "transaction authentication",
			status: "progress",
			detail: "User Authentication Initialized",
		});
		res.json({ options: options, signAccess: true });
	} catch (error) {
		console.error(
			"Error:",
			error.response ? error.response.data : error.message,
		);
		progress.push(sId, {
			step: "transaction authentication",
			status: "error",
			detail: response
				? error.response.data
				: error.message || "No user found or user not authorized",
		});
		return res
			.status(400)
			.json({ error: "No user found or user not authorized" });
	}
});

app.post("/any-invoke-with-sig", async (req, res) => {
	const {
		contractId,
		network,
		callFunction,
		sigData,
		txDetails = null,
		sId = "",
	} = req.body;
	try {
		progress.push(sId, {
			step: "transaction creation",
			status: "start",
			detail: "Transaction Creation Started",
		});

		if (!network || !contractId || !callFunction || !sigData) {
			progress.push(sId, {
				step: "transaction creation",
				status: "error",
				detail: "Request body is incomplete",
			});
			return res.status(400).json({ error: "request body is incomplete" });
		}

		const signInfo = JSON.parse(req.cookies.signInfo);
		if (!signInfo) {
			progress.push(sId, {
				step: "transaction creation",
				status: "error",
				detail: "Signature info not found",
			});
			return res.status(400).json({ error: "Signature info not found" });
		}

		const authHeader = req.headers["authorization"];

		if (!authHeader) {
			progress.push(sId, {
				step: "transaction creation",
				status: "error",
				detail: "Authorization header is missing",
			});
			return res.status(401).json({ error: "Authorization header is missing" });
		}

		const accessToken = authHeader.split(" ")[1];
		progress.push(sId, {
			step: "transaction creation",
			status: "progress",
			detail: "Account Access Verification ",
		});

		const accessVerification = authenticateToken(accessToken);

		const user = await getUserByUsername(accessVerification.username);

		if (!user) {
			progress.push(sId, {
				step: "transaction creation",
				status: "error",
				detail: "No user found or user not authorized",
			});
			return res
				.status(400)
				.json({ error: "No user found or user not authorized" });
		}

		const areEqual =
			Buffer.from(
				new Uint8Array(Buffer.from(user?.passkey?.id, "hex")),
			).compare(Buffer.from(base64UrlToUint8Array(sigData.id))) === 0;

		if (!areEqual) {
			return res.status(400).json({ error: "Invalid signature data received" });
		}

		const verification = await verifyAuthenticationResponse({
			response: sigData,
			expectedChallenge: signInfo.challenge,
			expectedOrigin: expectedOrigin,
			expectedRPID: rp_id,
			authenticator: {
				credentialID: new Uint8Array(Buffer.from(user?.passkey?.id, "hex")),
				credentialPublicKey: new Uint8Array(
					Buffer.from(user?.passkey?.publicKey, "hex"),
				),
				counter: user.passkey.counter,
				transports: user.passkey.transports,
			},
		});

		if (verification.verified) {
			progress.push(sId, {
				step: "transaction creation",
				status: "progress",
				detail: "Transaction Approval Verification ",
			});

			const dataValid =
				encodeData({ contractId, network, callFunction }) === signInfo.data;

			if (
				user.username !== signInfo.username ||
				user.userId !== signInfo.userId ||
				!dataValid
			) {
				progress.push(sId, {
					step: "transaction creation",
					status: "error",
					detail: "Something wrong with signed transaction",
				});
				return res
					.status(400)
					.json({ error: "Something wrong with signed transaction" });
			}

			progress.push(sId, {
				step: "transaction creation",
				status: "progress",
				detail: "Fetching Transaction Nonce ",
			});

			const txNonceRes = await contractGet(
				internalSigner.publicKey(),
				network,
				contractId,
				"get_nonce",
				[],
			);

			const txNonce = txNonceRes?.results[0]?.returnValueJson?.bytes;

			progress.push(sId, {
				step: "transaction submission",
				status: "progress",
				detail: "Computing BLS Signatures",
			});

			const signatureAggregate = await signatureAggregator(
				network,
				user.passkey.publicKey,
				contractId,
				txNonce,
			);

			const args = [
				...callFunction?.inputs.slice(0, -1), // Exclude last element
				{ value: signatureAggregate, type: "scSpecTypeBytes" }, // Replace it
			];

			progress.push(sId, {
				step: "transaction submission",
				status: "progress",
				detail: "Submitting Signed Transaction",
			});

			const txResponse = await invokeContract(
				network,
				contractId,
				callFunction?.name,
				args,
			);

			if (!txResponse) {
				progress.push(sId, {
					step: "transaction creation",
					status: "error",
					detail: "Transaction Submission Failed",
				});
				return res.status(400).json({
					error: "Transaction Submission Failed",
				});
			} else if (txResponse && txDetails) {
				const txRecord = {
					...txDetails,
					txId: txResponse?.txHash,
					network: network,
				};

				await recordTransaction(txRecord);
				progress.push(sId, {
					step: "transaction submission",
					status: "done",
					detail: " Transaction Submission Successful",
					eid: `txHash_${txResponse?.txHash}`,
				});
			}

			res.status(200).json({
				message: "transaction successful",
				data: txResponse,
			});
		}
	} catch (error) {
		progress.push(sId, {
			step: "transaction creation",
			status: "error",
			detail: error.response
				? error.response.data
				: error.message || "Transaction Submission Failed",
		});
		return res.status(400).json({
			error: error.response ? error.response.data : error.message,
		});

		console.error(
			"Error:",
			error.response ? error.response.data : error.message,
		);
	}
});

app.post("/aqua-swap-with-sig", async (req, res) => {
	const {
		contractId,
		network,
		callFunction,
		sigData,
		txDetails = null,
		tokenIn,
		tokenOut,
		sId = "",
	} = req.body;
	try {
		if (!network || !contractId || !callFunction || !sigData) {
			progress.push(sId, {
				step: "user authentication",
				status: "error",
				detail: "Request body is incomplete",
			});
			return res.status(400).json({ error: "request body is incomplete" });
		}

		const signInfo = JSON.parse(req.cookies.signInfo);
		if (!signInfo) {
			progress.push(sId, {
				step: "user authentication",
				status: "error",
				detail: "Signature info not found",
			});
			return res.status(400).json({ error: "Signature info not found" });
		}

		const authHeader = req.headers["authorization"];

		if (!authHeader) {
			progress.push(sId, {
				step: "user authentication",
				status: "error",
				detail: "Authorization header is missing",
			});
			return res.status(401).json({ error: "Authorization header is missing" });
		}

		const accessToken = authHeader.split(" ")[1];

		progress.push(sId, {
			step: "user authentication",
			status: "start",
			detail: "Authenticating User Access",
		});

		const accessVerification = authenticateToken(accessToken);

		const user = await getUserByUsername(accessVerification.username);

		if (!user) {
			progress.push(sId, {
				step: "user authentication",
				status: "error",
				detail: "No user found or user not authorized",
			});
			return res
				.status(400)
				.json({ error: "No user found or user not authorized" });
		}

		const areEqual =
			Buffer.from(
				new Uint8Array(Buffer.from(user?.passkey?.id, "hex")),
			).compare(Buffer.from(base64UrlToUint8Array(sigData.id))) === 0;

		if (!areEqual) {
			progress.push(sId, {
				step: "transaction authentication",
				status: "error",
				detail: "Invalid signature data received",
			});
			return res.status(400).json({ error: "Invalid signature data received" });
		}

		const verification = await verifyAuthenticationResponse({
			response: sigData,
			expectedChallenge: signInfo.challenge,
			expectedOrigin: expectedOrigin,
			expectedRPID: rp_id,
			authenticator: {
				credentialID: new Uint8Array(Buffer.from(user?.passkey?.id, "hex")),
				credentialPublicKey: new Uint8Array(
					Buffer.from(user?.passkey?.publicKey, "hex"),
				),
				counter: user.passkey.counter,
				transports: user.passkey.transports,
			},
		});

		if (verification.verified) {
			const dataValid =
				encodeData({ contractId, network, callFunction }) === signInfo.data;

			if (
				user.username !== signInfo.username ||
				user.userId !== signInfo.userId ||
				!dataValid
			) {
				progress.push(sId, {
					step: "transaction authentication",
					status: "error",
					detail: "Something wrong with signed transaction",
				});
				return res
					.status(400)
					.json({ error: "Something wrong with signed transaction" });
			}

			const amount = toBaseUnits(tokenIn?.amount, Number(tokenIn?.decimals));
			progress.push(sId, {
				step: "transaction submission",
				status: "progress",
				detail: "Fetching Swap Path",
			});

			const swapData = await findSwapPathAqua(
				tokenIn?.contract,
				tokenOut?.contract,
				amount.toString(),
			);

			const swapsChain = StellarSdk.xdr.ScVal.fromXDR(
				swapData.swap_chain_xdr,
				"base64",
			);
			const tokenInScVal = StellarSdk.Address.contract(
				StrKey.decodeContract(tokenIn.contract),
			).toScVal();
			const tokenOutScVal = StellarSdk.Address.contract(
				StrKey.decodeContract(tokenOut.contract),
			).toScVal();
			const amountU128 = new StellarSdk.XdrLargeInt(
				"u128",
				Number(amount).toFixed(),
			).toU128();

			const amountWithSlippage = swapData.amount * 0.99; // slippage 1%
			const amountWithSlippageU128 = new StellarSdk.XdrLargeInt(
				"u128",
				amountWithSlippage.toFixed(),
			).toU128();

			const argsObj = {
				arg1: nativeToScVal(contractId, { type: "address" }),
				arg2: swapsChain,
				arg3: tokenInScVal,
				arg4: amountU128,
				arg5: amountWithSlippageU128,
			};

			const authObj = {
				contract: tokenInScVal,

				func: nativeToScVal("transfer", { type: "symbol" }),

				args: nativeToScVal([
					nativeToScVal(contractId, {
						type: "address",
					}),
					nativeToScVal(contracts.PUBLIC.AQUA, {
						type: "address",
					}),
					nativeToScVal(amount.toString(), { type: "i128" }),
				]),
			};

			const txNonceRes = await contractGet(
				internalSigner.publicKey(),
				network,
				contractId,
				"get_nonce",
				[],
			);

			progress.push(sId, {
				step: "transaction submission",
				status: "progress",
				detail: "Fetching Transaction Nonce",
			});

			const txNonce = txNonceRes?.results[0]?.returnValueJson?.bytes;

			progress.push(sId, {
				step: "transaction submission",
				status: "progress",
				detail: "Generating BLS Signatures",
			});

			const signatureAggregate = await signatureAggregator(
				network,
				user.passkey.publicKey,
				contractId,
				txNonce,
			);

			const args = [
				nativeToScVal(contracts.PUBLIC.AQUA, { type: "address" }),
				nativeToScVal("swap_chained", { type: "symbol" }),
				nativeToScVal(argsObj),
				nativeToScVal([nativeToScVal([nativeToScVal(authObj)])]),
				nativeToScVal(signatureAggregate, { type: "bytes" }),
			];

			progress.push(sId, {
				step: "transaction submission",
				status: "progress",
				detail: "Submiting Transaction Onchain",
			});

			const txResponse = await invokeContractScVal(
				network,
				contractId,
				callFunction,
				args,
			);

			if (!txResponse) {
				{
					progress.push(sId, {
						step: "transaction submission",
						status: "error",
						detail: "Transaction Submission Failed",
					});
					return res
						.status(400)
						.json({ error: "Transaction Submission Failed" });
				}
			} else {
				progress.push(sId, {
					step: "transaction submission",
					status: "done",
					detail: "Transaction Submitted Successfully",
					eid: `txHash_${txResponse?.txHash}`,
				});
				res.status(200).json({
					message: "transaction successful",
					data: txResponse,
				});

				await TokenList.addTokenToList(
					signInfo.userId,
					network,
					tokenOut?.contract,
				);

				if (txDetails) {
					const txRecord = {
						...txDetails,
						txId: txResponse?.txHash,
						tokenOut: tokenIn?.contract,
						symOut: tokenIn?.code,
						amountOut: tokenIn?.amount,

						tokenIn: tokenOut?.contract,
						symIn: tokenOut?.code,
						amountIn: tokenOut?.amount,
					};

					await recordTransaction(txRecord);
				}
			}
		}
	} catch (error) {
		progress.push(sId, {
			step: "aqua amm transaction",
			status: "error",
			detail: error.response ? error.response.data : error.message,
		});
		console.error(
			"Error:",
			error.response ? error.response.data : error.message,
		);
		return res.status(400).json({
			error: error.response ? error.response.data : error.message,
		});
	}
});

app.post("/soroswap-swap-with-sig", async (req, res) => {
	const {
		contractId,
		network,
		callFunction,
		sigData,
		txDetails = null,
		tokenIn,
		tokenOut,
		swapData = null,
		sId = "",
	} = req.body;
	try {
		if (!network || !contractId || !callFunction || !sigData) {
			progress.push(sId, {
				step: "user authentication",
				status: "error",
				detail: "Request body is incomplete",
			});
			return res.status(400).json({ error: "request body is incomplete" });
		}

		const signInfo = JSON.parse(req.cookies.signInfo);
		if (!signInfo) {
			progress.push(sId, {
				step: "user authentication",
				status: "error",
				detail: "Signature info not found",
			});
			return res.status(400).json({ error: "Signature info not found" });
		}

		const authHeader = req.headers["authorization"];

		if (!authHeader) {
			progress.push(sId, {
				step: "user authentication",
				status: "error",
				detail: "Authorization header is missing",
			});
			return res.status(401).json({ error: "Authorization header is missing" });
		}

		const accessToken = authHeader.split(" ")[1];

		progress.push(sId, {
			step: "user authentication",
			status: "start",
			detail: "Authenticating User Access",
		});

		const accessVerification = authenticateToken(accessToken);

		const user = await getUserByUsername(accessVerification.username);

		if (!user) {
			progress.push(sId, {
				step: "user authentication",
				status: "error",
				detail: "No user found or user not authorized",
			});
			return res
				.status(400)
				.json({ error: "No user found or user not authorized" });
		}

		const areEqual =
			Buffer.from(
				new Uint8Array(Buffer.from(user?.passkey?.id, "hex")),
			).compare(Buffer.from(base64UrlToUint8Array(sigData.id))) === 0;

		if (!areEqual) {
			progress.push(sId, {
				step: "transaction authentication",
				status: "error",
				detail: "Invalid signature data received",
			});
			return res.status(400).json({ error: "Invalid signature data received" });
		}

		const verification = await verifyAuthenticationResponse({
			response: sigData,
			expectedChallenge: signInfo.challenge,
			expectedOrigin: expectedOrigin,
			expectedRPID: rp_id,
			authenticator: {
				credentialID: new Uint8Array(Buffer.from(user?.passkey?.id, "hex")),
				credentialPublicKey: new Uint8Array(
					Buffer.from(user?.passkey?.publicKey, "hex"),
				),
				counter: user.passkey.counter,
				transports: user.passkey.transports,
			},
		});

		if (verification.verified) {
			const dataValid =
				encodeData({ contractId, network, callFunction }) === signInfo.data;

			if (
				user.username !== signInfo.username ||
				user.userId !== signInfo.userId ||
				!dataValid
			) {
				progress.push(sId, {
					step: "transaction authentication",
					status: "error",
					detail: "Something wrong with signed transaction",
				});
				return res
					.status(400)
					.json({ error: "Something wrong with signed transaction" });
			}

			const amount = toBaseUnits(tokenIn?.amount, Number(tokenIn?.decimals));
			progress.push(sId, {
				step: "transaction submission",
				status: "progress",
				detail: "Fetching Pair Router",
			});

			// const swapPath = await findSwapPathSoroswap(
			//   tokenIn?.contract,
			//   tokenOut?.contract,
			//   amount.toString()
			// );

			const tokenInScVal = StellarSdk.Address.contract(
				StrKey.decodeContract(tokenIn.contract),
			).toScVal();
			const tokenOutScVal = StellarSdk.Address.contract(
				StrKey.decodeContract(tokenOut.contract),
			).toScVal();
			const amountI128 = new StellarSdk.XdrLargeInt(
				"i128",
				Number(amount).toFixed(),
			).toI128();

			const amountMinI128 = new StellarSdk.XdrLargeInt(
				"i128",
				// Number("5000").toFixed()
				Number(swapData?.amountOutMin).toFixed(),
			).toI128();

			// console.log('')
			const argsObj = {
				arg1: amountI128,
				arg2: amountMinI128,
				arg3: nativeToScVal(swapData?.path, { type: "address" }),
				// arg3: nativeToScVal(swapPath, { type: "address" }),
				arg4: nativeToScVal(contractId, { type: "address" }),
				arg5: nativeToScVal(BigInt("17568169065194979733"), { type: "u64" }),
			};

			const pair = await contractGet(
				internalSigner.publicKey(),
				network,
				contracts.PUBLIC.SOROSWAP,
				"router_pair_for",
				[
					{ value: swapData?.path[0], type: "scSpecTypeAddress" },
					{ value: swapData?.path[1], type: "scSpecTypeAddress" },
					// { value: swapPath[0], type: "scSpecTypeAddress" },
					// { value: swapPath[1], type: "scSpecTypeAddress" },
				],
			);

			const pairAddress = pair?.results[0]?.returnValueJson?.address;

			const authObj = {
				contract: tokenInScVal,

				func: nativeToScVal("transfer", { type: "symbol" }),

				args: nativeToScVal([
					nativeToScVal(contractId, {
						type: "address",
					}),
					nativeToScVal(pairAddress, {
						type: "address",
					}),
					nativeToScVal(amount.toString(), { type: "i128" }),
				]),
			};

			const txNonceRes = await contractGet(
				internalSigner.publicKey(),
				network,
				contractId,
				"get_nonce",
				[],
			);

			progress.push(sId, {
				step: "transaction submission",
				status: "progress",
				detail: "Fetching Transaction Nonce",
			});

			const txNonce = txNonceRes?.results[0]?.returnValueJson?.bytes;

			progress.push(sId, {
				step: "transaction submission",
				status: "progress",
				detail: "Generating BLS Signatures",
			});

			const signatureAggregate = await signatureAggregator(
				network,
				user.passkey.publicKey,
				contractId,
				txNonce,
			);

			const args = [
				nativeToScVal(contracts.PUBLIC.SOROSWAP, { type: "address" }),
				nativeToScVal("swap_exact_tokens_for_tokens", { type: "symbol" }),
				nativeToScVal(argsObj),
				nativeToScVal([nativeToScVal([nativeToScVal(authObj)])]),

				nativeToScVal(signatureAggregate, { type: "bytes" }),
			];

			progress.push(sId, {
				step: "transaction submission",
				status: "progress",
				detail: "Submiting Transaction Onchain",
			});

			const txResponse = await invokeContractScVal(
				network,
				contractId,
				callFunction,
				args,
			);

			if (!txResponse) {
				{
					progress.push(sId, {
						step: "transaction submission",
						status: "error",
						detail: "Transaction Submission Failed",
					});
					return res
						.status(400)
						.json({ error: "Transaction Submission Failed" });
				}
			} else {
				progress.push(sId, {
					step: "transaction submission",
					status: "done",
					detail: "Transaction Submitted Successfully",
					eid: `txHash_${txResponse?.txHash}`,
				});
				res.status(200).json({
					message: "transaction successful",
					data: txResponse,
				});

				await TokenList.addTokenToList(
					signInfo.userId,
					network,
					tokenOut?.contract,
				);

				if (txDetails) {
					const txRecord = {
						...txDetails,
						txId: txResponse?.txHash,
						tokenOut: tokenIn?.contract,
						symOut: tokenIn?.code,
						amountOut: tokenIn?.amount,

						tokenIn: tokenOut?.contract,
						symIn: tokenOut?.code,
						amountIn: tokenOut?.amount,
					};

					await recordTransaction(txRecord);
				}
			}
		}
	} catch (error) {
		progress.push(sId, {
			step: "soroswap transaction",
			status: "error",
			detail: error.response ? error.response.data : error.message,
		});
		console.error(
			"Error:",
			error.response ? error.response.data : error.message,
		);
		return res.status(400).json({
			error: error.response ? error.response.data : error.message,
		});
	}
});

app.post("/upgrade-wallet-with-sig", async (req, res) => {
	const { contractId, network, callFunction, sigData, sId = "" } = req.body;
	try {
		if (!network || !contractId || !callFunction || !sigData) {
			progress.push(sId, {
				step: "user authentication",
				status: "error",
				detail: "Request body is incomplete",
			});
			return res.status(400).json({ error: "request body is incomplete" });
		}

		const signInfo = JSON.parse(req.cookies.signInfo);
		if (!signInfo) {
			progress.push(sId, {
				step: "user authentication",
				status: "error",
				detail: "Signature info not found",
			});
			return res.status(400).json({ error: "Signature info not found" });
		}

		const authHeader = req.headers["authorization"];

		if (!authHeader) {
			progress.push(sId, {
				step: "user authentication",
				status: "error",
				detail: "Authorization header is missing",
			});
			return res.status(401).json({ error: "Authorization header is missing" });
		}

		const accessToken = authHeader.split(" ")[1];

		progress.push(sId, {
			step: "user authentication",
			status: "start",
			detail: "Authenticating User Access",
		});

		const accessVerification = authenticateToken(accessToken);

		const user = await getUserByUsername(accessVerification.username);

		if (!user) {
			progress.push(sId, {
				step: "user authentication",
				status: "error",
				detail: "No user found or user not authorized",
			});
			return res
				.status(400)
				.json({ error: "No user found or user not authorized" });
		}

		const areEqual =
			Buffer.from(
				new Uint8Array(Buffer.from(user?.passkey?.id, "hex")),
			).compare(Buffer.from(base64UrlToUint8Array(sigData.id))) === 0;

		if (!areEqual) {
			progress.push(sId, {
				step: "transaction authentication",
				status: "error",
				detail: "Invalid signature data received",
			});
			return res.status(400).json({ error: "Invalid signature data received" });
		}

		const verification = await verifyAuthenticationResponse({
			response: sigData,
			expectedChallenge: signInfo.challenge,
			expectedOrigin: expectedOrigin,
			expectedRPID: rp_id,
			authenticator: {
				credentialID: new Uint8Array(Buffer.from(user?.passkey?.id, "hex")),
				credentialPublicKey: new Uint8Array(
					Buffer.from(user?.passkey?.publicKey, "hex"),
				),
				counter: user.passkey.counter,
				transports: user.passkey.transports,
			},
		});

		if (verification.verified) {
			const dataValid =
				encodeData({ contractId, network, callFunction }) === signInfo.data;

			if (
				user.username !== signInfo.username ||
				user.userId !== signInfo.userId ||
				!dataValid
			) {
				progress.push(sId, {
					step: "transaction authentication",
					status: "error",
					detail: "Something wrong with signed transaction",
				});
				return res
					.status(400)
					.json({ error: "Something wrong with signed transaction" });
			}

			let versionData = await contractGet(
				internalSigner.publicKey(),
				network,
				contracts[network].MASTER_CONTRACT,
				"get_all_versions",
				[],
			);

			const latestVersionObjArr = normalizeVersionRows(
				versionData?.results[0]?.returnValueJson?.vec,
			);

			const latestVersion = latestVersionObjArr.find(
				(vr) => vr?.label === "latest",
			);

			progress.push(sId, {
				step: "transaction submission",
				status: "progress",
				detail: "Fetching Latest Version",
			});

			const wasm = latestVersion?.wasm;

			const txNonceRes = await contractGet(
				internalSigner.publicKey(),
				network,
				contractId,
				"get_nonce",
				[],
			);

			progress.push(sId, {
				step: "transaction submission",
				status: "progress",
				detail: "Fetching Update Nonce",
			});

			const txNonce = txNonceRes?.results[0]?.returnValueJson?.bytes;

			progress.push(sId, {
				step: "transaction submission",
				status: "progress",
				detail: "Generating BLS Signatures",
			});

			const signatureAggregate = await signatureAggregator(
				network,
				user.passkey.publicKey,
				contractId,
				txNonce,
			);

			const args = [
				nativeToScVal(Buffer.from(wasm, "hex"), { type: "bytes" }),
				nativeToScVal(signatureAggregate, { type: "bytes" }),
			];

			progress.push(sId, {
				step: "transaction submission",
				status: "progress",
				detail: "Submiting Update Onchain",
			});

			const txResponse = await invokeContractScVal(
				network,
				contractId,
				callFunction,
				args,
			);

			if (!txResponse) {
				{
					progress.push(sId, {
						step: "transaction submission",
						status: "error",
						detail: "Transaction Submission Failed",
					});
					return res
						.status(400)
						.json({ error: "Transaction Submission Failed" });
				}
			} else {
				progress.push(sId, {
					step: "transaction submission",
					status: "done",
					detail: "Transaction Submitted Successfully",
					eid: `txHash_${txResponse?.txHash}`,
				});
				res.status(200).json({
					message: "transaction successful",
					data: txResponse,
				});
			}
		}
	} catch (error) {
		progress.push(sId, {
			step: "upgrade transaction",
			status: "error",
			detail: error.response ? error.response.data : error.message,
		});
		console.error(
			"Error:",
			error.response ? error.response.data : error.message,
		);
		return res.status(400).json({
			error: error.response ? error.response.data : error.message,
		});
	}
});

app.post("/get-quote", async (req, res) => {
	try {
		const { protocol, tokenIn, tokenOut, amount } = req.body;

		if (!protocol || !tokenIn || !tokenOut || !amount) {
			return res.status(400).json({ error: "Incomplete Request Body" });
		}

		const quote = await getQuote(protocol, tokenIn, tokenOut, amount);

		const data = { ...quote?.rawTrade, amountOut: quote?.amountOut };
		res.status(200).json({
			message: "quote fetched successfully",
			data,
		});
	} catch (error) {
		console.error(
			"Error:",
			error.response ? error.response.data : error.message,
		);
	}
});

app.post("/get-account-stats", async (req, res) => {
	try {
		const authHeader = req.headers["authorization"];
		const { network } = req.body;

		if (!network) {
			return res
				.status(400)
				.json({ error: "Network is required for this call" });
		}

		if (!authHeader) {
			return res.status(401).json({ error: "Authorization header is missing" });
		}

		const accessToken = authHeader.split(" ")[1];

		const accessVerification = authenticateToken(accessToken);

		const user = await getUserByUsername(accessVerification.username);

		if (!user) {
			return res
				.status(400)
				.json({ error: "No user found or user not authorized" });
		}

		const stats = await getTransactionsByUserId(user.userId, network);

		const points = await getLoyaltyPoints(user.userId);

		const contractId = user?.address?.[network];

		const list = await TokenList.getTokenList(user.userId, network);
		let tokensDetails = [];
		let tokenPrices = {};

		if (list?.length > 0) {
			let data = await contractGet(
				internalSigner.publicKey(),
				network,
				contractId,
				"get_token_list",
				[{ value: list, type: "scSpecTypeAddress" }],
			);

			const input = data?.results?.[0]?.returnValueJson?.map;
			tokensDetails = normalizeTokenRows(input);

			if (network === "PUBLIC") {
				tokenPrices = await bestUsdQuote(tokensDetails);
			}
		}

		let versionData = await contractGet(
			internalSigner.publicKey(),
			network,
			contracts[network].MASTER_CONTRACT,
			"get_all_versions",
			[],
		);

		const latestVersionObjArr = normalizeVersionRows(
			versionData?.results?.[0]?.returnValueJson?.vec,
		);

		const latestVersion = latestVersionObjArr.find(
			(vr) => vr?.label === "latest",
		);

		let installedVersionData = await contractGet(
			internalSigner.publicKey(),
			network,
			contractId,
			"get_version",
			[],
		);

		const installedVersion =
			installedVersionData?.results[0]?.returnValueJson?.bytes;

		const versionInfo = {
			...latestVersion,
			needUpdate: latestVersion?.wasm !== installedVersion,
		};

		let accountSettings = await contractGet(
			internalSigner.publicKey(),
			network,
			contractId,
			"get_access_settings",
			[],
		);

		const accountSettingsVal =
			accountSettings?.results?.[0]?.returnValueJson?.map;

		const settingVals = normalizeAccessSettings(accountSettingsVal);

		res.status(200).json({
			message: "transaction stats fetched successfully",
			stats: stats,
			tokensDetails: tokensDetails,
			prices: tokenPrices,
			accountSettings: settingVals,
			versionInfo,
			points: points,
		});
	} catch (error) {
		console.error(
			"Error:",
			error.response ? error.response.data : error.message,
		);
	}
});

app.get("/", (req, res) => {
	res.send(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>SocketFi</title>
          <style>
            body {
              font-family: Arial, sans-serif;
              background-color: #f7f9fc;
              color: #333;
              display: flex;
              justify-content: center;
              align-items: center;
              height: 100vh;
              margin: 0;
            }
            .container {
              text-align: center;
              padding: 20px;
              border: 2px solid #4a90e2;
              border-radius: 10px;
              background-color: #fff;
              box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
            }
            h1 {
              color: #4a90e2;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>🚀 SocketFi Backend is Running</h1>
            <p>Welcome to the SocketFi API service.</p>
          </div>
        </body>
      </html>
    `);
});

app.listen(port, () => {
	console.log(`Server is running at http://localhost:${port}`);
});
