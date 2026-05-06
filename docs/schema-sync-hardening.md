# 2026-05-06 Supabase Schema Sync & Decryption Hardening

## Overview
This session focused on resolving a critical failure in the production environment where incoming messages failed to decrypt, accompanied by `400 Bad Request` errors in the Supabase logs and a security warning regarding publicly accessible tables.

## Root Cause Analysis
- **Schema Mismatch**: The live Supabase database was missing the correct structure for the `opk_claims` table (specifically the `owner_id` column). 
- **RLS Vulnerability**: Row-Level Security (RLS) was not enabled on some tables (like `groups`), triggering an automated security alert from Supabase.
- **Key Sync Failure**: Because the `opk_claims` and `x3dh_bundles` tables were corrupted or lacked `UPDATE` policies, the app could not publish new cryptographic bundles. Contacts were using stale keys from the server, causing decryption to fail (`Authentification échouée`) for newly sent messages.

## Actions Taken

### 1. Reconstructive SQL Fix
We implemented a "Nuclear Fix" SQL script that:
- Drops the corrupted `opk_claims`, `x3dh_bundles`, and `spk_rotation_log` tables.
- Recreates them with the correct Signal Protocol-grade schema.
- Enforces strict RLS policies across all 10 tables to resolve the "publicly accessible table" warning.
- Grants `INSERT`, `UPDATE`, and `SELECT` permissions to ensure `upsert` operations work correctly.

### 2. Loud Console Logging (Observability)
To prevent "silent" failures in the future, we added explicit error handling with recognizable 🚨 icons in the browser console. If a Supabase RLS policy is violated or a table is missing, the console now provides a human-readable diagnostic message.

- **Files Updated**:
  - `sessionManager.js`: Logs for X3DH bundle and OPK claim failures.
  - `AppContext.jsx`: Logs for group synchronization and creation failures.
  - `blobStorage.js`: Logs for storage bucket permission issues.

### 3. Perfect Forward Secrecy (PFS) Enforcement
We reinforced the architectural rule that "cryptographically dead messages are not bugs." 
- **Context**: If a user wipes local data, the old private keys are destroyed. 
- **Behavior**: Messages sent before the fix or before a data wipe are permanently undecryptable. This is a security feature, not a bug.

## Maintenance Notes
- **Redeploy Required**: The application must be redeployed to pick up the new diagnostic logging.
- **SQL Migration**: Always run `schema.sql` (or the specific fix script) whenever moving to a new Supabase project to ensure RLS is correctly applied.
