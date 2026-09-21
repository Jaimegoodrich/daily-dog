import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Input, Textarea } from '@/components/ui/Field'
import { Spinner } from '@/components/ui/Spinner'

function todayStr() {
  return new Date().toISOString().slice(0, 10)
}

/**
 * Admin editor for the "good morning" note that shows on every employee's
 * opening screen on the chosen date. Saving an empty note removes it.
 */
export function MorningNoteEditor() {
  const [date, setDate] = useState(todayStr())
  const [saved, setSaved] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    supabase
      .from('admin_notes')
      .select('note')
      .eq('date', date)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return
        setSaved(data?.note ?? '')
        setDraft(data?.note ?? '')
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [date])

  async function handleSave() {
    setSaving(true)
    setError(null)
    const note = draft.trim()
    const { error } = note
      ? await supabase.from('admin_notes').upsert({ date, note, updated_at: new Date().toISOString() })
      : await supabase.from('admin_notes').delete().eq('date', date)
    setSaving(false)
    if (error) {
      setError(error.message)
      return
    }
    setSaved(note)
    setDraft(note)
  }

  const dirty = draft.trim() !== (saved ?? '')

  return (
    <Card className="mb-6">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-lg font-bold text-ocean-900">📝 Good Morning Note</h2>
        <Input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} className="w-44" />
      </div>
      <p className="mb-3 text-sm text-ocean-700/70">
        Shows at the top of every employee's home screen on this date. Clear it and save to remove it.
      </p>
      {loading ? (
        <div className="flex justify-center py-6">
          <Spinner className="h-6 w-6" />
        </div>
      ) : (
        <>
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Good morning team! Anything to know about today — schedule changes, route swaps, reminders..."
          />
          {error && <p className="mt-2 text-sm font-semibold text-red-600">Couldn't save: {error}</p>}
          <div className="mt-3 flex items-center gap-3">
            <Button onClick={handleSave} disabled={saving || !dirty}>
              {saving ? <Spinner className="h-5 w-5 border-white/40 border-t-white" /> : 'Save Note'}
            </Button>
            {!dirty && saved && <span className="text-sm font-semibold text-green-600">Saved ✓</span>}
          </div>
        </>
      )}
    </Card>
  )
}
