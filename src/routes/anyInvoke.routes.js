const express = require("express");

const validateAnyInvokeBody = require("../middleware/validateAnyInvokeBody");
const requireAccessToken = require("../middleware/requireAccessToken");
const loadUserFromToken = require("../middleware/loadUserFromToken");
const verifyPasskeySignature = require("../middleware/verifyPasskeySignature");
const verifySignedIntent = require("../middleware/verifySignedIntent");
const maybeRunDappMiddleware = require("../middleware/maybeRunDappMiddleware");
const { invokeAnyContract } = require("../controllers/anyInvoke.controller");

const router = express.Router();

router.post(
  "/any-invoke-with-sig",
  validateAnyInvokeBody,
  requireAccessToken,
  loadUserFromToken,
  verifyPasskeySignature,
  verifySignedIntent,
  maybeRunDappMiddleware,
  invokeAnyContract
);

module.exports = router;
