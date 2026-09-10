import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '@/lib/supabaseClient'
import { Card } from '@/components/ui/Card'
import { Spinner } from '@/components/ui/Spinner'
import type { Child, Client, Dog, HouseholdMember, HouseholdRole } from '@/types/database'

const ROLE_LABELS: Record<HouseholdRole, string> = {
  owner: 'Owner',
  nanny: 'Nanny',
  house_manager: 'House Manager',
  housekeeper: 'Housekeeper',
  chef: 'Chef',
  personal_assistant: 'Personal Assistant',
}

export function EmployeeClientView() {
  const { clientId } = useParams<{ clientId: string }>()
  const navigate = useNavigate()
  const [client, setClient] = useState<Client | null>(null)
  const [children, setChildren] = useState<Child[]>([])
  const [members, setMembers] = useState<HouseholdMember[]>([])
  const [dogs, setDogs] = useState<Dog[]>([])
  const [dogPhotoUrls, setDogPhotoUrls] = useState<Map<string, string>>(new Map())
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      const [{ data: clientData }, { data: childData }, { data: memberData }, { data: dogData }] =
        await Promise.all([
          supabase.from('clients').select('*').eq('id', clientId).single(),
          supabase.from('children').select('*').eq('client_id', clientId),
          supabase.from('household_members').select('*').eq('client_id', clientId),
          supabase.from('dogs').select('*').eq('client_id', clientId).order('name'),
        ])
      setClient(clientData)
      setChildren(childData ?? [])
      setMembers(memberData ?? [])
      setDogs(dogData ?? [])

      const paths = (dogData ?? []).map((d) => d.picture_url).filter((p): p is string => !!p)
      if (paths.length > 0) {
        const { data: signed } = await supabase.storage.from('media').createSignedUrls(paths, 3600)
        const map = new Map<string, string>()
        signed?.forEach((s) => {
          if (s.signedUrl) map.set(s.path ?? '', s.signedUrl)
        })
        setDogPhotoUrls(map)
      }
      setLoading(false)
    }
    load()
  }, [clientId])

  if (loading || !client) {
    return (
      <div className="flex justify-center py-10">
        <Spinner className="h-8 w-8" />
      </div>
    )
  }

  const hasPrimary = client.primary_contact_name || client.primary_phone
  const hasSecondary = client.secondary_contact_name || client.secondary_phone
  const hasContact3 = client.contact3_name || client.contact3_phone

  return (
    <div className="mx-auto max-w-2xl">
      <button
        onClick={() => navigate('/clients')}
        className="mb-4 text-sm font-semibold text-ocean-600 hover:underline"
      >
        ← Back to clients
      </button>

      <h1 className="mb-6 font-display text-2xl font-extrabold text-ocean-900">{client.main_name}</h1>

      <Card className="mb-4">
        <Field label="Spouse" value={client.spouse_name} />
        <Field label="Address" value={client.address} />
        <Field label="Gate Code" value={client.gate_code} />
        <Field label="Alarm Code" value={client.alarm_code} />
      </Card>

      {(hasPrimary || hasSecondary || hasContact3) && (
        <Card className="mb-4">
          <h2 className="mb-3 font-display text-lg font-bold text-ocean-800">Contacts</h2>
          {hasPrimary && (
            <ContactBlock
              title="Primary Contact"
              name={client.primary_contact_name}
              role={client.primary_contact_role}
              phone={client.primary_phone}
            />
          )}
          {hasSecondary && (
            <ContactBlock
              title="Secondary Contact"
              name={client.secondary_contact_name}
              role={client.secondary_contact_role}
              phone={client.secondary_phone}
            />
          )}
          {hasContact3 && (
            <ContactBlock title="Contact #3" name={client.contact3_name} role={client.contact3_role} phone={client.contact3_phone} />
          )}
        </Card>
      )}

      {children.length > 0 && (
        <Card className="mb-4">
          <h2 className="mb-3 font-display text-lg font-bold text-ocean-800">Children</h2>
          {children.map((c) => (
            <p key={c.id} className="text-sm text-ocean-800">
              <span className="font-semibold">{c.name}</span>
              {c.phone && <> — {c.phone}</>}
            </p>
          ))}
        </Card>
      )}

      {members.length > 0 && (
        <Card className="mb-4">
          <h2 className="mb-3 font-display text-lg font-bold text-ocean-800">Other Household Members</h2>
          {members.map((m) => (
            <p key={m.id} className="text-sm text-ocean-800">
              <span className="font-semibold">{m.name}</span>
              {m.role && <> — {ROLE_LABELS[m.role]}</>}
              {m.phone && <> — {m.phone}</>}
            </p>
          ))}
        </Card>
      )}

      {(client.pickup_notes || client.dropoff_notes || client.additional_notes) && (
        <Card className="mb-4">
          <Field label="Pickup Notes" value={client.pickup_notes} />
          <Field label="Dropoff Notes" value={client.dropoff_notes} />
          <Field label="Additional Notes" value={client.additional_notes} />
        </Card>
      )}

      <h2 className="mb-3 font-display text-lg font-bold text-ocean-800">Dogs</h2>
      <div className="flex flex-col gap-4">
        {dogs.map((dog) => (
          <Card key={dog.id}>
            <div className="mb-2 flex items-center gap-3">
              {dog.picture_url && dogPhotoUrls.get(dog.picture_url) && (
                <img
                  src={dogPhotoUrls.get(dog.picture_url)}
                  alt={dog.name}
                  className="h-14 w-14 rounded-full object-cover"
                />
              )}
              <p className="font-display text-lg font-bold text-ocean-900">{dog.name}</p>
            </div>
            <Field label="Breed" value={dog.breed} />
            <Field label="Seating Position" value={dog.seating_position} />
            <Field label="Quirks" value={dog.quirks} />
            <Field label="Health Issues" value={dog.health_issues} />
            <Field label="Medications" value={dog.medications} />
            <Field label="Food Brand" value={dog.food_brand} />
            <Field label="Feeding Instructions" value={dog.feeding_instructions} />
            <Field label="Primary Vet" value={dog.vet_name} />
            <Field label="Vet Clinic" value={dog.vet_clinic_name} />
            <Field label="Vet Phone" value={dog.vet_phone} />
          </Card>
        ))}
        {dogs.length === 0 && <p className="text-sm text-ocean-700/50">No dogs on file.</p>}
      </div>
    </div>
  )
}

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null
  return (
    <div className="mb-2">
      <p className="text-xs font-semibold uppercase text-ocean-700/50">{label}</p>
      <p className="text-sm text-ocean-800">{value}</p>
    </div>
  )
}

function ContactBlock({
  title,
  name,
  role,
  phone,
}: {
  title: string
  name: string | null
  role: HouseholdRole | null
  phone: string | null
}) {
  return (
    <div className="mb-2">
      <p className="text-xs font-semibold uppercase text-ocean-700/50">{title}</p>
      <p className="text-sm text-ocean-800">
        {[name, role ? ROLE_LABELS[role] : null, phone].filter(Boolean).join(' — ')}
      </p>
    </div>
  )
}
