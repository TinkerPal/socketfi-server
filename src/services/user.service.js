const { UserAccount } = require("../models");

function normalizeNetwork(network) {
  const value = String(network || "")
    .trim()
    .toUpperCase();

  if (["PUBLIC", "MAINNET", "PUBNET"].includes(value)) return "PUBLIC";
  if (["TESTNET", "TEST"].includes(value)) return "TESTNET";

  throw new Error("Unsupported network. Use PUBLIC or TESTNET.");
}

function isContractId(value) {
  return /^C[A-Z2-7]{55}$/.test(
    String(value || "")
      .trim()
      .toUpperCase()
  );
}

async function getUserByUsername(username) {
  return UserAccount.findOne({
    username: String(username || "")
      .trim()
      .toLowerCase(),
  });
}

async function findUserByAddress(address, { network }) {
  const net = normalizeNetwork(network);

  return UserAccount.findOne({
    [`address.${net}`]: String(address || "")
      .trim()
      .toUpperCase(),
  });
}

async function attachContractToUser(userId, smartWalletId, network) {
  const net = normalizeNetwork(network);

  const contractId = String(smartWalletId || "")
    .trim()
    .toUpperCase();

  if (!isContractId(contractId)) {
    throw new Error("Invalid contract ID format.");
  }

  const result = await UserAccount.updateOne(
    { userId },
    {
      $set: {
        [`address.${net}`]: contractId,
      },
    },
    {
      runValidators: true,
    }
  );

  if (result.matchedCount === 0) {
    throw new Error("User not found");
  }

  return true;
}

async function createUser(
  username,
  userId,
  passkey,
  smartWalletAddress,
  network
) {
  const net = normalizeNetwork(network);

  return UserAccount.create({
    username: String(username).trim().toLowerCase(),
    userId: String(userId).trim(),
    passkey,
    address: {
      [net]: String(smartWalletAddress).trim().toUpperCase(),
    },
  });
}

module.exports = {
  normalizeNetwork,
  isContractId,
  getUserByUsername,
  findUserByAddress,
  attachContractToUser,
  createUser,
};
