import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '@/lib/supabaseClient'
import { Card } from '@/components/ui/Card'
import { Input } from '@/components/ui/Field'
import { Spinner } from '@/components/ui/Spinner'
import type { Client } from '@/types/database'

export function EmployeeClientList() {
  const [clients, setClients] = useState<Client[] | null>(null)
  const [search, setSearch] = useState('')

  useEffect(() => {
    supabase
      .from('clients')
      .select('*')
      .order('main_name')
      .then(({ data }) => setClients(data ?? []))
  }, [])

  const filtered = clients?.filter((c) => c.main_name.toLowerCase().includes(search.toLowerCase()))

  return (
    <div>
      <h1 className="mb-6 font-display text-2xl font-extrabold text-ocean-900">👤 Clients</h1>

      <Input
        placeholder="Search clients..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="mb-4"
      />

      {clients === null && (
        <div className="flex justify-center py-10">
          <Spinner className="h-8 w-8" />
        </div>
      )}

      <div className="flex flex-col gap-3">
        {filtered?.map((client) => (
          <Link key={client.id} to={`/clients/${client.id}`}>
            <Card className="hover:border-ocean-300">
              <p className="font-display text-lg font-bold text-ocean-900">{client.main_name}</p>
              {client.address && <p className="text-sm text-ocean-700/70">{client.address}</p>}
            </Card>
          </Link>
        ))}
        {filtered?.length === 0 && <p className="text-center text-ocean-700/50">No clients found.</p>}
      </div>
    </div>
  )
}
