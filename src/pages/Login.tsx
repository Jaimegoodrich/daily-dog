import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { useAuth } from '@/contexts/AuthContext'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Field'
import { Spinner } from '@/components/ui/Spinner'

type EmployeeOption = { id: string; display_name: string }

export function Login() {
  const [mode, setMode] = useState<'employee' | 'admin'>('employee')

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-ocean-500 via-ocean-400 to-sun-300 p-4">
      <div className="w-full max-w-md rounded-3xl bg-white p-8 shadow-xl">
        <h1 className="mb-1 text-center font-display text-3xl font-extrabold text-ocean-900">
          🐾 Daily Dog
        </h1>
        <p className="mb-6 text-center text-ocean-700/70">
          {mode === 'employee' ? "Tap your name to start your day" : 'Admin sign in'}
        </p>

        {mode === 'employee' ? <EmployeeLogin /> : <AdminLogin />}

        <button
          onClick={() => setMode(mode === 'employee' ? 'admin' : 'employee')}
          className="mt-6 w-full text-center text-sm font-semibold text-ocean-600 hover:underline"
        >
          {mode === 'employee' ? 'Admin sign in' : 'Back to employee sign in'}
        </button>
      </div>
    </div>
  )
}

function EmployeeLogin() {
  const { signInEmployeePin } = useAuth()
  const [employees, setEmployees] = useState<EmployeeOption[] | null>(null)
  const [selected, setSelected] = useState<EmployeeOption | null>(null)
  const [pin, setPin] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    supabase.rpc('list_active_employees').then(({ data }) => {
      setEmployees(data ?? [])
    })
  }, [])

  useEffect(() => {
    if (pin.length === 4 && selected) {
      void submit(pin)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pin])

  async function submit(fullPin: string) {
    if (!selected) return
    setSubmitting(true)
    setError(null)
    const { error } = await signInEmployeePin(selected.id, fullPin)
    setSubmitting(false)
    if (error) {
      setError(error)
      setPin('')
    }
  }

  if (!employees) {
    return (
      <div className="flex justify-center py-8">
        <Spinner />
      </div>
    )
  }

  if (!selected) {
    return (
      <div className="grid grid-cols-2 gap-3">
        {employees.map((emp) => (
          <button
            key={emp.id}
            onClick={() => setSelected(emp)}
            className="rounded-2xl border-2 border-sand-200 bg-sand-50 py-4 font-display font-bold text-ocean-800 hover:border-ocean-400 hover:bg-ocean-50"
          >
            {emp.display_name}
          </button>
        ))}
        {employees.length === 0 && (
          <p className="col-span-2 text-center text-sm text-ocean-700/60">
            No employees set up yet — ask your admin.
          </p>
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-col items-center gap-4">
      <p className="font-display text-lg font-bold text-ocean-800">Hi, {selected.display_name}!</p>
      <div className="flex gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className={`h-4 w-4 rounded-full border-2 border-ocean-400 ${
              i < pin.length ? 'bg-ocean-500' : 'bg-transparent'
            }`}
          />
        ))}
      </div>
      {error && <p className="text-sm font-semibold text-ocean-700">{error}</p>}
      {submitting && <Spinner />}
      <div className="grid grid-cols-3 gap-3">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'].map((key, i) => {
          if (key === '') return <div key={i} />
          if (key === '⌫') {
            return (
              <button
                key={i}
                onClick={() => setPin((p) => p.slice(0, -1))}
                className="rounded-2xl bg-sand-100 py-4 font-display text-lg font-bold text-ocean-700 hover:bg-sand-200"
              >
                ⌫
              </button>
            )
          }
          return (
            <button
              key={i}
              disabled={submitting}
              onClick={() => setPin((p) => (p.length < 4 ? p + key : p))}
              className="rounded-2xl bg-sand-100 py-4 font-display text-lg font-bold text-ocean-700 hover:bg-sand-200 disabled:opacity-50"
            >
              {key}
            </button>
          )
        })}
      </div>
      <button
        onClick={() => {
          setSelected(null)
          setPin('')
          setError(null)
        }}
        className="text-sm font-semibold text-ocean-600 hover:underline"
      >
        Not you? Pick another name
      </button>
    </div>
  )
}

function AdminLogin() {
  const { signInAdmin } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [showForgot, setShowForgot] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    const { error } = await signInAdmin(email, password)
    setSubmitting(false)
    if (error) setError(error)
  }

  if (showForgot) {
    return <ForgotPassword initialEmail={email} onBack={() => setShowForgot(false)} />
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <Input
        label="Email"
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        required
      />
      <Input
        label="Password"
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        required
      />
      {error && <p className="text-sm font-semibold text-ocean-700">{error}</p>}
      <Button type="submit" disabled={submitting} fullWidth>
        {submitting ? <Spinner className="h-5 w-5 border-white/40 border-t-white" /> : 'Sign in'}
      </Button>
      <button
        type="button"
        onClick={() => setShowForgot(true)}
        className="text-center text-sm font-semibold text-ocean-600 hover:underline"
      >
        Forgot password?
      </button>
    </form>
  )
}

function ForgotPassword({ initialEmail, onBack }: { initialEmail: string; onBack: () => void }) {
  const [email, setEmail] = useState(initialEmail)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    })
    setSubmitting(false)
    if (error) {
      setError(error.message)
      return
    }
    setSent(true)
  }

  if (sent) {
    return (
      <div className="flex flex-col items-center gap-4 text-center">
        <p className="text-ocean-800">
          If an account exists for <span className="font-semibold">{email}</span>, a password reset
          link has been sent. Check your inbox.
        </p>
        <button onClick={onBack} className="text-sm font-semibold text-ocean-600 hover:underline">
          ← Back to sign in
        </button>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <p className="text-sm text-ocean-700/70">
        Enter your admin email and we'll send you a link to reset your password.
      </p>
      <Input
        label="Email"
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        required
      />
      {error && <p className="text-sm font-semibold text-ocean-700">{error}</p>}
      <Button type="submit" disabled={submitting} fullWidth>
        {submitting ? <Spinner className="h-5 w-5 border-white/40 border-t-white" /> : 'Send Reset Link'}
      </Button>
      <button
        type="button"
        onClick={onBack}
        className="text-center text-sm font-semibold text-ocean-600 hover:underline"
      >
        ← Back to sign in
      </button>
    </form>
  )
}
