// ============================================
// Safety Number — Identity Verification
// 60 decimal digits = 20 bytes SHA-256 (160 bits entropy)
// Signal Protocol level security
// ============================================

/**
 * Compute a safety number from two public keys
 * Used to verify identity (like Signal's safety numbers)
 * 
 * @param {string} myPublicB64 — base64 encoded public key
 * @param {string} theirPublicB64 — base64 encoded public key
 * @returns {string} — 60 decimal digits in 12 groups of 5
 */
export async function computeSafetyNumber(myPublicB64, theirPublicB64) {
  // Sort keys to ensure same number regardless of order
  const sorted = [myPublicB64, theirPublicB64].sort();
  
  // SHA-256 of concatenated sorted keys with domain separator
  const data = new TextEncoder().encode(sorted.join('||VanishText||'));
  const hash = await crypto.subtle.digest('SHA-256', data);
  
  // Take first 20 bytes (160 bits — Signal Protocol level)
  const bytes = new Uint8Array(hash).slice(0, 20);
  
  // Convert each byte to 3 decimal digits (000-255)
  let decimal = '';
  bytes.forEach((b) => {
    decimal += b.toString().padStart(3, '0');
  });
  
  // Format in 12 groups of 5 digits
  return decimal.slice(0, 60).match(/.{1,5}/g).join(' ');
}

/**
 * Verify if a safety number matches the computed one
 * Uses constant-time comparison to prevent timing attacks
 */
export async function verifySafetyNumber(myPublicB64, theirPublicB64, expectedNumber) {
  const computed = await computeSafetyNumber(myPublicB64, theirPublicB64);
  // Normalize: remove spaces from both
  const computedClean = computed.replace(/\s/g, '');
  const expectedClean = expectedNumber.replace(/\s/g, '');
  
  if (computedClean.length !== expectedClean.length) return false;
  
  let diff = 0;
  for (let i = 0; i < computedClean.length; i++) {
    diff |= computedClean.charCodeAt(i) ^ expectedClean.charCodeAt(i);
  }
  return diff === 0;
}
