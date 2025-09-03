const { UserAccount, Transaction, LoyaltyPoints } = require("./models/models");
const contracts = require("./soroban/contracts");
const {
  invokeCreate,
  internalSigner,
  contractGet,
} = require("./soroban/soroban-methods");

// async function createUser(username, userId, passkey, smartWalletId, network) {
//   try {
//     if (!username || !userId || !passkey || !smartWalletId) {
//       throw new Error("All required fields must be provided.");
//     }

//     const userData = {
//       username: username.toLowerCase(),
//       userId,
//       passkey,
//     };

//     userData.address[network] = smartWalletId;

//     const user = new UserAccount(userData);
//     await user.save();
//     return user;
//   } catch (error) {
//     console.error("Error creating user:", error);
//     return null;
//   }
// }

const CONTRACT_ID_RE = /^C[A-Z2-7]{55}$/;
function normalizeAddr(addr) {
  return String(addr).trim().toUpperCase();
}

function normalizeNetwork(n) {
  const key = String(n || "")
    .trim()
    .toUpperCase();
  if (["PUBLIC", "MAINNET", "PUBNET"].includes(key)) return "PUBLIC";
  if (["TESTNET", "TEST"].includes(key)) return "TESTNET";
  throw new Error("Unsupported network (use PUBLIC or TESTNET)");
}

async function findUserByAddress(
  address,
  { network, projection, lean = true } = {}
) {
  if (!address) throw new Error("address is required");

  const addr = normalizeAddr(address);
  const query = network
    ? { [`address.${normalizeNetwork(network)}`]: addr }
    : { $or: [{ "address.TESTNET": addr }, { "address.PUBLIC": addr }] };

  return UserAccount.findOne(query, projection).lean(lean).exec();
}

function isContractId(s) {
  return CONTRACT_ID_RE.test(String(s));
}

async function createUser(username, userId, passkey, smartWalletId, network) {
  try {
    if (!username || !userId || !passkey || !smartWalletId || !network) {
      throw new Error("All required fields must be provided.");
    }

    const NET = normalizeNetwork(network);
    const CONTRACT_ID = String(smartWalletId).trim().toUpperCase();
    if (!isContractId(CONTRACT_ID)) {
      throw new Error("Invalid contract ID format (expected C... base32).");
    }

    const userData = {
      username: String(username).trim().toLowerCase(),
      userId: String(userId).trim(),
      passkey,
      address: {}, // init before assigning nested key
    };
    userData.address[NET] = CONTRACT_ID;

    const user = await UserAccount.create(userData); // validators run
    return user;
  } catch (error) {
    console.log(error);
    if (error && error.code === 11000) {
      const fields = Object.keys(error.keyPattern || {});
      throw new Error(
        `Duplicate value for unique field(s): ${fields.join(", ")}`
      );
    }
    throw error;
  }
}

async function attachContractToUser(userId, smartWalletId, network) {
  try {
    const NET = normalizeNetwork(network);
    const CONTRACT_ID = String(smartWalletId).trim().toUpperCase();
    if (!isContractId(CONTRACT_ID)) {
      throw new Error("Invalid contract ID format (expected C... base32).");
    }

    const res = await UserAccount.updateOne(
      { userId },
      { $set: { [`address.${NET}`]: CONTRACT_ID } },
      { runValidators: true }
    );

    if (res.matchedCount === 0) throw new Error("User not found");
    return true; // or return the updated doc with findOneAndUpdate(..., { new: true })
  } catch (error) {
    if (error && error.code === 11000) {
      throw new Error("Contract ID already in use on this network.");
    }
    throw error;
  }
}

const getUserByUsername = async (username) => {
  try {
    return await UserAccount.findOne({
      username: username.toLowerCase(),
    });
  } catch (error) {
    console.error("Error fetching user from database:", error);
    return null;
  }
};

async function createContract(network, args) {
  try {
    const res = await invokeCreate(
      network,
      contracts[network].MASTER_CONTRACT,
      "create_wallet",
      args
    );

    return res?.resultMetaJson?.v4?.soroban_meta?.return_value?.address;
  } catch (e) {
    console.log(e);
  }
}

function base64UrlToUint8Array(base64Url) {
  let base64 = base64Url.replace(/-/g, "+").replace(/_/g, "/");

  const buffer = Buffer.from(base64, "base64");

  return new Uint8Array(buffer);
}

// userId: { type: String, required: true, unique: true, trim: true },
// type: String,
// amountIn: Number,
// priceIn: Number,
// tokenIn: String,
// symbolIn: String,
// from: String,
// to: String,
// tokenOut: String,
// symbolOut: String,
// amountOut: String,
// txId: String,
// timestamp: String,
// network: String,
// })

async function recordTransaction({
  id = null,
  walletContractId = "",
  type,
  amountIn = 0,
  priceIn = 0,
  tokenIn = "",
  from = "",
  to = "",
  tokenOut = "",
  symIn = "",
  symOut = "",
  priceOut = "",
  amountOut = "",
  txId,
  network,
}) {
  try {
    let userId;
    let value = 0;
    if (amountIn && tokenIn) {
      if (priceIn) {
        value += Number(amountIn) * Number(priceIn);
      }
    }
    if (tokenOut && amountOut) {
      if (priceOut) {
        value += Number(amountOut) * Number(priceOut);
      }
    }

    if (id) {
      userId = id;
    } else {
      userId = await findUserByAddress(walletContractId, { network: network })
        ?.userId;
    }

    let symbolIn;
    let symbolOut;

    if (symIn) {
      symbolIn = symIn;
    } else if (!symIn && tokenIn !== "") {
      symbolIn = (
        await contractGet(
          internalSigner.publicKey(),
          network,
          tokenIn,
          "symbol",
          []
        )
      )?.results[0]?.returnValueJson?.string;
      symbolIn = symbolIn === "native" ? "XLM" : symbolIn;
    }

    if (symOut) {
      symbolOut = symOut;
    } else if (!symOut && tokenOut !== "") {
      symbolOut = (
        await contractGet(
          internalSigner.publicKey(),
          network,
          tokenOut,
          "symbol",
          []
        )
      )?.results[0]?.returnValueJson?.string;

      symbolOut = symbolOut === "native" ? "XLM" : symbolOut;
    }

    const timestamp = Date.now().toString();

    const transaction = new Transaction({
      userId,
      type,
      amountIn,
      priceIn,
      tokenIn,
      symbolIn,
      from,
      to,
      value,
      tokenOut,
      symbolOut,
      amountOut,
      priceOut,
      txId,
      timestamp,
      network,
    });

    // Save user to the database
    await transaction.save();
    await updateLoyaltyPoints({ userId, amount: 100 });
    // await updateLoyaltyPoints({ userId: userId, amount: 100 });
    return "completed";
  } catch (error) {
    console.error("Error recording transaction:", error);
  }
}

async function updateLoyaltyPoints({ userId, amount }) {
  try {
    const userPoints = await LoyaltyPoints.findOne({ userId });

    if (userPoints) {
      const currentPoints = parseFloat(userPoints.points || 0);
      const newPoints = currentPoints + amount;
      userPoints.points = newPoints.toString();
      await userPoints.save();
    } else {
      // Create a new entry if user doesn't exist
      const newEntry = new LoyaltyPoints({
        userId,
        points: amount?.toString(),
      });
      await newEntry.save();
    }
  } catch (error) {
    console.error("Error recording transaction:", error);
  }
}

async function getLoyaltyPoints(userId) {
  const userPoints = await LoyaltyPoints.findOne({ userId });
  return userPoints ? parseFloat(userPoints.points || 0) : 0;
}

const toNum = (v) => {
  if (v == null) return 0;
  // Decimal128 in lean results is a BSON object; convert safely
  if (typeof v === "object" && v._bsontype === "Decimal128")
    return parseFloat(v.toString() || 0);
  return Number(v);
};

const getTransactionsByUserId = async (userId, network) => {
  try {
    const q = Transaction.find({ userId });

    // If you populate anywhere (or use mongoose-autopopulate),
    // you must force lean on each populated path:
    // q.populate([{ path: 'assetIn', select: 'code', options: { lean: true } }]);

    const transactions = await q.lean({ virtuals: true, getters: true }).exec();

    const totalVolume = transactions
      ?.filter((tx) => tx?.network === network)
      ?.reduce((acc, tx) => {
        return (
          acc +
          toNum(tx.amountIn) * toNum(tx.priceIn) +
          toNum(tx.amountOut) * toNum(tx.priceOut)
        );
      }, 0);

    return {
      transactions,
      count: transactions?.filter((tx) => tx?.network === network)?.length,
      totalVolume,
    };
  } catch (error) {
    console.error("Error fetching account stats:", error);
    throw new Error("Failed to get stats");
  }
};

const bls1 =
  "0940eaeaae0d2770da56054cec8a6d6435a6a8d693b20d1f7f72b7cb6056e39e03af06d38cc62a7d9ea449ebb936247706ada3f8f9e175a5c7c7ac91e9b0719b289d79b2e8986d4dbf010fa0c0db2b0c19a3a9b0127c39a720a9e78d6db22bad";

const bls2 =
  "0fe150951034ea201994d4d56e3668f4517648a29ef3169e178606c00affaf76624ea0dce82499a98e984bdd02fe2c200f716ce303186e8c3ddfa2b01ebbbec143ef5d9d1b644645a023c11ccd27d5930a8cbc865ab09c57f9d5deff7fff8aeb";
const bls3 =
  "186a8fb012911e46f8fd1c1469811a6dc52749301ad44be80a3844dac87b1aabd03b971b10fa524e0aef10c3e155dc3511a693c5350e13303d5a4abc037519ac1e08cb1f185dc6c245459a4dfcea4da46aaa012ff4c5370af2e8156453a34976";

const key =
  "186a8fb012911e46f8fd1c1469811a6dc52749301ad44be80a3844dac87b1aabd03b971b10fa524e0aef10c3e155dc3511a693c5350e13303d5a4abc037519ac1e08cb1f185dc6c245459a4dfcea4da46aaa012ff4c5370af2e8156453a34976".slice(
    0,
    154
  );
const args = [
  { value: "HelloWsxxorld", type: "scSpecTypeString" },
  { value: Buffer.from(key, "hex"), type: "scSpecTypeBytes" },
  {
    value: [
      // Buffer.from(bls1, "hex"),
      Buffer.from(bls2, "hex"),
      Buffer.from(bls3, "hex"),
    ],
    type: "scSpecTypeBytes",
  },
];

function reduceToAddressMap(rows = []) {
  return rows.reduce((acc, row) => {
    const address = row?.key?.address;
    if (!address) return acc;

    const entries = Array.isArray(row?.val?.map) ? row.val.map : [];

    // Extract values from the map entries
    const extracted = {};
    for (const entry of entries) {
      const k = entry?.key?.symbol;
      const v = entry?.val || {};
      // Prefer common Soroban value shapes
      const value =
        v.i128 ?? v.u128 ?? v.i64 ?? v.u64 ?? v.string ?? v.symbol ?? v.value;
      if (k) extracted[k] = value;
    }

    const symbol = extracted.symbol === "native" ? "XLM" : extracted.symbol;
    const balance = extracted.balance ?? null; // keep as string to preserve i128 safely

    acc[address] = { address, symbol, balance };
    return acc;
  }, {});
}

function reduceRows(rows = []) {
  return rows
    .map((row) => {
      const address = row?.key?.address;
      const entries = Array.isArray(row?.val?.map) ? row.val.map : [];

      const extracted = {};
      for (const entry of entries) {
        const k = entry?.key?.symbol;
        const v = entry?.val ?? {};
        const value =
          v.i128 ??
          v.u128 ??
          v.i64 ??
          v.u64 ??
          v.string ??
          v.symbol ??
          v.value ??
          null;
        if (k) extracted[k] = value;
      }

      if (!address) return null;

      return {
        address,
        symbol:
          extracted.symbol === "native" ? "XLM" : extracted.symbol ?? null,
        // keep balance as string to preserve i128 safely
        balance: extracted.balance ?? null,
      };
    })
    .filter(Boolean);
}

/**
 * Normalize balance variants to a BigInt.
 * Accepts: "2980000000", 2980000000, {i128:"..."}, {u128:"..."}, {hi:..., lo:...}
 */
function toBigIntAmount(v) {
  if (v == null) return 0n;
  if (typeof v === "string") return BigInt(v);
  if (typeof v === "number") return BigInt(Math.trunc(v)); // safe if within 2^53-1
  if (typeof v === "bigint") return v;

  if (typeof v === "object") {
    if ("i128" in v || "u128" in v) return BigInt(v.i128 ?? v.u128);
    if ("hi" in v && "lo" in v) {
      const to64 = (p) => {
        if (typeof p === "bigint") return BigInt.asUintN(64, p);
        if (typeof p === "string") return BigInt.asUintN(64, BigInt(p));
        if (typeof p === "number") return BigInt.asUintN(64, BigInt(p)); // assumes <= 2^53-1
        return 0n;
      };
      const hi = to64(v.hi);
      const lo = to64(v.lo);
      return (hi << 64n) + lo;
    }
  }
  return 0n;
}

/** Format stroops (7 dp) without FP errors */
function formatStroops(nBig) {
  const base = 10_000_000n;
  const whole = nBig / base;
  const frac = (nBig % base).toString().padStart(7, "0");
  return `${whole}.${frac}`;
}

/**
 * Accepts an array of rows that may be either:
 *  A) { address, symbol, balance }
 *  B) { key:{address}, val:{ map:[ {key:{symbol:'balance'},val:{...}}, {key:{symbol:'symbol'},val:{string:'native'}} ] } }
 * Returns: [{ address, symbol, balance, balance_human? }]
 */
function normalizeTokenRows(
  rows = [],
  { addHuman = false, decimalsBySymbol = {} } = {}
) {
  return rows.map((row) => {
    // Try simple shape first
    let address = row?.address ?? row?.key?.address ?? null;
    let symbol = row?.symbol;
    let balanceRaw = row?.balance;

    // If not in simple shape, extract from map entries
    if (
      (symbol == null || balanceRaw == null) &&
      Array.isArray(row?.val?.map)
    ) {
      const extracted = {};
      for (const entry of row.val.map) {
        const k = entry?.key?.symbol;
        const v = entry?.val ?? {};
        const val =
          v.i128 ?? v.u128 ?? v.i64 ?? v.u64 ?? v.string ?? v.symbol ?? v;
        if (k) extracted[k] = val;
      }
      symbol = symbol ?? extracted.symbol;
      balanceRaw = balanceRaw ?? extracted.balance;
    }

    // Symbol fix: native -> XLM
    const normSymbol = symbol === "native" ? "XLM" : symbol;

    // Convert balance to BigInt (works for string or {hi,lo})
    const nBig = toBigIntAmount(balanceRaw);
    const balance = nBig.toString();

    const out = { address, symbol: normSymbol, balance };

    // Optional human-readable formatter (defaults: XLM=7 dp, else try decimalsBySymbol)
    if (addHuman) {
      const dp = decimalsBySymbol[normSymbol] ?? (normSymbol === "XLM" ? 7 : 7);
      const base = 10n ** BigInt(dp);
      const whole = nBig / base;
      const frac = (nBig % base).toString().padStart(Number(dp), "0");
      out.balance_human = `${whole}.${frac}`;
      // or, for XLM only, formatStroops(nBig)
      if (normSymbol === "XLM" && dp === 7)
        out.balance_human = formatStroops(nBig);
    }

    return out;
  });
}

function normalizeVersionRows(rows = []) {
  return rows.map((row) => {
    // Initialize default values
    let label = null;
    let version = null;
    let wasm = null;

    // Extract relevant information from the `map` entries
    if (Array.isArray(row?.map)) {
      const extracted = {};
      for (const entry of row.map) {
        const k = entry?.key?.symbol;
        const v = entry?.val ?? {};

        // Extract the value based on the symbol
        if (k === "label") {
          extracted.label = v.string ?? v;
        } else if (k === "version") {
          extracted.version = v.string ?? v;
        } else if (k === "wasm") {
          extracted.wasm = v.bytes ?? v;
        }
      }

      // Assign extracted values
      label = extracted.label ?? label;
      version = extracted.version ?? version;
      wasm = extracted.wasm ?? wasm;
    }

    // Return the normalized result
    return { label, version, wasm };
  });
}

module.exports = {
  createUser,
  getUserByUsername,
  findUserByAddress,
  createContract,
  base64UrlToUint8Array,
  attachContractToUser,
  recordTransaction,
  getTransactionsByUserId,
  reduceToAddressMap,
  reduceRows,
  normalizeTokenRows,
  getLoyaltyPoints,
  normalizeVersionRows,
};
