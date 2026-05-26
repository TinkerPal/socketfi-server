const { httpError } = require("../utils/errors");
const { pushProgress } = require("../utils/progress");

function validateInitSignBody(req, res, next) {
  const { contractId, network, callFunction, args = [], sId = "" } = req.body;

  if (!network || !contractId || !callFunction) {
    pushProgress(req, {
      step: "transaction authentication",
      status: "error",
      detail: "Request body is incomplete",
    });

    return next(httpError(400, "request body is incomplete"));
  }

  req.signRequest = {
    contractId,
    network,
    callFunction,
    args,
    sId,
  };

  next();
}

module.exports = validateInitSignBody;
