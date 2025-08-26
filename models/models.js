require("dotenv").config({ quiet: true });
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const DB_PASSWORD = process.env.DB_PASSWORD;
const DB_USER = process.env.DB_USER;

const MONGODB_URI = `mongodb+srv://${DB_USER}:${DB_PASSWORD}@socketfi.y9aiiy4.mongodb.net/socketfi?retryWrites=true&w=majority&appName=socketfi`;

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
    { runValidators: true }
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
    linkedAccounts: [{ provider: String, account_id: String, handle: String }],
    address: {
      TESTNET: { type: String, default: undefined, uppercase: true },
      PUBLIC: { type: String, default: undefined, uppercase: true },
    },
  },
  { timestamps: true, versionKey: false }
);
userAccountSchema.index({ passkey: 1 });

const CONTRACT_ID_RE = /^C[A-Z2-7]{55}$/;

userAccountSchema
  .path("address.TESTNET")
  .validate(
    (v) => v == null || CONTRACT_ID_RE.test(v),
    "Invalid TESTNET contract ID"
  );
userAccountSchema
  .path("address.PUBLIC")
  .validate(
    (v) => v == null || CONTRACT_ID_RE.test(v),
    "Invalid PUBLIC contract ID"
  );

userAccountSchema.index(
  { "address.PUBLIC": 1 },
  { unique: true, sparse: true }
);
userAccountSchema.index(
  { "address.TESTNET": 1 },
  { unique: true, sparse: true }
);

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
    { expiresIn: "24h" }
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
  userId: String,
  points: String,
});
const reservedUsernamesSchema = new Schema({
  username: { type: String, required: true, trim: true },
});
transactionSchema.index({ userId: 1 });
loyaltyPointsSchema.index({ userId: 1 });

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
  reservedUsernamesSchema
);
const UserAccount = mongoose.model("userAccount", userAccountSchema);
const Transaction = mongoose.model("transaction", transactionSchema);
const LoyaltyPoints = mongoose.model("loyaltyPoints", loyaltyPointsSchema);

module.exports = {
  MONGODB_URI,
  UserAccount,
  Transaction,
  LoyaltyPoints,
  ReservedUsernames,
  authenticateToken,
};
