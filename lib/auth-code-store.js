const crypto = require("crypto");
const redis = require("./redis");

const AUTH_CODE_TTL_SECONDS = 60;

function getKey(code) {
  return `socketfi:oauth:code:${code}`;
}

async function createAuthCode(payload) {
  const code = crypto.randomBytes(32).toString("hex");

  await redis.set(
    getKey(code),
    JSON.stringify({
      ...payload,
      createdAt: Date.now(),
    }),
    "EX",
    AUTH_CODE_TTL_SECONDS
  );

  return code;
}

async function consumeAuthCode({ code, clientId, origin }) {
  if (!code || !clientId || !origin) {
    throw new Error("code, clientId and origin are required");
  }

  const key = getKey(code);

  const raw = await redis.get(key);

  if (!raw) {
    throw new Error("Invalid or expired authorization code");
  }

  const record = JSON.parse(raw);

  if (record.clientId !== clientId || record.origin !== origin) {
    throw new Error("Authorization code mismatch");
  }

  await redis.del(key);

  return record;
}

module.exports = {
  createAuthCode,
  consumeAuthCode,
};
