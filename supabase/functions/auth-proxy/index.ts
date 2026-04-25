import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

async function hashPhone(phone: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(phone);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  return hashHex;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const path = url.pathname.split('/').pop();
    const body = await req.json();
    const ip = req.headers.get('x-forwarded-for') || 'unknown';

    // ─── SECONDARY IP-BASED RATE LIMITING ───
    const { count: ipCount } = await supabaseAdmin
      .from('auth_rate_limits')
      .select('*', { count: 'exact', head: true })
      .eq('ip', ip)
      .gte('ts', new Date(Date.now() - 60 * 60 * 1000).toISOString()); // Last 1 hour

    if ((ipCount || 0) >= 20) {
      // Log security event
      await supabaseAdmin.from('security_events').insert({
        event_type: 'ip_rate_limit_exceeded',
        ip_address: ip,
        details: { count: ipCount }
      });
      return new Response(JSON.stringify({ error: 'Too many requests from this IP', retry_after: 3600 }), {
        status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (path === 'request-otp') {
      const { phone } = body;
      
      // 1. Validate phone format (E.164)
      const phoneRegex = /^\+[1-9]\d{1,14}$/;
      if (!phone || !phoneRegex.test(phone)) {
        return new Response(JSON.stringify({ error: 'Invalid phone format' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const phoneHash = await hashPhone(phone);

      // 2. Check rate limit table
      const { count: requestCount } = await supabaseAdmin
        .from('auth_rate_limits')
        .select('*', { count: 'exact', head: true })
        .eq('phone_hash', phoneHash)
        .eq('action', 'request')
        .gte('ts', new Date(Date.now() - 10 * 60 * 1000).toISOString()); // 10 mins

      if ((requestCount || 0) >= 3) {
        return new Response(JSON.stringify({ error: 'Rate limit exceeded', retry_after: 600 }), {
          status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // 3. Insert rate limit record
      await supabaseAdmin.from('auth_rate_limits').insert({
        phone_hash: phoneHash,
        action: 'request',
        ip: ip
      });

      // 4. Call Supabase Auth Admin API
      const { error: otpError } = await supabaseAdmin.auth.admin.generateLink({
        type: 'sms',
        phone: phone
      });

      // We ignore the error and return 200 to prevent revealing registered status
      if (otpError) {
        console.error('generateLink error:', otpError);
      }

      // 5. Return 200
      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (path === 'verify-otp') {
      const { phone, token } = body;
      
      if (!phone || !token) {
        return new Response(JSON.stringify({ error: 'Missing phone or token' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const phoneHash = await hashPhone(phone);

      // 1. Check verify-attempt rate limit
      const { count: verifyFails } = await supabaseAdmin
        .from('auth_rate_limits')
        .select('*', { count: 'exact', head: true })
        .eq('phone_hash', phoneHash)
        .eq('action', 'verify_fail')
        .gte('ts', new Date(Date.now() - 15 * 60 * 1000).toISOString()); // 15 mins

      const currentFails = verifyFails || 0;
      if (currentFails >= 5) {
        // Exponential backoff logic: base lockout is 15 mins (900s). 
        // 5 fails -> 15 mins, 6 fails -> 30 mins, 7 fails -> 60 mins... max 24h
        const excess = currentFails - 4; // e.g. at 5 fails, excess = 1
        const multiplier = Math.pow(2, excess - 1);
        const retryAfter = Math.min(900 * multiplier, 86400); // Max 24 hours
        
        return new Response(JSON.stringify({ error: 'Too many failed attempts', retry_after: retryAfter }), {
          status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // 2. Call Supabase Auth
      const { data, error } = await supabaseAdmin.auth.verifyOtp({
        phone: phone,
        token: token,
        type: 'sms'
      });

      // 3. If verification FAILS
      if (error) {
        await supabaseAdmin.from('auth_rate_limits').insert({
          phone_hash: phoneHash,
          action: 'verify_fail',
          ip: ip
        });
        
        return new Response(JSON.stringify({ 
          error: 'invalid_code', 
          attempts_remaining: 5 - (currentFails + 1)
        }), {
          status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // 4. If verification SUCCEEDS
      // Delete all rate limit records for this phone_hash
      await supabaseAdmin
        .from('auth_rate_limits')
        .delete()
        .eq('phone_hash', phoneHash);

      // Return session tokens
      return new Response(JSON.stringify({ session: data.session, user: data.user }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response('Not found', { status: 404, headers: corsHeaders });

  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
