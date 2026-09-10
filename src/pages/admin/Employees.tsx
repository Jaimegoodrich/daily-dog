import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { Input } from '@/components/ui/Field'
import { Spinner } from '@/components/ui/Spinner'
import type { Employee } from '@/types/database'

export function AdminEmployees() {
  const [employees, setEmployees] = useState<Employee[] | null>(null)
  const [showAdd, setShowAdd] = useState(false)
  const [resetTarget, setResetTarget] = useState<Employee | null>(null)

  async function load() {
    const { data } = await supabase.from('employees').select('*').order('display_name')
    setEmployees(data ?? [])
  }

  useEffect(() => {
    load()
  }, [])

  async function toggleActive(emp: Employee) {
    await supabase.from('employees').update({ active: !emp.active }).eq('id', emp.id)
    load()
  }

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-extrabold text-ocean-900">🧑‍🤝‍🧑 Employees</h1>
        <Button onClick={() => setShowAdd(true)}>+ Add Employee</Button>
      </div>

      {employees === null && (
        <div className="flex justify-center py-10">
          <Spinner className="h-8 w-8" />
        </div>
      )}

      <div className="flex flex-col gap-3">
        {employees?.map((emp) => (
          <Card key={emp.id} className="flex items-center justify-between">
            <div>
              <p className="font-display font-bold text-ocean-900">{emp.display_name}</p>
              <p className={`text-xs font-semibold ${emp.active ? 'text-green-600' : 'text-ocean-700/40'}`}>
                {emp.active ? 'Active' : 'Inactive'}
              </p>
            </div>
            <div className="flex gap-3 text-sm">
              <button onClick={() => setResetTarget(emp)} className="font-semibold text-ocean-600 hover:underline">
                Reset PIN
              </button>
              <button onClick={() => toggleActive(emp)} className="font-semibold text-ocean-700 hover:underline">
                {emp.active ? 'Deactivate' : 'Activate'}
              </button>
            </div>
          </Card>
        ))}
      </div>

      <Modal open={showAdd} onClose={() => setShowAdd(false)} title="Add Employee">
        <AddEmployeeForm
          onDone={() => {
            setShowAdd(false)
            load()
          }}
        />
      </Modal>

      <Modal open={!!resetTarget} onClose={() => setResetTarget(null)} title={`Reset PIN for ${resetTarget?.display_name}`}>
        {resetTarget && (
          <ResetPinForm
            employee={resetTarget}
            onDone={() => {
              setResetTarget(null)
              load()
            }}
          />
        )}
      </Modal>
    </div>
  )
}

function AddEmployeeForm({ onDone }: { onDone: () => void }) {
  const [fullName, setFullName] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [pin, setPin] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!/^\d{4}$/.test(pin)) {
      setError('PIN must be exactly 4 digits.')
      return
    }
    setSaving(true)
    setError(null)
    const { data, error } = await supabase.functions.invoke('admin-create-employee', {
      body: { role: 'employee', full_name: fullName, display_name: displayName, pin },
    })
    setSaving(false)
    if (error || data?.error) {
      setError(data?.error ?? error?.message ?? 'Could not create employee')
      return
    }
    onDone()
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <Input label="Full Name" value={fullName} onChange={(e) => setFullName(e.target.value)} required />
      <Input
        label="Display Name (shown on login screen)"
        value={displayName}
        onChange={(e) => setDisplayName(e.target.value)}
        required
      />
      <Input
        label="4-digit PIN"
        value={pin}
        onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
        inputMode="numeric"
        required
      />
      {error && <p className="text-sm font-semibold text-ocean-700">{error}</p>}
      <Button type="submit" disabled={saving} fullWidth>
        {saving ? <Spinner className="h-5 w-5 border-white/40 border-t-white" /> : 'Create Employee'}
      </Button>
    </form>
  )
}

function ResetPinForm({ employee, onDone }: { employee: Employee; onDone: () => void }) {
  const [pin, setPin] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!/^\d{4}$/.test(pin)) {
      setError('PIN must be exactly 4 digits.')
      return
    }
    setSaving(true)
    setError(null)
    const { error } = await supabase.rpc('admin_set_employee_pin', {
      p_employee_id: employee.id,
      p_pin: pin,
    })
    setSaving(false)
    if (error) {
      setError(error.message)
      return
    }
    onDone()
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <Input
        label="New 4-digit PIN"
        value={pin}
        onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
        inputMode="numeric"
        required
      />
      {error && <p className="text-sm font-semibold text-ocean-700">{error}</p>}
      <Button type="submit" disabled={saving} fullWidth>
        {saving ? <Spinner className="h-5 w-5 border-white/40 border-t-white" /> : 'Update PIN'}
      </Button>
    </form>
  )
}
