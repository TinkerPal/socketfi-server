// src/services/webauthn.service.js

const {
  base64urlToBuffer,
  derSignatureTo64Bytes,
} = require("../bls-nodes/p256/p256-helper");

const {
  base64UrlToUint8Array,
  buildWebAuthnDigest,
} = require("../helper-functions");

module.exports = {
  base64UrlToUint8Array,
  base64urlToBuffer,
  derSignatureTo64Bytes,
  buildWebAuthnDigest,
};
