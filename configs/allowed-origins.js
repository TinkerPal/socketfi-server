const allowedOrigins = [
  "https://socket.fi",
  "https://www.socket.fi",
  "https://auth.socket.fi",
  "https://app.socket.fi",
  "http://localhost:5173",
  "http://localhost:5174",
  "http://localhost:8080",
];

function isAllowedOrigin(origin) {
  return allowedOrigins.includes(origin);
}

const sameSiteConfig = process.env.ENV === "PRODUCTION" ? "none" : "none";
const rp_id =
  process.env.ENV === "PRODUCTION" ? process.env.RP_ID : "localhost";

const CLIENT_URL =
  process.env.ENV === "PRODUCTION"
    ? process.env.CLIENT_URL
    : "http://localhost:5173";
const SDK_AUTH_URL =
  process.env.ENV === "PRODUCTION"
    ? process.env.SDK_AUTH_URL
    : "http://localhost:8080";
const expectedOrigin = [
  CLIENT_URL,
  SDK_AUTH_URL,
  "android:apk-key-hash:nUBmf6HB48iZc6HdxHVr7fPSg8ff1gG6xTkK3e0CbQ4",
];

module.exports = {
  isAllowedOrigin,
  allowedOrigins,
  sameSiteConfig,
  rp_id,
  expectedOrigin,
};
