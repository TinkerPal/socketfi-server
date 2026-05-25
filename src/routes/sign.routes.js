const express = require("express");

const validateInitSignBody = require("../middleware/validateInitSignBody");
const requireAccessToken = require("../middleware/requireAccessToken");
const loadUserFromToken = require("../middleware/loadUserFromToken");

const { initSignTransaction } = require("../controllers/sign.controller");

const router = express.Router();

router.post(
  "/init-sign-transaction",
  validateInitSignBody,
  requireAccessToken,
  loadUserFromToken,
  initSignTransaction
);

module.exports = router;
