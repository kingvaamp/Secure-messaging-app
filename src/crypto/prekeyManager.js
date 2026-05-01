/*
 * REQUIRED DB MIGRATION (run in Supabase SQL editor):
 *
 * -- SPK rotation log (for debugging + security auditing)
 * CREATE TABLE spk_rotation_log (
 *   user_id UUID REFERENCES auth.users(id),
 *   old_key_id INT, new_key_id INT,
 *   rotated_at TIMESTAMPTZ DEFAULT NOW()
 * );
 * -- OPK consumption audit
 * CREATE TABLE opk_consumption_log (
 *   owner_id UUID, claimer_id UUID, key_id INT, consumed_at TIMESTAMPTZ DEFAULT NOW()
 * );
 */

import { supabase } from '@/lib/supabase';
import { generateSignedPreKey, generateOneTimePreKey } from './x3dh';
import * as keyStorage from './keyStorage';

// Constants
const OPK_REFILL_THRESHOLD = 10;   // replenish when server has fewer than this
const OPK_REFILL_BATCH     = 20;   // upload this many at a time
const SPK_ROTATION_DAYS    = 7;    // rotate signed prekey every week
const SPK_GRACE_PERIOD_DAYS= 1;    // keep old SPK for 1 day to handle in-flight sessions

/**
 * Check remaining One-Time Pre-Keys on the server and replenish if low.
 */
async function checkAndReplenishOPKs(userId, identityKeyPair) {
  // 1. Query Supabase to count remaining OPKs
  const { data: countData, error: countError } = await supabase
    .from('x3dh_bundles')
    .select('bundle')
    .eq('user_id', userId)
    .single();

  if (countError || !countData?.bundle) {
    console.warn('Could not fetch bundle to check OPKs');
    return;
  }

  const currentOPKs = countData.bundle.oneTimePreKeys || [];
  const count = currentOPKs.length;

  // 2. If count > OPK_REFILL_THRESHOLD: return early (no action needed)
  if (count > OPK_REFILL_THRESHOLD) {
    return;
  }

  console.log(`[PrekeyManager] OPK count (${count}) is below threshold (${OPK_REFILL_THRESHOLD}), replenishing...`);

  // 3. Generate a new batch
  const startId = await keyStorage.getNextOPKId(); // monotonically increasing
  const newOPKs = await Promise.all(
    Array.from({ length: OPK_REFILL_BATCH }, (_, i) => generateOneTimePreKey(startId + i))
  );

  // 4. Save private keys locally
  await keyStorage.saveOneTimePreKeys(newOPKs);

  // 5. Append public keys to the bundle on Supabase
  const publicOPKs = newOPKs.map(k => ({ keyId: k.keyId, publicB64: k.publicB64 }));
  const updatedBundle = { ...countData.bundle, oneTimePreKeys: [...currentOPKs, ...publicOPKs] };
  
  await supabase.from('x3dh_bundles').upsert({ user_id: userId, bundle: updatedBundle });
  console.log(`[PrekeyManager] Replenished ${OPK_REFILL_BATCH} OPKs successfully.`);
}

/**
 * Check if the Signed Pre-Key is older than SPK_ROTATION_DAYS and rotate if necessary.
 */
async function checkAndRotateSPK(userId, identityKeyPair) {
  // 1. Load current SPK metadata from keyStorage
  const spkMeta = await keyStorage.loadSignedPreKeyMeta();
  if (!spkMeta || !spkMeta.createdAt) {
    // Missing metadata, skip rotation to be safe. It will be fixed if they re-login or reset.
    return;
  }

  // 2. Check age
  const ageMs = Date.now() - new Date(spkMeta.createdAt).getTime();
  if (ageMs < SPK_ROTATION_DAYS * 86400000) {
    return; // return early
  }

  console.log(`[PrekeyManager] SPK is older than ${SPK_ROTATION_DAYS} days. Rotating...`);

  // 3. Generate new SPK
  const newKeyId = spkMeta.keyId + 1;
  const newSPK = await generateSignedPreKey(identityKeyPair.privateKeyECDSA, newKeyId);

  // 4. Save new private SPK and mark OLD SPK as "grace period"
  await keyStorage.saveSignedPreKey(newSPK);
  await keyStorage.markSPKForGrace(spkMeta.keyId, Date.now() + SPK_GRACE_PERIOD_DAYS * 86400000);

  // 5. Update Supabase bundle with new SPK
  // We need to fetch the existing bundle to not overwrite OPKs
  const { data: bundleData } = await supabase.from('x3dh_bundles').select('bundle').eq('user_id', userId).single();
  
  if (bundleData?.bundle) {
    const updatedBundle = {
      ...bundleData.bundle,
      signedPreKey: { keyId: newSPK.keyId, publicB64: newSPK.publicB64, signature: newSPK.signature }
    };
    await supabase.from('x3dh_bundles').upsert({ user_id: userId, bundle: updatedBundle });
  }

  // Log to Supabase (best effort)
  supabase.from('spk_rotation_log').insert({
    user_id: userId,
    old_key_id: spkMeta.keyId,
    new_key_id: newSPK.keyId
  }).catch(() => {});

  console.log(`[PrekeyManager] SPK rotated successfully (old id: ${spkMeta.keyId}, new id: ${newKeyId}).`);

  // 6. Schedule deletion of the old SPK private key after grace period
  // This is volatile (lost on close), so we also have a persistent check in runPrekeyMaintenance
  setTimeout(async () => {
    await keyStorage.deleteExpiredSPK(spkMeta.keyId);
    console.log(`[PrekeyManager] Old SPK (id: ${spkMeta.keyId}) deleted after grace period.`);
  }, SPK_GRACE_PERIOD_DAYS * 86400000);
}

/**
 * Scan for and delete any SPKs whose grace period has expired.
 * This handles the case where the app was closed during the SPK_GRACE_PERIOD.
 */
async function cleanupExpiredSPKs() {
  const allKeys = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith('vanish_spk_')) {
      const keyId = parseInt(key.replace('vanish_spk_', ''));
      if (!isNaN(keyId)) allKeys.push(keyId);
    }
  }

  for (const kid of allKeys) {
    try {
      // loadSignedPreKey doesn't return grace data, so we use a custom check or secureLoad
      // For simplicity, we'll check if it's NOT the latest one and if it has expired
      const spk = await keyStorage.loadSignedPreKey(kid);
      if (spk && spk.graceExpiresAt && Date.now() > spk.graceExpiresAt) {
        await keyStorage.deleteExpiredSPK(kid);
        console.log(`[PrekeyManager] Cleaned up expired SPK: ${kid}`);
      }
    } catch (e) {}
  }
}

/**
 * Main entry point: Calls both checks in sequence.
 */
export async function runPrekeyMaintenance(userId, identityKeyPair) {
  try {
    // 1. Cleanup any keys that expired while the app was closed
    await cleanupExpiredSPKs();
    
    // 2. Standard maintenance
    await checkAndReplenishOPKs(userId, identityKeyPair);
    await checkAndRotateSPK(userId, identityKeyPair);
  } catch (err) {
    // Non-fatal — log but do not throw (maintenance failures should not break messaging)
    console.warn('Prekey maintenance failed:', err);
  }
}
