const mongoose = require("mongoose");

const { Schema } = mongoose;

const emailVerificationSchema = new Schema(
  {
    userId: {
      type: String,
      required: true,
      trim: true,
    },

    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
    },

    otp: {
      type: String,
      required: true,
      trim: true,
    },

    expiresAt: {
      type: Date,
      required: true,
    },

    attempts: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

emailVerificationSchema.index({ userId: 1, email: 1 }, { unique: true });
emailVerificationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports =
  mongoose.models.emailVerification ||
  mongoose.model("emailVerification", emailVerificationSchema);
