const jwt = require("jsonwebtoken");

function authenticateToken(token) {
  if (!token) {
    throw new Error("Access denied. No token provided.");
  }

  try {
    return jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    throw new Error("Invalid token.");
  }
}

module.exports = {
  authenticateToken,
};
