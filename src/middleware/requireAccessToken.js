const { authenticateToken } = require("../services/auth.service");
const { httpError } = require("../utils/errors");
const { pushProgress } = require("../utils/progress");

// import your real function
// const { authenticateToken } = require("../services/auth.service");
authenticateToken;

function requireAccessToken(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    pushProgress(req, {
      step: "transaction creation",
      status: "error",
      detail: "Authorization header is missing",
    });

    return next(httpError(401, "Authorization header is missing"));
  }

  const [scheme, token] = authHeader.split(" ");

  if (scheme !== "Bearer" || !token) {
    return next(httpError(401, "Invalid authorization header"));
  }

  pushProgress(req, {
    step: "transaction creation",
    status: "progress",
    detail: "Account Access Verification",
  });

  const accessVerification = authenticateToken(token);

  req.auth = {
    accessToken: token,
    accessVerification,
  };

  next();
}

module.exports = requireAccessToken;
