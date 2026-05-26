const { pushProgress } = require("../utils/progress");
const { sameSiteConfig } = require("../../configs/allowed-origins");
const {
  initSignConnectTransactionService,
} = require("../services/sign-connect-transaction.service");

initSignTransactionService;

async function initSignConnectTransaction(req, res, next) {
  try {
    pushProgress(req, {
      step: "transaction authentication",
      status: "start",
      detail: "Retrieving User Details...",
    });

    pushProgress(req, {
      step: "transaction authentication",
      status: "progress",
      detail: "Authenticating User Credentials...",
    });

    const result = await initSignConnectTransactionService({
      user: req.user,
      signRequest: req.signRequest,
    });

    res.cookie("signInfo", JSON.stringify(result.signInfo), {
      httpOnly: true,
      maxAge: 60000,
      secure: true,
      sameSite: sameSiteConfig,
    });

    pushProgress(req, {
      step: "transaction authentication",
      status: "progress",
      detail: "User Authentication Initialized",
    });

    return res.json({
      options: result.options,
      signAccess: result.signAccess,
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  initSignConnectTransaction,
};
