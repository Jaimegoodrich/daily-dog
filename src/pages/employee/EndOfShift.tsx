import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '@/lib/supabaseClient'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Textarea } from '@/components/ui/Field'
import { Spinner } from '@/components/ui/Spinner'

export function EndOfShift() {
  const { routeId } = useParams<{ routeId: string }>()
  const navigate = useNavigate()
  const [vanIssues, setVanIssues] = useState('')
  const [farmIssues, setFarmIssues] = useState('')
  const [clientIssues, setClientIssues] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    const { error } = await supabase.rpc('submit_daily_report', {
      p_route_id: routeId!,
      p_van_issues: vanIssues || undefined,
      p_farm_issues: farmIssues || undefined,
      p_client_issues: clientIssues || undefined,
    })
    setSubmitting(false)
    if (error) {
      setError(error.message)
      return
    }
    setDone(true)
  }

  if (done) {
    return (
      <div className="flex flex-col items-center gap-4 py-16 text-center">
        <p className="text-6xl">🌅</p>
        <h1 className="font-display text-3xl font-extrabold text-ocean-900">
          Thank you, you're AWESOME!
        </h1>
        <p className="text-ocean-700/70">Your daily report has been sent to the admin.</p>
        <Button onClick={() => navigate('/today')}>Back to Today</Button>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-lg">
      <h1 className="mb-1 font-display text-2xl font-extrabold text-ocean-900">End of Shift</h1>
      <p className="mb-6 text-ocean-700/70">Anything to report before you close out?</p>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Card>
          <Textarea
            label="Van issues"
            placeholder="e.g. low on gas, weird noise, needs cleaning"
            value={vanIssues}
            onChange={(e) => setVanIssues(e.target.value)}
          />
        </Card>
        <Card>
          <Textarea
            label="Farm issues"
            placeholder="e.g. gate broken, water needs refilling"
            value={farmIssues}
            onChange={(e) => setFarmIssues(e.target.value)}
          />
        </Card>
        <Card>
          <Textarea
            label="Client issues"
            placeholder="Anything a client should know about"
            value={clientIssues}
            onChange={(e) => setClientIssues(e.target.value)}
          />
        </Card>
        {error && <p className="text-sm font-semibold text-ocean-700">{error}</p>}
        <Button type="submit" disabled={submitting} fullWidth>
          {submitting ? <Spinner className="h-5 w-5 border-white/40 border-t-white" /> : 'Submit Report'}
        </Button>
      </form>
    </div>
  )
}
