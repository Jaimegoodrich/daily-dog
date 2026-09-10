import { useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { Button } from '@/components/ui/Button'
import { Select } from '@/components/ui/Field'
import { Spinner } from '@/components/ui/Spinner'
import type { CancelReason, ScheduleEntry } from '@/types/database'

const CANCEL_REASONS: { value: CancelReason; label: string }[] = [
  { value: 'vet', label: 'Vet' },
  { value: 'grooming', label: 'Grooming' },
  { value: 'vacation', label: 'Vacation' },
  { value: 'injury', label: 'Injury' },
  { value: 'other', label: 'Other' },
]

export function CancelScheduleForm({ entry, onDone }: { entry: ScheduleEntry; onDone: () => void }) {
  const [reason, setReason] = useState<CancelReason>('vet')
  const [lateCancel, setLateCancel] = useState(false)
  const [saving, setSaving] = useState(false)

  async function handleSubmit() {
    setSaving(true)
    await supabase
      .from('schedule_entries')
      .update({
        cancelled: true,
        cancel_reason: reason,
        late_cancel: lateCancel,
        pickup_route_id: null,
        pickup_route_order: null,
        dropoff_route_id: null,
        dropoff_route_order: null,
      })
      .eq('id', entry.id)
    setSaving(false)
    onDone()
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-ocean-700/70">{entry.check_in_date}</p>
      <Select label="Reason" value={reason} onChange={(e) => setReason(e.target.value as CancelReason)}>
        {CANCEL_REASONS.map((r) => (
          <option key={r.value} value={r.value}>
            {r.label}
          </option>
        ))}
      </Select>
      <label className="flex items-center gap-2 text-sm font-semibold text-ocean-800">
        <input type="checkbox" checked={lateCancel} onChange={(e) => setLateCancel(e.target.checked)} />
        LATE CANCEL
      </label>
      <Button onClick={handleSubmit} disabled={saving} fullWidth>
        {saving ? <Spinner className="h-5 w-5 border-white/40 border-t-white" /> : 'Cancel Hike'}
      </Button>
    </div>
  )
}
