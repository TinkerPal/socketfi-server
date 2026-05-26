const { httpError } = require("../utils/errors");
const { pushProgress } = require("../utils/progress");

function validateAnyInvokeBody(req, res, next) {
  const {
    contractId,
    network,
    callFunction,
    args = [],
    sigData,
    txDetails = null,
    sId = "",
    dappContext = null,
  } = req.body;

  pushProgress(req, {
    step: "transaction creation",
    status: "start",
    detail: "Transaction Creation Started",
  });

  if (!network || !contractId || !callFunction || !sigData) {
    pushProgress(req, {
      step: "transaction creation",
      status: "error",
      detail: "Request body is incomplete",
    });

    return next(httpError(400, "Request body is incomplete"));
  }

  if (!callFunction.name) {
    return next(httpError(400, "callFunction.name is required"));
  }

  if (!Array.isArray(args)) {
    return next(httpError(400, "args must be an array"));
  }

  req.invoke = {
    contractId,
    network,
    callFunction,
    args,
    sigData,
    txDetails,
    sId,
    dappContext,
  };

  next();
}

module.exports = validateAnyInvokeBody;
