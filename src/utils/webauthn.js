function safeJsonParse(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function assertCredentialMatches(user, sigData, base64UrlToUint8Array) {
  const savedCredential = Buffer.from(
    new Uint8Array(Buffer.from(user?.passkey?.id, "hex"))
  );

  const receivedCredential = Buffer.from(base64UrlToUint8Array(sigData.id));

  return savedCredential.compare(receivedCredential) === 0;
}

module.exports = {
  safeJsonParse,
  assertCredentialMatches,
};
