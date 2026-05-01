import { wipeAllKeys } from '@/crypto/keyStorage';
import { wipeAllMessages } from '@/crypto/messageDB';
import { supabase } from '@/lib/supabase';

/**
 * Performs a complete wipe of the local environment.
 * - Deletes all Signal keys (Identity, SPK, OPKs)
 * - Deletes all messages and attachments from IndexedDB
 * - Clears all localStorage (contacts, sessions, settings)
 * - Signs out from Supabase
 */
export async function performMasterReset() {
  console.warn('[MASTER RESET] Initiating full system wipe...');
  
  try {
    // 1. Wipe Cryptographic Identity
    await wipeAllKeys();
    
    // 2. Wipe Message History
    await wipeAllMessages();
    
    // 3. Clear App State
    localStorage.clear();
    sessionStorage.clear();
    
    // 4. Sign Out
    await supabase.auth.signOut();
    
    console.log('[MASTER RESET] Wipe complete. Reloading...');
    window.location.reload();
  } catch (err) {
    console.error('[MASTER RESET] Failed to complete wipe:', err);
    // Force reload anyway
    window.location.href = '/';
  }
}
