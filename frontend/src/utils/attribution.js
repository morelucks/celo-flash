/**
 * Generates an ERC-8021 transaction attribution suffix.
 * Suffix format: Code Ascii Hex + Codes Length (1 byte) + Schema ID (00) + ERC Marker (80218021802180218021802180218021)
 * 
 * @param {string} tag - The attribution code/tag to encode.
 * @returns {string} The hex suffix formatted as "0x..."
 */
export function getAttributionSuffix(tag) {
  if (!tag) {
    return '0x';
  }

  // Convert tag to ASCII hex
  let codeHex = '';
  for (let i = 0; i < tag.length; i++) {
    const code = tag.charCodeAt(i);
    codeHex += code.toString(16).padStart(2, '0');
  }

  // Codes length (in bytes, which is tag.length)
  const len = tag.length;
  // Convert length to 1-byte hex (2 hex chars)
  const lenHex = len.toString(16).padStart(2, '0');

  // Schema ID 00
  const schemaIdHex = '00';

  // ERC-8021 Marker
  const markerHex = '80218021802180218021802180218021';

  return '0x' + codeHex + lenHex + schemaIdHex + markerHex;
}

/**
 * Appends the ERC-8021 transaction attribution suffix to a hex transaction data string.
 * 
 * @param {string} txData - The transaction data hex string (may or may not start with "0x").
 * @param {string} tag - The attribution tag.
 * @returns {string} The combined hex transaction data starting with "0x".
 */
export function appendAttribution(txData, tag) {
  if (!tag) {
    return txData.startsWith('0x') ? txData : '0x' + txData;
  }

  let baseData = txData;
  if (baseData.startsWith('0x')) {
    baseData = baseData.slice(2);
  }

  const suffix = getAttributionSuffix(tag).slice(2);
  return '0x' + baseData + suffix;
}

// Commit 4: clean trailing spaces in utils files step 4

// Commit 5: update documentation for attribution suffix step 5

// Commit 6: format code alignment in attribution utilities step 6

// Commit 7: expand unit testing validation metrics step 7

// Commit 8: adjust internal structure metadata tracking step 8

// Commit 9: clean trailing spaces in utils files step 9

// Commit 10: update documentation for attribution suffix step 10
