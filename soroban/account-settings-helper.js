import BigNumber from "bignumber.js";

function parseI128Like(v, { signed = true } = {}) {
  if (v == null) return 0n;
  if (typeof v === "bigint") return v;
  if (typeof v === "number") return BigInt(v);
  if (typeof v === "string") return BigInt(v);

  if (typeof v === "object") {
    if ("i128" in v) return BigInt(v.i128);
    if ("u128" in v) return BigInt(v.u128);
    if ("hi" in v || "lo" in v) {
      const toBig = (x) => (typeof x === "bigint" ? x : BigInt(String(x ?? 0)));
      const hi = toBig(v.hi ?? 0);
      const lo = toBig(v.lo ?? 0);
      const TWO_64 = 1n << 64n;
      const TWO_128 = 1n << 128n;
      let res = (hi << 64n) + (lo & (TWO_64 - 1n));
      if (signed && (hi & (1n << 63n)) !== 0n) res -= TWO_128; // two's complement
      return res;
    }
  }
  return 0n;
}

function normalizeAccessSettings(pairs) {
  const out = { g_account: null, max_allowance: 0n };
  for (const item of pairs || []) {
    const key = item?.key?.symbol;
    const val = item?.val;
    if (key === "g_account") {
      out.g_account =
        typeof val?.address === "string"
          ? val.address
          : typeof val?.address?.accountId === "string"
          ? val.address.accountId
          : typeof val === "string" && val.startsWith("G")
          ? val
          : null;
    } else if (key === "max_allowance") {
      out.max_allowance = parseI128Like(val?.i128 ?? val, { signed: true });
    }
  }
  return jsonReadyAccessSettings(out);
}

// convert BigInt to string so JSON is valid
function jsonReadyAccessSettings(x) {
  const max = Number(x.max_allowance.toString()) / 10e7;
  return { ...x, max_allowance: max.toFixed(2) };
}

module.exports = { normalizeAccessSettings };
