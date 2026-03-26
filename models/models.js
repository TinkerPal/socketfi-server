require("dotenv").config({ quiet: true });
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const DB_PASSWORD = process.env.DB_PASSWORD;
const DB_USER = process.env.DB_USER;

const MONGODB_URI = `mongodb+srv://${DB_USER}:${DB_PASSWORD}@socketfi.y9aiiy4.mongodb.net/socketfi?retryWrites=true&w=majority&appName=socketfi`;
// const MONGODB_URI = `mongodb://admin:Jideotetic012345$@localhost:27017/?authSource=admin`;

function normalizeNetwork(n) {
	const key = String(n || "")
		.trim()
		.toUpperCase();
	if (["PUBLIC", "MAINNET", "PUBNET"].includes(key)) return "PUBLIC";
	if (["TESTNET", "TEST"].includes(key)) return "TESTNET";
	throw new Error("Unsupported network (use PUBLIC or TESTNET)");
}

function isContractId(s) {
	return /^C[A-Z2-7]{55}$/.test(s);
}

async function attachContractToUser(userId, smartWalletId, network) {
	const NET = normalizeNetwork(network);
	const CONTRACT_ID = String(smartWalletId).trim().toUpperCase();
	if (!isContractId(CONTRACT_ID))
		throw new Error("Invalid contract ID format.");

	// Sets address.NET = CONTRACT_ID without touching other fields
	const res = await UserAccount.updateOne(
		{ userId },
		{ $set: { [`address.${NET}`]: CONTRACT_ID } },
		{ runValidators: true },
	);

	if (res.matchedCount === 0) throw new Error("User not found");
	return true;
}

const userAccountSchema = new Schema(
	{
		username: {
			type: String,
			required: true,
			unique: true,
			lowercase: true,
			trim: true,
		},
		userId: { type: String, required: true, unique: true, trim: true },

		passkey: Object,
		linkedAccounts: {
			type: [String],
			enum: ["email", "twitter", "discord", "telegram"],
			default: [],
		},
		address: {
			TESTNET: { type: String, default: undefined, uppercase: true },
			PUBLIC: { type: String, default: undefined, uppercase: true },
		},
		email: {
			id: {
				type: String,
				unique: true,
				sparse: true,
			},
			username: {
				type: String,
				lowercase: true,
				trim: true,
				sparse: true,
			},
			verified: {
				type: Boolean,
				default: false,
			},
		},
		twitter: {
			id: {
				type: String,
				unique: true,
				sparse: true,
			},
			name: String,
			screenName: String,
			imageUrl: String,
		},
		discord: {
			id: {
				type: String,
				unique: true,
				sparse: true,
			},
			username: String,
			discriminator: String,
			imageUrl: String,
			email: String,
		},
		telegram: {
			id: {
				type: String,
				unique: true,
				sparse: true,
			},
			username: String,
			imageUrl: String,
		},
	},
	{ timestamps: true, versionKey: false },
);
userAccountSchema.index({ passkey: 1 });

const CONTRACT_ID_RE = /^C[A-Z2-7]{55}$/;

userAccountSchema
	.path("address.TESTNET")
	.validate(
		(v) => v == null || CONTRACT_ID_RE.test(v),
		"Invalid TESTNET contract ID",
	);
userAccountSchema
	.path("address.PUBLIC")
	.validate(
		(v) => v == null || CONTRACT_ID_RE.test(v),
		"Invalid PUBLIC contract ID",
	);

userAccountSchema.index(
	{ "address.PUBLIC": 1 },
	{ unique: true, sparse: true },
);
userAccountSchema.index(
	{ "address.TESTNET": 1 },
	{ unique: true, sparse: true },
);

userAccountSchema.statics.getUserByEmail = async function (email) {
	return this.findOne({ "email.username": String(email).trim().toLowerCase() });
};

// Method to generate JWT token
userAccountSchema.methods.generateAuthToken = function () {
	const token = jwt.sign(
		{
			_id: this._id,
			username: this.username,
			userId: this.userId,
			passkey: this.passkey.publicKey,
			address: this.address,
		},
		process.env.JWT_SECRET,
		{ expiresIn: "24h" },
	);
	return token;
};

const transactionSchema = new Schema({
	userId: { type: String, required: true, trim: true },
	type: String,
	amountIn: String,
	priceIn: String,
	tokenIn: String,
	symbolIn: String,
	from: String,
	to: String,
	value: String,
	tokenOut: String,
	symbolOut: String,
	amountOut: String,
	priceOut: String,
	txId: { type: String, required: true, unique: true, trim: true },
	timestamp: String,
	network: String,
});

const loyaltyPointsSchema = new Schema({
	userId: { type: String, required: true, trim: true },
	points: String,
});

const NETWORKS = ["TESTNET", "PUBLIC"];
const normNet = (n) => {
	const v = String(n || "")
		.trim()
		.toUpperCase();
	if (!NETWORKS.includes(v)) throw new Error(`Invalid network: ${n}`);
	return v;
};
// If your tokens (e.g., contract IDs) are case-insensitive, keep .toUpperCase().
const normTok = (t) =>
	String(t || "")
		.trim()
		.toUpperCase();

const tokenArray = {
	type: [String],
	default: [],
	validate: {
		validator: (arr) =>
			Array.isArray(arr) &&
			arr.every((s) => typeof s === "string" && s.trim().length > 0),
		message: "tokens.* items must be non-empty strings",
	},
};

const tokenListSchema = new Schema(
	{
		userId: {
			type: String,
			required: true,
			trim: true,
			unique: true,
			index: true,
		},
		tokens: {
			TESTNET: tokenArray,
			PUBLIC: tokenArray,
		},
	},
	{ timestamps: true },
);

tokenListSchema.statics.addTokenToList = async function (
	userId,
	network,
	token,
) {
	const net = normNet(network);
	const tok = normTok(token);
	if (!tok) throw new Error("Token is required");

	// upsert so a new doc is created if it doesn't exist
	return this.findOneAndUpdate(
		{ userId: String(userId).trim() },
		{ $addToSet: { [`tokens.${net}`]: tok } },
		{ new: true, upsert: true, setDefaultsOnInsert: true },
	).lean();
};

tokenListSchema.statics.removeTokenFromList = async function (
	userId,
	network,
	token,
) {
	const net = normNet(network);
	const tok = normTok(token);
	if (!tok) throw new Error("Token is required");

	return this.findOneAndUpdate(
		{ userId: String(userId).trim() },
		{ $pull: { [`tokens.${net}`]: tok } },
		{ new: true },
	).lean();
};

tokenListSchema.statics.getTokenList = async function getTokenList(
	userId,
	network,
) {
	const net = normNet(network); // uses the validator from earlier
	const doc = await this.findOne(
		{ userId: String(userId).trim() },
		{ _id: 0, [`tokens.${net}`]: 1 },
	).lean();

	const arr = doc?.tokens?.[net] ?? [];
	// de-dupe + clean (useful if older data wasn't normalized)
	return Array.from(new Set(arr.map((t) => String(t || "").trim()))).filter(
		Boolean,
	);
};

const reservedUsernamesSchema = new Schema({
	username: { type: String, required: true, trim: true },
});
// transactionSchema.index({ userId: 1 });
// loyaltyPointsSchema.index({ userId: 1 });

const emailVerificationSchema = new Schema(
	{
		userId: { type: String, required: true, trim: true },
		email: { type: String, required: true, lowercase: true, trim: true },
		otp: { type: String, required: true, trim: true },
		expiresAt: { type: Date, required: true },
		attempts: { type: Number, default: 0 },
	},
	{ timestamps: true, versionKey: false },
);

emailVerificationSchema.index({ userId: 1, email: 1 }, { unique: true });
emailVerificationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const telegramLinkingSchema = new Schema(
	{
		userId: { type: String, required: true, trim: true },
		telegramUsername: {
			type: String,
			required: true,
			lowercase: true,
			trim: true,
		},
		otp: { type: String, trim: true },
		telegramChatId: { type: String, trim: true },
		status: {
			type: String,
			enum: ["PENDING", "OTP_SENT"],
			default: "PENDING",
		},
		expiresAt: { type: Date, required: true },
	},
	{ timestamps: true, versionKey: false },
);

telegramLinkingSchema.index(
	{ userId: 1, telegramUsername: 1 },
	{ unique: true },
);
telegramLinkingSchema.index({ telegramUsername: 1, status: 1 });
telegramLinkingSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

function authenticateToken(token) {
	if (!token) {
		throw new Error("Access denied. No token provided.");
	}

	try {
		const decoded = jwt.verify(token, process.env.JWT_SECRET);

		return decoded;
	} catch (error) {
		throw new Error("Invalid token.");
	}
}

const ReservedUsernames = mongoose.model(
	"reservedUsernames",
	reservedUsernamesSchema,
);
const UserAccount = mongoose.model("userAccount", userAccountSchema);
const Transaction = mongoose.model("transaction", transactionSchema);
const LoyaltyPoints = mongoose.model("loyaltyPoints", loyaltyPointsSchema);
const TokenList = mongoose.model("tokenList", tokenListSchema);
const EmailVerification = mongoose.model(
	"emailVerification",
	emailVerificationSchema,
);
const TelegramLinking = mongoose.model(
	"telegramLinking",
	telegramLinkingSchema,
);

module.exports = {
	MONGODB_URI,
	UserAccount,
	Transaction,
	LoyaltyPoints,
	ReservedUsernames,
	TokenList,
	EmailVerification,
	TelegramLinking,
	authenticateToken,
};
