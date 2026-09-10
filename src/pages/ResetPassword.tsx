import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Field'
import { Spinner } from '@/components/ui/Spinner'

export function ResetPassword() {
  const [status, setStatus] = useState<'verifying' | 'ready' | 'invalid' | 'done'>('verifying')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    const { data: listener } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') setStatus('ready')
    })

    supabase.auth.getSession().then(({ data }) => {
      if (data.session) setStatus((s) => (s === 'verifying' ? 'ready' : s))
    })

    const timeout = setTimeout(() => {
      setStatus((s) => (s === 'verifying' ? 'invalid' : s))
    }, 4000)

    return () => {
      listener.subscription.unsubscribe()
      clearTimeout(timeout)
    }
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (password.length < 6) {
      setError('Password must be at least 6 characters.')
      return
    }
    if (password !== confirm) {
      setError('Passwords do not match.')
      return
    }
    setSubmitting(true)
    setError(null)
    const { error } = await supabase.auth.updateUser({ password })
    setSubmitting(false)
    if (error) {
      setError(error.message)
      return
    }
    setStatus('done')
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-ocean-500 via-ocean-400 to-sun-300 p-4">
      <div className="w-full max-w-md rounded-3xl bg-white p-8 shadow-xl">
        <h1 className="mb-6 text-center font-display text-3xl font-extrabold text-ocean-900">
          🐾 Daily Dog
        </h1>

        {status === 'verifying' && (
          <div className="flex flex-col items-center gap-3 py-8">
            <Spinner />
            <p className="text-ocean-700/70">Verifying your reset link...</p>
          </div>
        )}

        {status === 'invalid' && (
          <div className="text-center">
            <p className="mb-4 text-ocean-800">
              This reset link is invalid or has expired. Please request a new one from the sign-in
              page.
            </p>
            <a href="/" className="text-sm font-semibold text-ocean-600 hover:underline">
              ← Back to sign in
            </a>
          </div>
        )}

        {status === 'ready' && (
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <p className="text-sm text-ocean-700/70">Choose a new password for your admin account.</p>
            <Input
              label="New Password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
            <Input
              label="Confirm Password"
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
            />
            {error && <p className="text-sm font-semibold text-ocean-700">{error}</p>}
            <Button type="submit" disabled={submitting} fullWidth>
              {submitting ? <Spinner className="h-5 w-5 border-white/40 border-t-white" /> : 'Update Password'}
            </Button>
          </form>
        )}

        {status === 'done' && (
          <div className="text-center">
            <p className="mb-4 text-ocean-800">
              Your password has been updated. You're now signed in.
            </p>
            <a href="/" className="text-sm font-semibold text-ocean-600 hover:underline">
              Go to Dashboard →
            </a>
          </div>
        )}
      </div>
    </div>
  )
}
