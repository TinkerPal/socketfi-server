const { httpError } = require("../utils/errors");
const { getDappMiddleware } = require("../dapps/registry");

async function maybeRunDappMiddleware(req, res, next) {
  try {
    const dappContext = req.invoke?.dappContext;

    if (!dappContext) {
      return next();
    }

    const dappName = dappContext.dapp;

    if (!dappName) {
      return next(httpError(400, "dappContext.dapp is required"));
    }

    const dappMiddleware = getDappMiddleware(dappName);

    if (!dappMiddleware) {
      return next(httpError(400, `Unsupported dApp middleware: ${dappName}`));
    }

    req.dappMiddleware = dappMiddleware;

    if (typeof dappMiddleware.beforeInvoke === "function") {
      await dappMiddleware.beforeInvoke(req);
    }

    next();
  } catch (error) {
    next(error);
  }
}

module.exports = maybeRunDappMiddleware;
