const SALT = "VerkasTxSalt2026";
const BASE62 = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

/**
 * Encodes a numeric ID into a 16-character obfuscated string.
 */
function encodeId(id) {
  const num = parseInt(id.toString(), 10);
  if (isNaN(num)) return id.toString();

  // Convert to base62
  let rawEncoded = "";
  let temp = num;
  if (temp === 0) {
    rawEncoded = "0";
  } else {
    while (temp > 0) {
      rawEncoded = BASE62[temp % 62] + rawEncoded;
      temp = Math.floor(temp / 62);
    }
  }

  // Generate deterministic padding using a simple hash of the ID and salt
  let hash = 0;
  const strForHash = `${num}-${SALT}`;
  for (let i = 0; i < strForHash.length; i++) {
    hash = (hash << 5) - hash + strForHash.charCodeAt(i);
    hash |= 0;
  }

  const targetLength = 16;
  const lenChar = BASE62[rawEncoded.length];
  let padded = lenChar + rawEncoded;

  let currentHash = Math.abs(hash);
  while (padded.length < targetLength) {
    const nextCharIndex = Math.abs(currentHash) % 62;
    padded += BASE62[nextCharIndex];
    currentHash = Math.floor((currentHash * 33) ^ nextCharIndex);
  }

  return padded.substring(0, targetLength);
}

/**
 * Decodes a 16-character obfuscated string back to the numeric ID.
 * Returns NaN if the string is invalid or not obfuscated.
 */
function decodeId(hashStr) {
  if (!hashStr || hashStr.length !== 16) return NaN;

  const lenChar = hashStr[0];
  const len = BASE62.indexOf(lenChar);
  if (len <= 0 || len > 10) return NaN;

  const rawEncoded = hashStr.substring(1, 1 + len);
  let num = 0;
  for (let i = 0; i < rawEncoded.length; i++) {
    const char = rawEncoded[i];
    const val = BASE62.indexOf(char);
    if (val === -1) return NaN;
    num = num * 62 + val;
  }
  return num;
}

module.exports = {
  encodeId,
  decodeId
};
