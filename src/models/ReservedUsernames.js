const mongoose = require("mongoose");

const { Schema } = mongoose;

const reservedUsernamesSchema = new Schema(
  {
    username: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      unique: true,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

module.exports =
  mongoose.models.reservedUsernames ||
  mongoose.model("reservedUsernames", reservedUsernamesSchema);
