const crypto = require("crypto");
const cbor = require("cbor");

const PUBLIC_KEY_FORMATS = new Set(["cose", "spki", "sec1"]);

const P256_SPKI_HEADER = Buffer.from(
  "3059301306072a8648ce3d020106082a8648ce3d030107034200",
  "hex"
);

const P256_N = BigInt(
  "0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551"
);

const P256_HALF_N = P256_N / 2n;

function toBuffer(value, encoding = "utf8") {
  if (Buffer.isBuffer(value)) return value;

  if (typeof value === "string") {
    return Buffer.from(value, encoding);
  }

  if (value instanceof ArrayBuffer) {
    return Buffer.from(value);
  }

  if (ArrayBuffer.isView(value)) {
    return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  }

  throw new TypeError(
    "Value must be a Buffer, string, ArrayBuffer, or Uint8Array."
  );
}

function hashPayload(payload) {
  return crypto.createHash("sha256").update(toBuffer(payload)).digest();
}

function normalizePublicKeyTo65Bytes({ publicKey, publicKeyFormat }) {
  if (!PUBLIC_KEY_FORMATS.has(publicKeyFormat)) {
    throw new Error("Unsupported public key format. Use cose, spki, or sec1.");
  }

  const keyBuffer = toBuffer(publicKey);

  if (publicKeyFormat === "sec1") {
    return validateSec1PublicKey(keyBuffer);
  }

  if (publicKeyFormat === "spki") {
    return spkiTo65BytePublicKey(keyBuffer);
  }

  return coseTo65BytePublicKey(keyBuffer);
}

function validateSec1PublicKey(publicKey65) {
  const key = toBuffer(publicKey65);

  if (key.length !== 65) {
    throw new Error("Invalid SEC1 public key length. Expected 65 bytes.");
  }

  if (key[0] !== 0x04) {
    throw new Error("Invalid SEC1 public key prefix. Expected 0x04.");
  }

  crypto.createPublicKey({
    key: publicKey65ToSpki(key),
    format: "der",
    type: "spki",
  });

  return key;
}

function coseTo65BytePublicKey(cosePublicKeyBuffer) {
  const coseStruct = cbor.decodeFirstSync(toBuffer(cosePublicKeyBuffer));

  const kty = coseStruct.get(1);
  const alg = coseStruct.get(3);
  const crv = coseStruct.get(-1);
  const x = coseStruct.get(-2);
  const y = coseStruct.get(-3);

  if (kty !== 2) {
    throw new Error("Invalid COSE key type. Expected EC2.");
  }

  if (alg !== undefined && alg !== -7) {
    throw new Error("Invalid COSE algorithm. Expected ES256 / -7.");
  }

  if (crv !== 1) {
    throw new Error("Invalid COSE curve. Expected P-256 / 1.");
  }

  if (!x || !y) {
    throw new Error("Invalid COSE public key. Missing x or y.");
  }

  const xb = toBuffer(x);
  const yb = toBuffer(y);

  if (xb.length !== 32 || yb.length !== 32) {
    throw new Error("Invalid COSE coordinate length. Expected 32 bytes each.");
  }

  return validateSec1PublicKey(Buffer.concat([Buffer.from([0x04]), xb, yb]));
}

function spkiTo65BytePublicKey(spkiBuffer) {
  const keyObject = crypto.createPublicKey({
    key: toBuffer(spkiBuffer),
    format: "der",
    type: "spki",
  });

  const exported = keyObject.export({
    format: "der",
    type: "spki",
  });

  if (!exported.subarray(0, P256_SPKI_HEADER.length).equals(P256_SPKI_HEADER)) {
    throw new Error("Invalid SPKI key. Expected P-256 SPKI header.");
  }

  return validateSec1PublicKey(exported.subarray(P256_SPKI_HEADER.length));
}

function publicKey65ToSpki(publicKey65) {
  const key = toBuffer(publicKey65);

  if (key.length !== 65 || key[0] !== 0x04) {
    throw new Error("Invalid SEC1 public key.");
  }

  return Buffer.concat([P256_SPKI_HEADER, key]);
}

function signPayloadWithP256({ payload, privateKey }) {
  return signDigestWithP256({
    digest: hashPayload(payload),
    privateKey,
  });
}

function signDigestWithP256({ digest, privateKey }) {
  const d = toBuffer(digest);

  if (d.length !== 32) {
    throw new Error("Invalid digest length. Expected 32 bytes.");
  }

  const derSignature = crypto.sign(null, d, {
    key: privateKey,
    dsaEncoding: "der",
  });

  return derSignatureTo64Bytes(derSignature, { enforceLowS: true });
}

function derSignatureTo64Bytes(derSignature, options = {}) {
  const sig = toBuffer(derSignature);

  if (sig.length < 8) {
    throw new Error("Invalid DER signature length.");
  }

  if (sig[0] !== 0x30) {
    throw new Error("Invalid DER signature. Expected sequence.");
  }

  let offset = 1;
  const seqLen = readDerLength(sig, offset);
  offset = seqLen.nextOffset;

  if (seqLen.length !== sig.length - offset) {
    throw new Error("Invalid DER signature sequence length.");
  }

  if (sig[offset] !== 0x02) {
    throw new Error("Invalid DER signature. Expected r integer.");
  }

  offset += 1;
  const rLen = readDerLength(sig, offset);
  offset = rLen.nextOffset;

  let r = sig.subarray(offset, offset + rLen.length);
  offset += rLen.length;

  if (sig[offset] !== 0x02) {
    throw new Error("Invalid DER signature. Expected s integer.");
  }

  offset += 1;
  const sLen = readDerLength(sig, offset);
  offset = sLen.nextOffset;

  let s = sig.subarray(offset, offset + sLen.length);
  offset += sLen.length;

  if (offset !== sig.length) {
    throw new Error("Invalid DER signature. Unexpected trailing bytes.");
  }

  r = normalizeEcdsaInt(r);
  s = normalizeEcdsaInt(s);

  if (options.enforceLowS) {
    s = normalizeLowS(s);
  }

  const raw = Buffer.concat([r, s]);

  if (raw.length !== 64) {
    throw new Error("Invalid raw signature length.");
  }

  return raw;
}

function signature64ToDer(signature64) {
  const sig = toBuffer(signature64);

  if (sig.length !== 64) {
    throw new Error("Invalid signature length. Expected 64 bytes.");
  }

  const r = derEncodeInteger(sig.subarray(0, 32));
  const s = derEncodeInteger(sig.subarray(32, 64));
  const body = Buffer.concat([r, s]);

  return Buffer.concat([
    Buffer.from([0x30]),
    derEncodeLength(body.length),
    body,
  ]);
}

function verifyDigestWithP256({ messageDigest, publicKey65, signature64 }) {
  const digest = toBuffer(messageDigest);
  const pub = validateSec1PublicKey(publicKey65);
  const sig = toBuffer(signature64);

  if (digest.length !== 32) {
    throw new Error("Invalid message digest length. Expected 32 bytes.");
  }

  if (sig.length !== 64) {
    throw new Error("Invalid signature length. Expected 64 bytes.");
  }

  const keyObject = crypto.createPublicKey({
    key: publicKey65ToSpki(pub),
    format: "der",
    type: "spki",
  });

  return crypto.verify(
    null,
    digest,
    {
      key: keyObject,
      dsaEncoding: "der",
    },
    signature64ToDer(sig)
  );
}

function verifySignature({ payload, publicKey65, signature64 }) {
  return verifyDigestWithP256({
    messageDigest: hashPayload(payload),
    publicKey65,
    signature64,
  });
}

function prepareSorobanP256Signature({
  payload,
  publicKey,
  publicKeyFormat,
  privateKey,
}) {
  const payloadBuffer = toBuffer(payload);
  const digest = hashPayload(payloadBuffer);

  const publicKey65 = normalizePublicKeyTo65Bytes({
    publicKey,
    publicKeyFormat,
  });

  const signature64 = signDigestWithP256({
    digest,
    privateKey,
  });

  const valid = verifyDigestWithP256({
    messageDigest: digest,
    publicKey65,
    signature64,
  });

  return {
    payload: payloadBuffer,
    digest,
    publicKey65,
    signature64,
    valid,
    digestHex: digest.toString("hex"),
    publicKey65Hex: publicKey65.toString("hex"),
    signature64Hex: signature64.toString("hex"),
  };
}

function buildWebAuthnSignedMessage({ authenticatorData, clientDataJSON }) {
  const authData = toBuffer(authenticatorData);
  const clientData = toBuffer(clientDataJSON);
  const clientDataHash = hashPayload(clientData);

  return Buffer.concat([authData, clientDataHash]);
}

function buildWebAuthnMessageDigest({ authenticatorData, clientDataJSON }) {
  return hashPayload(
    buildWebAuthnSignedMessage({
      authenticatorData,
      clientDataJSON,
    })
  );
}

function verifyWebAuthnP256Assertion({
  publicKey65,
  signatureDer,
  authenticatorData,
  clientDataJSON,
}) {
  const signedMessage = buildWebAuthnSignedMessage({
    authenticatorData,
    clientDataJSON,
  });

  const messageDigest = hashPayload(signedMessage);

  const signature64 = derSignatureTo64Bytes(signatureDer, {
    enforceLowS: false,
  });

  const valid = verifyDigestWithP256({
    messageDigest,
    publicKey65,
    signature64,
  });

  return {
    valid,
    signature64,
    messageDigest,
    signedMessage,
    messageDigestHex: messageDigest.toString("hex"),
    signature64Hex: signature64.toString("hex"),
  };
}

function normalizeEcdsaInt(value) {
  let v = Buffer.from(value);

  while (v.length > 0 && v[0] === 0x00) {
    v = v.subarray(1);
  }

  if (v.length > 32) {
    throw new Error("Invalid ECDSA integer length.");
  }

  if (v.length < 32) {
    return Buffer.concat([Buffer.alloc(32 - v.length), v]);
  }

  return v;
}

function normalizeLowS(s) {
  const sValue = BigInt(`0x${s.toString("hex")}`);

  if (sValue <= P256_HALF_N) {
    return s;
  }

  return bigintTo32Bytes(P256_N - sValue);
}

function bigintTo32Bytes(value) {
  const hex = value.toString(16).padStart(64, "0");
  return Buffer.from(hex, "hex");
}

function derEncodeInteger(value) {
  let v = Buffer.from(value);

  while (v.length > 1 && v[0] === 0x00) {
    v = v.subarray(1);
  }

  if (v[0] & 0x80) {
    v = Buffer.concat([Buffer.from([0x00]), v]);
  }

  return Buffer.concat([Buffer.from([0x02]), derEncodeLength(v.length), v]);
}

function derEncodeLength(length) {
  if (!Number.isSafeInteger(length) || length < 0) {
    throw new Error("Invalid DER length.");
  }

  if (length < 0x80) {
    return Buffer.from([length]);
  }

  const hex = length.toString(16);
  const evenHex = hex.length % 2 === 0 ? hex : `0${hex}`;
  const lengthBytes = Buffer.from(evenHex, "hex");

  return Buffer.concat([Buffer.from([0x80 | lengthBytes.length]), lengthBytes]);
}

function readDerLength(buffer, offset) {
  if (offset >= buffer.length) {
    throw new Error("Invalid DER length offset.");
  }

  const first = buffer[offset];

  if (first < 0x80) {
    return {
      length: first,
      nextOffset: offset + 1,
    };
  }

  const byteCount = first & 0x7f;

  if (byteCount === 0 || byteCount > 4) {
    throw new Error("Invalid DER length encoding.");
  }

  const start = offset + 1;
  const end = start + byteCount;

  if (end > buffer.length) {
    throw new Error("Invalid DER length bounds.");
  }

  return {
    length: Number.parseInt(buffer.subarray(start, end).toString("hex"), 16),
    nextOffset: end,
  };
}

function base64urlToBuffer(value) {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError("base64url value must be a non-empty string");
  }

  const clean = value.trim();

  if (!/^[A-Za-z0-9_-]+$/.test(clean)) {
    throw new Error("Invalid base64url string");
  }

  const padLength = (4 - (clean.length % 4)) % 4;

  return Buffer.from(
    clean.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat(padLength),
    "base64"
  );
}

module.exports = {
  hashPayload,
  toBuffer,

  normalizePublicKeyTo65Bytes,
  validateSec1PublicKey,
  coseTo65BytePublicKey,
  spkiTo65BytePublicKey,
  publicKey65ToSpki,

  signPayloadWithP256,
  signDigestWithP256,
  derSignatureTo64Bytes,
  signature64ToDer,

  verifyDigestWithP256,
  verifySignature,
  prepareSorobanP256Signature,
  base64urlToBuffer,

  buildWebAuthnSignedMessage,
  buildWebAuthnMessageDigest,
  verifyWebAuthnP256Assertion,
};
