const { httpError } = require("../utils/errors");
const { pushProgress } = require("../utils/progress");
const { xdr } = require("stellar-sdk");

// import your real helper
const { encodeData } = require("../services/intent.service");

function verifySignedIntent(req, res, next) {
  const user = req.user;
  const { contractId, network, callFunction } = req.invoke;
  const { signInfo } = req.passkey;

  pushProgress(req, {
    step: "transaction creation",
    status: "progress",
    detail: "Transaction Approval Verification",
  });

  const dataValid =
    encodeData({
      contractId,
      network,
      callFunction,
    }) === signInfo.data;

  if (
    user.username !== signInfo.username ||
    user.userId !== signInfo.userId ||
    !dataValid
  ) {
    pushProgress(req, {
      step: "transaction creation",
      status: "error",
      detail: "Something wrong with signed transaction",
    });

    return next(httpError(400, "Something wrong with signed transaction"));
  }

  req.signInfo = signInfo;

  next();
}

module.exports = verifySignedIntent;
