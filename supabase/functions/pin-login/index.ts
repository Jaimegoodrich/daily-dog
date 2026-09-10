// Supabase Edge Function: exchanges an employee's PIN for a real session,
// without ever handling a password client-side. See supabase/schema.sql for
// the check_pin() function this relies on.
import { createClient } from 'jsr:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { employee_id, pin } = await req.json()

    if (!employee_id || !pin) {
      return json({ error: 'employee_id and pin are required' }, 400)
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!

    const admin = createClient(supabaseUrl, serviceRoleKey)

    const { data: employee, error: employeeError } = await admin
      .from('employees')
      .select('id, profile_id, pin_hash, active')
      .eq('id', employee_id)
      .maybeSingle()

    if (employeeError || !employee || !employee.active) {
      return json({ error: 'Invalid PIN' }, 401)
    }

    const { data: pinOk, error: pinError } = await admin.rpc('check_pin', {
      p_pin: pin,
      p_hash: employee.pin_hash,
    })

    if (pinError || !pinOk) {
      return json({ error: 'Invalid PIN' }, 401)
    }

    const { data: userData, error: userError } = await admin.auth.admin.getUserById(
      employee.profile_id
    )

    if (userError || !userData?.user?.email) {
      return json({ error: 'Employee account is misconfigured' }, 500)
    }

    const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
      type: 'magiclink',
      email: userData.user.email,
    })

    if (linkError || !linkData?.properties?.hashed_token) {
      return json({ error: 'Could not start session', detail: linkError?.message }, 500)
    }

    const anon = createClient(supabaseUrl, anonKey)
    const { data: sessionData, error: verifyError } = await anon.auth.verifyOtp({
      token_hash: linkData.properties.hashed_token,
      type: 'magiclink',
    })

    if (verifyError || !sessionData?.session) {
      return json({ error: 'Could not start session', detail: verifyError?.message }, 500)
    }

    return json({
      access_token: sessionData.session.access_token,
      refresh_token: sessionData.session.refresh_token,
    })
  } catch (err) {
    return json({ error: 'Unexpected error', detail: String(err) }, 500)
  }
})

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
