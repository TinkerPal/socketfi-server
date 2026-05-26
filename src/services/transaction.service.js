const { Transaction, LoyaltyPoints } = require("../models");

const DEFAULT_TRANSACTION_POINTS = 100;

async function updateLoyaltyPoints({
  userId,
  amount = DEFAULT_TRANSACTION_POINTS,
}) {
  if (!userId) {
    throw new Error("LoyaltyPoints userId is required");
  }

  const pointsAmount = Number(amount || 0);

  if (!Number.isFinite(pointsAmount) || pointsAmount <= 0) {
    return null;
  }

  return LoyaltyPoints.findOneAndUpdate(
    { userId: String(userId).trim() },
    {
      $inc: { points: pointsAmount },
      $setOnInsert: { userId: String(userId).trim() },
    },
    { upsert: true, new: true }
  ).lean();
}

async function recordTransaction(txRecord) {
  if (!txRecord?.userId) {
    throw new Error("Transaction userId is required");
  }

  if (!txRecord?.txId) {
    throw new Error("Transaction txId is required");
  }

  const tx = await Transaction.findOneAndUpdate(
    { txId: txRecord.txId },
    { $setOnInsert: txRecord },
    { upsert: true, new: true }
  ).lean();

  await updateLoyaltyPoints({
    userId: txRecord.userId,
    amount: DEFAULT_TRANSACTION_POINTS,
  });

  return tx;
}

async function getTransactionsByUserId(userId, network) {
  const query = {
    userId: String(userId).trim(),
  };

  if (network) {
    query.network = String(network).trim().toUpperCase();
  }

  return Transaction.find(query).sort({ createdAt: -1 }).lean();
}

module.exports = {
  recordTransaction,
  getTransactionsByUserId,
  updateLoyaltyPoints,
};
