var StellarSdk = require("@stellar/stellar-sdk");
const crypto = require("crypto");
const BigNumber = require("bignumber.js");

const { Soroban, ScInt, nativeToScVal, Address } = StellarSdk;

function stringToArray(input) {
  if (!!input) {
    return input
      .split(",")
      .map((item) => item.trim())
      .filter((item) => item !== "");
  }
  return [];
}

function encodeData(data) {
  const jsonString = JSON.stringify(data);
  return Buffer.from(jsonString).toString("base64"); // Base64 encode
}

function decodeData(encoded) {
  const jsonString = Buffer.from(encoded, "base64").toString();
  return JSON.parse(jsonString);
}

function parseSpec(spec) {
  return spec.funcs().map((fn) => ({
    name: fn.name().toString(),
    doc: fn.doc().toString(),
    inputs: fn.inputs().map((input) => ({
      name: input.name().toString(),
      type: input.type().switch().name,
    })),
    outputs: fn.outputs().map((output) => ({
      name: output.switch().name,
      type: output.switch().name,
    })),
  }));
}

function processArgs(arg) {
  if (arg.type === "scSpecTypeI128") {
    const quantity = Soroban.parseTokenAmount(arg.value, 7);
    return new ScInt(quantity).toI128();
  } else if (arg.type === "scSpecTypeAddress") {
    return nativeToScVal(arg.value, { type: "address" });
  } else if (arg.type === "scSpecTypeBytes") {
    return nativeToScVal(arg.value, { type: "bytes" }); // to
  } else if (arg.type === "scSpecTypeU32") {
    return nativeToScVal(Number(arg.value), { type: "u32" }); // to
  } else if (arg.type === "scSpecTypeU64") {
    return nativeToScVal(Number(arg.value)); // to
  } else if (arg.type === "scSpecTypeSymbol") {
    return nativeToScVal(arg.value, { type: "symbol" }); // to
  } else if (arg.type === "None") {
    return nativeToScVal(null); // to
  } else if (arg.type === "Wasm") {
    return;
  } else if (arg.type === "scSpecTypeVec") {
    const arrs = stringToArray(arg.value);
    const argsare = nativeToScVal(arrs, {
      type: ["u64", "u64", "symbol"],
    }); // to

    return argsare;
  } else {
    return nativeToScVal(arg.value);
  }
}

const toBaseUnits = (amount, decimals) => {
  const conversion = new BigNumber(amount)
    .multipliedBy(new BigNumber(10).pow(decimals))
    .integerValue(BigNumber.ROUND_HALF_UP);

  return conversion.c[0];
};

module.exports = {
  processArgs,

  parseSpec,
  encodeData,
  decodeData,
  toBaseUnits,
};
