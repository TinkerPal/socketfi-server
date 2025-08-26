function bigIntToBytes(bigInt, byteLength = 48) {
  if (bigInt === 0n) return new Uint8Array([0x00]);
  let hex = bigInt.toString(16);
  if (hex.length % 2) hex = "0" + hex; // Ensure even length
  let bytes = Buffer.from(hex, "hex");

  // Ensure fixed-length output (zero-pad if needed)
  if (bytes.length < byteLength) {
    let padding = Buffer.alloc(byteLength - bytes.length, 0);
    return Buffer.concat([padding, bytes]);
  }

  return bytes;
}

function pointToBytes(point) {
  return Buffer.concat([
    bigIntToBytes(point.x.c1),
    bigIntToBytes(point.x.c0),
    bigIntToBytes(point.y.c1),
    bigIntToBytes(point.y.c0),
  ]);
}

function bytesToBigInt(bytes) {
  return BigInt("0x" + Buffer.from(bytes).toString("hex"));
}

function bytesToPoint(buffer) {
  const byteLength = 48; // should match the length used in bigIntToBytes
  if (buffer.length !== 4 * byteLength) {
    throw new Error(`Invalid buffer length: expected ${4 * byteLength} bytes`);
  }

  const px_c1 = bytesToBigInt(buffer.slice(0, byteLength));
  const px_c0 = bytesToBigInt(buffer.slice(byteLength, 2 * byteLength));
  const py_c1 = bytesToBigInt(buffer.slice(2 * byteLength, 3 * byteLength));
  const py_c0 = bytesToBigInt(buffer.slice(3 * byteLength, 4 * byteLength));

  return {
    x: { c0: px_c0, c1: px_c1 },
    y: { c0: py_c0, c1: py_c1 },
  };
}
module.exports = { bytesToPoint, pointToBytes };
