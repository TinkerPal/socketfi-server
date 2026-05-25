const { getUserByUsername } = require("../services/user.service");
const { httpError } = require("../utils/errors");
const { pushProgress } = require("../utils/progress");

async function loadUserFromToken(req, res, next) {
  try {
    const username = req.auth?.accessVerification?.username;

    if (!username) {
      return next(httpError(401, "Invalid access token"));
    }

    const user = await getUserByUsername(username);

    if (!user) {
      pushProgress(req, {
        step: "transaction creation",
        status: "error",
        detail: "No user found or user not authorized",
      });

      return next(httpError(400, "No user found or user not authorized"));
    }

    req.user = user;

    next();
  } catch (error) {
    next(error);
  }
}

module.exports = loadUserFromToken;
