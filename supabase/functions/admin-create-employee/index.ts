// Supabase Edge Function: lets a logged-in admin create either another admin
// account (email + password they choose) or an employee account (PIN login).
// Employee auth accounts get an internal, never-shown email + random password;
// the employee only ever uses their display name + PIN (see pin-login function).
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
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return json({ error: 'Missing Authorization header' }, 401)
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const admin = createClient(supabaseUrl, serviceRoleKey)

    const jwt = authHeader.replace('Bearer ', '')
    const { data: callerData, error: callerError } = await admin.auth.getUser(jwt)
    if (callerError || !callerData?.user) {
      return json({ error: 'Invalid session' }, 401)
    }

    const { data: callerProfile } = await admin
      .from('profiles')
      .select('role')
      .eq('id', callerData.user.id)
      .maybeSingle()

    if (callerProfile?.role !== 'admin') {
      return json({ error: 'Only an admin can create accounts' }, 403)
    }

    const body = await req.json()
    const role = body.role === 'admin' ? 'admin' : 'employee'
    const full_name = (body.full_name ?? '').trim()

    if (!full_name) {
      return json({ error: 'full_name is required' }, 400)
    }

    if (role === 'admin') {
      const email = (body.email ?? '').trim()
      const password = body.password ?? ''
      if (!email || !password) {
        return json({ error: 'email and password are required for an admin account' }, 400)
      }

      const { data: created, error: createError } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name, role: 'admin' },
      })

      if (createError || !created?.user) {
        return json({ error: createError?.message ?? 'Could not create admin account' }, 500)
      }

      return json({ profile_id: created.user.id })
    }

    const display_name = (body.display_name ?? '').trim()
    const pin = (body.pin ?? '').trim()

    if (!display_name || !/^\d{4}$/.test(pin)) {
      return json({ error: 'display_name and a 4-digit pin are required' }, 400)
    }

    const slug = display_name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '')
    const internalEmail = `${slug}-${crypto.randomUUID().slice(0, 8)}@staff.dailydog.internal`
    const randomPassword = crypto.randomUUID() + crypto.randomUUID()

    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email: internalEmail,
      password: randomPassword,
      email_confirm: true,
      user_metadata: { full_name, role: 'employee' },
    })

    if (createError || !created?.user) {
      return json({ error: createError?.message ?? 'Could not create employee account' }, 500)
    }

    const { data: employeeId, error: employeeError } = await admin.rpc('create_employee_record', {
      p_profile_id: created.user.id,
      p_display_name: display_name,
      p_pin: pin,
    })

    if (employeeError) {
      // Roll back the auth user so we don't leave an orphaned account.
      await admin.auth.admin.deleteUser(created.user.id)
      return json({ error: employeeError.message }, 500)
    }

    return json({ profile_id: created.user.id, employee_id: employeeId })
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
