const mongoose = require("mongoose");

const { getSymbol } = require("../../soroban/soroban-methods");

const { Schema } = mongoose;

const NETWORKS = ["TESTNET", "PUBLIC"];

function normalizeNetwork(network) {
  const value = String(network || "")
    .trim()
    .toUpperCase();

  if (["PUBLIC", "MAINNET", "PUBNET"].includes(value)) return "PUBLIC";
  if (["TESTNET", "TEST"].includes(value)) return "TESTNET";

  throw new Error("Invalid network. Use PUBLIC or TESTNET.");
}

const tokenSchema = new Schema(
  {
    symbol: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
    },

    contract: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
    },
  },
  { _id: false }
);

const tokenArray = {
  type: [tokenSchema],
  default: [],
  validate: {
    validator: (arr) =>
      Array.isArray(arr) &&
      arr.every(
        (token) =>
          token &&
          typeof token.symbol === "string" &&
          token.symbol.trim().length > 0 &&
          typeof token.contract === "string" &&
          token.contract.trim().length > 0
      ),
    message: "Each token must have non-empty symbol and contract",
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
  {
    timestamps: true,
    versionKey: false,
  }
);

tokenListSchema.statics.addTokenToList = async function addTokenToList(
  userId,
  network,
  tokenContract
) {
  const net = normalizeNetwork(network);

  if (!tokenContract) {
    throw new Error("Token contract is required");
  }

  const contract = String(tokenContract).trim().toUpperCase();

  const symbol = await getSymbol(contract, net);

  if (!symbol) {
    throw new Error("Token symbol not found");
  }

  const token = {
    symbol: String(symbol).trim().toUpperCase(),
    contract,
  };

  const query = {
    userId: String(userId).trim(),
  };

  await this.updateOne(
    query,
    {
      $setOnInsert: {
        userId: query.userId,
      },
    },
    {
      upsert: true,
    }
  );

  await this.updateOne(query, {
    $pull: {
      [`tokens.${net}`]: {
        contract,
      },
    },
  });

  return this.findOneAndUpdate(
    query,
    {
      $push: {
        [`tokens.${net}`]: token,
      },
    },
    {
      new: true,
    }
  ).lean();
};

tokenListSchema.statics.removeTokenFromList =
  async function removeTokenFromList(userId, network, tokenContract) {
    const net = normalizeNetwork(network);

    const contract = String(tokenContract || "")
      .trim()
      .toUpperCase();

    if (!contract) {
      throw new Error("Token contract is required");
    }

    return this.findOneAndUpdate(
      {
        userId: String(userId).trim(),
      },
      {
        $pull: {
          [`tokens.${net}`]: {
            contract,
          },
        },
      },
      {
        new: true,
      }
    ).lean();
  };

tokenListSchema.statics.getTokenList = async function getTokenList(
  userId,
  network
) {
  const net = normalizeNetwork(network);

  const doc = await this.findOne(
    {
      userId: String(userId).trim(),
    },
    {
      _id: 0,
      [`tokens.${net}`]: 1,
    }
  ).lean();

  const tokens = doc?.tokens?.[net] || [];
  const seen = new Set();

  return tokens.filter((token) => {
    const contract = String(token?.contract || "")
      .trim()
      .toUpperCase();

    if (!contract || seen.has(contract)) return false;

    seen.add(contract);
    return true;
  });
};

module.exports =
  mongoose.models.tokenList || mongoose.model("tokenList", tokenListSchema);
