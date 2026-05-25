const mongoose = require("mongoose");

const { Schema } = mongoose;

const analyticsSchema = new Schema(
  {
    siteVisits: {
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
  mongoose.models.analytics || mongoose.model("analytics", analyticsSchema);
