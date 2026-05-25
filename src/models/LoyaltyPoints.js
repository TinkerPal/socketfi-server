const mongoose = require("mongoose");

const { Schema } = mongoose;

const loyaltyPointsSchema = new Schema(
  {
    userId: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },

    points: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

module.exports =
  mongoose.models.loyaltyPoints ||
  mongoose.model("loyaltyPoints", loyaltyPointsSchema);
