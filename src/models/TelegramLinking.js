const mongoose = require("mongoose");

const { Schema } = mongoose;

const telegramLinkingSchema = new Schema(
  {
    userId: {
      type: String,
      required: true,
      trim: true,
    },

    telegramUsername: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
    },

    otp: {
      type: String,
      trim: true,
    },

    telegramChatId: {
      type: String,
      trim: true,
    },

    status: {
      type: String,
      enum: ["PENDING", "OTP_SENT"],
      default: "PENDING",
    },

    expiresAt: {
      type: Date,
      required: true,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

telegramLinkingSchema.index(
  { userId: 1, telegramUsername: 1 },
  { unique: true }
);

telegramLinkingSchema.index({ telegramUsername: 1, status: 1 });
telegramLinkingSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports =
  mongoose.models.telegramLinking ||
  mongoose.model("telegramLinking", telegramLinkingSchema);
