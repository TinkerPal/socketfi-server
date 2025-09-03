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

function formatScaledAmount(i128, { decimals = 7, fraction = 2 } = {}) {
  const bi = typeof i128 === "bigint" ? i128 : BigInt(String(i128 ?? 0));
  const neg = bi < 0n;
  const abs = neg ? -bi : bi;

  const D = 10n ** BigInt(decimals); // original scale (e.g., 1e7)
  const F = 10n ** BigInt(fraction); // target fraction (e.g., 1e2)
  // round half up to `fraction` digits
  let scaled = (abs * F + D / 2n) / D;

  const intPart = scaled / F;
  const fracPart = (scaled % F).toString().padStart(fraction, "0");
  return `${neg ? "-" : ""}${intPart}${fraction ? "." + fracPart : ""}`;
}

// keep raw BigInt as string for machines, plus a human string
function jsonReadyAccessSettings(x, { decimals = 7, fraction = 2 } = {}) {
  return {
    ...x,
    max_allowance: formatScaledAmount(x.max_allowance, {
      decimals,
      fraction,
    }),
  };
}

module.exports = { normalizeAccessSettings };
