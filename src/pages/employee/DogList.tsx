import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '@/lib/supabaseClient'
import { Card } from '@/components/ui/Card'
import { Input } from '@/components/ui/Field'
import { Spinner } from '@/components/ui/Spinner'
import type { Client, Dog } from '@/types/database'

type DogWithClient = Dog & { client: Client }

export function EmployeeDogList() {
  const [dogs, setDogs] = useState<DogWithClient[] | null>(null)
  const [search, setSearch] = useState('')

  useEffect(() => {
    supabase
      .from('dogs')
      .select('*, client:clients(*)')
      .order('name')
      .then(({ data }) => setDogs((data as DogWithClient[] | null) ?? []))
  }, [])

  const filtered = dogs?.filter((d) => d.name.toLowerCase().includes(search.toLowerCase()))

  return (
    <div>
      <h1 className="mb-6 font-display text-2xl font-extrabold text-ocean-900">🐕 Dogs</h1>

      <Input
        placeholder="Search dogs..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="mb-4"
      />

      {dogs === null && (
        <div className="flex justify-center py-10">
          <Spinner className="h-8 w-8" />
        </div>
      )}

      <div className="flex flex-col gap-3">
        {filtered?.map((dog) => (
          <Link key={dog.id} to={`/dogs/${dog.client_id}`}>
            <Card className="hover:border-ocean-300">
              <p className="font-display text-lg font-bold text-ocean-900">{dog.name}</p>
              <p className="text-sm text-ocean-700/70">{dog.client.main_name}</p>
            </Card>
          </Link>
        ))}
        {filtered?.length === 0 && <p className="text-center text-ocean-700/50">No dogs found.</p>}
      </div>
    </div>
  )
}
