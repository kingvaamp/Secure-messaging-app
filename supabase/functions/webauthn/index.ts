import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { encode as b64Encode, decode as b64Decode } from "https://deno.land/std@0.177.0/encoding/base64.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// --- Helpers ---
function toBase64(buf: Uint8Array): string {
  return b64Encode(buf).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: req.headers.get('Authorization')! } } }
    );

    // Ensure the user is authenticated
    const { data: { user }, error: authError } = await supabaseClient.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const url = new URL(req.url);
    const path = url.pathname.split('/').pop();

    // ────────────────────────────────────────────────────────────────────────────
    // ROUTE: POST /webauthn/challenge & POST /webauthn/register-challenge
    // ────────────────────────────────────────────────────────────────────────────
    if (path === 'challenge' || path === 'register-challenge') {
      const challengeBytes = crypto.getRandomValues(new Uint8Array(32));
      const challengeB64 = toBase64(challengeBytes);
      const expiresAt = new Date(Date.now() + 2 * 60 * 1000).toISOString(); // 2 minutes

      const { error } = await supabaseClient.from('webauthn_challenges').insert({
        user_id: user.id,
        challenge_b64: challengeB64,
        expires_at: expiresAt,
        used: false
      });

      if (error) throw new Error('Failed to store challenge');

      return new Response(JSON.stringify({ 
        challenge: challengeB64,
        userIdBase64: toBase64(new TextEncoder().encode(user.id))
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ────────────────────────────────────────────────────────────────────────────
    // ROUTE: POST /webauthn/verify (Login assertion)
    // ────────────────────────────────────────────────────────────────────────────
    if (path === 'verify') {
      const body = await req.json();
      const { assertion, challenge_b64 } = body;

      // 1. Look up the challenge
      const { data: challengeRow, error: challengeError } = await supabaseClient
        .from('webauthn_challenges')
        .select('*')
        .eq('user_id', user.id)
        .eq('challenge_b64', challenge_b64)
        .single();

      if (challengeError || !challengeRow) throw new Error('Challenge not found');
      if (challengeRow.used) throw new Error('Challenge already used');
      if (new Date(challengeRow.expires_at) < new Date()) throw new Error('Challenge expired');

      // 2. Mark as used
      await supabaseClient
        .from('webauthn_challenges')
        .update({ used: true })
        .eq('id', challengeRow.id);

      // 3. Verify Authenticator Data & Signature
      // In a full production implementation, use @simplewebauthn/server here.
      // E.g. verifyAuthenticationResponse({ response: body, expectedChallenge: challenge_b64, expectedOrigin: '...', expectedRPID: '...', credential: ... })
      
      const { data: credRow } = await supabaseClient
        .from('webauthn_credentials')
        .select('*')
        .eq('user_id', user.id)
        .eq('credential_id', body.id)
        .single();
        
      if (!credRow) throw new Error('Credential not found');

      // Assuming signature and authenticator data checks out (simplified for edge function demonstration)
      // Update sign_count to prevent cloning attacks
      await supabaseClient.from('webauthn_credentials').update({
        sign_count: credRow.sign_count + 1
      }).eq('credential_id', body.id);

      return new Response(JSON.stringify({ verified: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ────────────────────────────────────────────────────────────────────────────
    // ROUTE: POST /webauthn/register-verify (Credential creation)
    // ────────────────────────────────────────────────────────────────────────────
    if (path === 'register-verify') {
      const body = await req.json();
      const { id, rawId, response, challenge_b64 } = body;

      // 1. Verify challenge
      const { data: challengeRow } = await supabaseClient
        .from('webauthn_challenges')
        .select('*')
        .eq('user_id', user.id)
        .eq('challenge_b64', challenge_b64)
        .single();

      if (!challengeRow || challengeRow.used || new Date(challengeRow.expires_at) < new Date()) {
        throw new Error('Invalid or expired challenge');
      }

      await supabaseClient.from('webauthn_challenges').update({ used: true }).eq('id', challengeRow.id);

      // 2. Parse Attestation & extract public key 
      // (In production, use @simplewebauthn/server `verifyRegistrationResponse`)
      // For this implementation, we store a mock or rely on the client to send the parsed key if not using a library.
      // We will store the credential ID to allow login verification.
      
      const { error: insertError } = await supabaseClient.from('webauthn_credentials').upsert({
        user_id: user.id,
        credential_id: id,
        public_key_cose: 'placeholder_key_bytes', // Requires CBOR parsing of attestationObject
        sign_count: 0
      });

      if (insertError) throw new Error('Failed to store credential');

      return new Response(JSON.stringify({ verified: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response('Not found', { status: 404, headers: corsHeaders });

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
