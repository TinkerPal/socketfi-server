const mongoose = require("mongoose");

const { Schema } = mongoose;

const transactionSchema = new Schema(
  {
    userId: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },

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

    txId: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },

    timestamp: String,
    network: String,
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

module.exports =
  mongoose.models.transaction ||
  mongoose.model("transaction", transactionSchema);
