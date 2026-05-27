const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");

const { Schema } = mongoose;

const CONTRACT_ID_RE = /^C[A-Z2-7]{55}$/;

const userAccountSchema = new Schema(
	{
		username: {
			type: String,
			required: true,
			unique: true,
			lowercase: true,
			trim: true,
		},

		userId: {
			type: String,
			required: true,
			unique: true,
			trim: true,
		},

		passkey: {
			type: Object,
			required: true,
		},

		linkedAccounts: {
			type: [String],
			enum: ["email", "twitter", "discord", "telegram"],
			default: [],
		},

		address: {
			TESTNET: {
				type: String,
				default: undefined,
				uppercase: true,
				validate: {
					validator: (v) => v == null || CONTRACT_ID_RE.test(v),
					message: "Invalid TESTNET contract ID",
				},
			},
			PUBLIC: {
				type: String,
				default: undefined,
				uppercase: true,
				validate: {
					validator: (v) => v == null || CONTRACT_ID_RE.test(v),
					message: "Invalid PUBLIC contract ID",
				},
			},
		},

		email: {
			id: {
				type: String,
				unique: true,
				sparse: true,
			},
			address: {
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
	{
		timestamps: true,
		versionKey: false,
	},
);

userAccountSchema.index({ "passkey.id": 1 });
userAccountSchema.index(
	{ "address.PUBLIC": 1 },
	{ unique: true, sparse: true },
);
userAccountSchema.index(
	{ "address.TESTNET": 1 },
	{ unique: true, sparse: true },
);

userAccountSchema.statics.getUserByEmail = async function getUserByEmail(
	email,
) {
	return this.findOne({
		"email.username": String(email).trim().toLowerCase(),
	});
};

userAccountSchema.statics.getUserByPasskeyId =
	async function getUserByPasskeyId(passkeyId) {
		return this.findOne({
			"passkey.id": String(passkeyId).trim(),
		});
	};

userAccountSchema.methods.generateAuthToken = function generateAuthToken() {
	return jwt.sign(
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
};

userAccountSchema.methods.generateSDkAuthToken = function generateSDkAuthToken({
	origin,
	clientId,
}) {
	return jwt.sign(
		{
			_id: this._id,
			username: this.username,
			userId: this.userId,
			passkey: this.passkey.publicKey,
			address: this.address,
			clientId,
			origin,
		},
		process.env.JWT_SECRET,
		{ expiresIn: "1h" },
	);
};

module.exports =
	mongoose.models.userAccount ||
	mongoose.model("userAccount", userAccountSchema);
