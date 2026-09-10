import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '@/lib/supabaseClient'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input, Select, Textarea } from '@/components/ui/Field'
import { Spinner } from '@/components/ui/Spinner'
import type { Child, Client, Dog, HouseholdMember, HouseholdRole } from '@/types/database'

const ROLE_OPTIONS: { value: HouseholdRole; label: string }[] = [
  { value: 'owner', label: 'Owner' },
  { value: 'nanny', label: 'Nanny' },
  { value: 'house_manager', label: 'House Manager' },
  { value: 'housekeeper', label: 'Housekeeper' },
  { value: 'chef', label: 'Chef' },
  { value: 'personal_assistant', label: 'Personal Assistant' },
]

type ChildRow = Partial<Child> & { key: string }
type MemberRow = Partial<HouseholdMember> & { key: string }
type DogRow = Partial<Dog> & { key: string; pictureFile?: File; pictureUrl?: string | null }

function emptyClient(): Partial<Client> {
  return {
    main_name: '',
    spouse_name: '',
    address: '',
    primary_contact_name: '',
    primary_contact_role: undefined,
    primary_phone: '',
    secondary_contact_name: '',
    secondary_contact_role: undefined,
    secondary_phone: '',
    contact3_name: '',
    contact3_role: undefined,
    contact3_phone: '',
    gate_code: '',
    alarm_code: '',
    pickup_notes: '',
    dropoff_notes: '',
    additional_notes: '',
  }
}

export function ClientForm() {
  const { clientId } = useParams<{ clientId: string }>()
  const isNew = !clientId || clientId === 'new'
  const navigate = useNavigate()

  const [client, setClient] = useState<Partial<Client>>(emptyClient())
  const [children, setChildren] = useState<ChildRow[]>([])
  const [members, setMembers] = useState<MemberRow[]>([])
  const [dogs, setDogs] = useState<DogRow[]>([])
  const [loading, setLoading] = useState(!isNew)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (isNew) return
    async function load() {
      const [{ data: clientData }, { data: childData }, { data: memberData }, { data: dogData }] =
        await Promise.all([
          supabase.from('clients').select('*').eq('id', clientId).single(),
          supabase.from('children').select('*').eq('client_id', clientId),
          supabase.from('household_members').select('*').eq('client_id', clientId),
          supabase.from('dogs').select('*').eq('client_id', clientId),
        ])
      setClient(clientData ?? emptyClient())
      setChildren((childData ?? []).map((c) => ({ ...c, key: c.id })))
      setMembers((memberData ?? []).map((m) => ({ ...m, key: m.id })))
      setDogs((dogData ?? []).map((d) => ({ ...d, key: d.id, pictureUrl: d.picture_url })))
      setLoading(false)
    }
    load()
  }, [clientId, isNew])

  async function handleSave() {
    if (!client.main_name?.trim()) {
      setError('Main name is required.')
      return
    }
    setSaving(true)
    setError(null)

    try {
      let id = clientId
      if (isNew) {
        const { data, error } = await supabase.from('clients').insert(client as any).select('id').single()
        if (error) throw error
        id = data.id
      } else {
        const { error } = await supabase.from('clients').update(client as any).eq('id', clientId)
        if (error) throw error
      }

      // Children & household members: no other tables reference them, so a
      // clean delete-and-reinsert per save is simplest and safe.
      await supabase.from('children').delete().eq('client_id', id)
      const childRows = children.filter((c) => c.name?.trim())
      if (childRows.length > 0) {
        await supabase
          .from('children')
          .insert(childRows.map((c) => ({ client_id: id, name: c.name, phone: c.phone })) as any)
      }

      await supabase.from('household_members').delete().eq('client_id', id)
      const memberRows = members.filter((m) => m.name?.trim())
      if (memberRows.length > 0) {
        await supabase.from('household_members').insert(
          memberRows.map((m) => ({
            client_id: id,
            name: m.name,
            role: m.role,
            phone: m.phone,
          })) as any
        )
      }

      // Dogs carry history (schedule entries, photos), so update-in-place /
      // insert-new instead of delete-and-reinsert.
      for (const dog of dogs) {
        const { pictureFile, key: _key, pictureUrl: _pictureUrl, ...fields } = dog
        if (!fields.name?.trim()) continue

        let dogId = fields.id
        if (dogId) {
          const { id: _omit, ...updateFields } = fields
          await supabase.from('dogs').update(updateFields as any).eq('id', dogId)
        } else {
          const { data, error } = await supabase
            .from('dogs')
            .insert({ ...fields, client_id: id } as any)
            .select('id')
            .single()
          if (error) throw error
          dogId = data.id
        }

        if (pictureFile && dogId) {
          const path = `dogs/${dogId}/${Date.now()}-${pictureFile.name}`
          const { error: uploadError } = await supabase.storage.from('media').upload(path, pictureFile)
          if (!uploadError) {
            await supabase.from('dogs').update({ picture_url: path } as any).eq('id', dogId)
          }
        }
      }

      navigate('/admin/clients')
    } catch (err: any) {
      setError(err.message ?? 'Something went wrong saving this client.')
    } finally {
      setSaving(false)
    }
  }

  async function handleDeleteDog(key: string) {
    const dog = dogs.find((d) => d.key === key)
    if (!dog) return
    if (dog.id && !confirm(`Delete ${dog.name}? This also removes their photos and schedule history.`)) {
      return
    }
    if (dog.id) {
      await supabase.from('dogs').delete().eq('id', dog.id)
    }
    setDogs((prev) => prev.filter((d) => d.key !== key))
  }

  if (loading) {
    return (
      <div className="flex justify-center py-10">
        <Spinner className="h-8 w-8" />
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-3xl">
      <button
        onClick={() => navigate('/admin/clients')}
        className="mb-4 text-sm font-semibold text-ocean-600 hover:underline"
      >
        ← Back to clients
      </button>

      <h1 className="mb-6 font-display text-2xl font-extrabold text-ocean-900">
        {isNew ? 'Add Client' : client.main_name}
      </h1>

      <Card className="mb-6">
        <h2 className="mb-4 font-display text-lg font-bold text-ocean-800">Household</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input
            label="Main Name"
            value={client.main_name ?? ''}
            onChange={(e) => setClient({ ...client, main_name: e.target.value })}
            required
          />
          <Input
            label="Spouse Name"
            value={client.spouse_name ?? ''}
            onChange={(e) => setClient({ ...client, spouse_name: e.target.value })}
          />
          <div className="sm:col-span-2">
            <Input
              label="Address"
              value={client.address ?? ''}
              onChange={(e) => setClient({ ...client, address: e.target.value })}
            />
          </div>
          <Input
            label="Gate Code"
            value={client.gate_code ?? ''}
            onChange={(e) => setClient({ ...client, gate_code: e.target.value })}
          />
          <Input
            label="Alarm Code"
            value={client.alarm_code ?? ''}
            onChange={(e) => setClient({ ...client, alarm_code: e.target.value })}
          />
        </div>
      </Card>

      <Card className="mb-6">
        <h2 className="mb-4 font-display text-lg font-bold text-ocean-800">Contacts</h2>
        <ContactFields
          title="Primary Contact"
          name={client.primary_contact_name ?? ''}
          role={client.primary_contact_role}
          phone={client.primary_phone ?? ''}
          onName={(v) => setClient({ ...client, primary_contact_name: v })}
          onRole={(v) => setClient({ ...client, primary_contact_role: v })}
          onPhone={(v) => setClient({ ...client, primary_phone: v })}
        />
        <div className="my-4 border-t border-sand-200" />
        <ContactFields
          title="Secondary Contact"
          name={client.secondary_contact_name ?? ''}
          role={client.secondary_contact_role}
          phone={client.secondary_phone ?? ''}
          onName={(v) => setClient({ ...client, secondary_contact_name: v })}
          onRole={(v) => setClient({ ...client, secondary_contact_role: v })}
          onPhone={(v) => setClient({ ...client, secondary_phone: v })}
        />
        <div className="my-4 border-t border-sand-200" />
        <ContactFields
          title="Contact #3"
          name={client.contact3_name ?? ''}
          role={client.contact3_role}
          phone={client.contact3_phone ?? ''}
          onName={(v) => setClient({ ...client, contact3_name: v })}
          onRole={(v) => setClient({ ...client, contact3_role: v })}
          onPhone={(v) => setClient({ ...client, contact3_phone: v })}
        />
      </Card>

      <Card className="mb-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-lg font-bold text-ocean-800">Children</h2>
          <Button
            variant="ghost"
            onClick={() => setChildren([...children, { key: crypto.randomUUID(), name: '', phone: '' }])}
          >
            + Add Child
          </Button>
        </div>
        {children.map((child) => (
          <div key={child.key} className="mb-3 flex gap-3">
            <Input
              placeholder="Name"
              value={child.name ?? ''}
              onChange={(e) =>
                setChildren(children.map((c) => (c.key === child.key ? { ...c, name: e.target.value } : c)))
              }
              className="flex-1"
            />
            <Input
              placeholder="Phone"
              value={child.phone ?? ''}
              onChange={(e) =>
                setChildren(children.map((c) => (c.key === child.key ? { ...c, phone: e.target.value } : c)))
              }
              className="flex-1"
            />
            <button
              onClick={() => setChildren(children.filter((c) => c.key !== child.key))}
              className="text-ocean-700"
            >
              ✕
            </button>
          </div>
        ))}
      </Card>

      <Card className="mb-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-lg font-bold text-ocean-800">Other Household Members</h2>
          <Button
            variant="ghost"
            onClick={() =>
              setMembers([...members, { key: crypto.randomUUID(), name: '', role: undefined, phone: '' }])
            }
          >
            + Add Member
          </Button>
        </div>
        {members.map((member) => (
          <div key={member.key} className="mb-3 flex gap-3">
            <Input
              placeholder="Name"
              value={member.name ?? ''}
              onChange={(e) =>
                setMembers(members.map((m) => (m.key === member.key ? { ...m, name: e.target.value } : m)))
              }
              className="flex-1"
            />
            <Select
              value={member.role ?? ''}
              onChange={(e) =>
                setMembers(
                  members.map((m) =>
                    m.key === member.key ? { ...m, role: e.target.value as HouseholdRole } : m
                  )
                )
              }
              className="flex-1"
            >
              <option value="">Role...</option>
              {ROLE_OPTIONS.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </Select>
            <Input
              placeholder="Phone"
              value={member.phone ?? ''}
              onChange={(e) =>
                setMembers(members.map((m) => (m.key === member.key ? { ...m, phone: e.target.value } : m)))
              }
              className="flex-1"
            />
            <button
              onClick={() => setMembers(members.filter((m) => m.key !== member.key))}
              className="text-ocean-700"
            >
              ✕
            </button>
          </div>
        ))}
      </Card>

      <Card className="mb-6">
        <Textarea
          label="Pickup Notes"
          value={client.pickup_notes ?? ''}
          onChange={(e) => setClient({ ...client, pickup_notes: e.target.value })}
          className="mb-4"
        />
        <Textarea
          label="Dropoff Notes"
          value={client.dropoff_notes ?? ''}
          onChange={(e) => setClient({ ...client, dropoff_notes: e.target.value })}
          className="mb-4"
        />
        <Textarea
          label="Additional Notes"
          value={client.additional_notes ?? ''}
          onChange={(e) => setClient({ ...client, additional_notes: e.target.value })}
        />
      </Card>

      <Card className="mb-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-lg font-bold text-ocean-800">Dogs</h2>
          <Button
            variant="ghost"
            onClick={() => setDogs([...dogs, { key: crypto.randomUUID(), name: '' }])}
          >
            + Add Dog
          </Button>
        </div>
        {dogs.map((dog) => (
          <DogFields
            key={dog.key}
            dog={dog}
            onChange={(fields) => setDogs(dogs.map((d) => (d.key === dog.key ? { ...d, ...fields } : d)))}
            onDelete={() => handleDeleteDog(dog.key)}
          />
        ))}
        {dogs.length === 0 && <p className="text-ocean-700/50">No dogs added yet.</p>}
      </Card>

      {error && <p className="mb-4 text-sm font-semibold text-ocean-700">{error}</p>}

      <Button onClick={handleSave} disabled={saving} fullWidth>
        {saving ? <Spinner className="h-5 w-5 border-white/40 border-t-white" /> : 'Save Client'}
      </Button>
    </div>
  )
}

function ContactFields({
  title,
  name,
  role,
  phone,
  onName,
  onRole,
  onPhone,
}: {
  title: string
  name: string
  role?: HouseholdRole | null
  phone: string
  onName: (v: string) => void
  onRole: (v: HouseholdRole) => void
  onPhone: (v: string) => void
}) {
  return (
    <div>
      <p className="mb-2 font-semibold text-ocean-800">{title}</p>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Input placeholder="Name" value={name} onChange={(e) => onName(e.target.value)} />
        <Select value={role ?? ''} onChange={(e) => onRole(e.target.value as HouseholdRole)}>
          <option value="">Role...</option>
          {ROLE_OPTIONS.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </Select>
        <Input placeholder="Phone" value={phone} onChange={(e) => onPhone(e.target.value)} />
      </div>
    </div>
  )
}

function DogFields({
  dog,
  onChange,
  onDelete,
}: {
  dog: DogRow
  onChange: (fields: Partial<DogRow>) => void
  onDelete: () => void
}) {
  return (
    <div className="mb-4 rounded-2xl border border-sand-200 p-4">
      <div className="mb-3 flex items-center justify-between">
        <p className="font-display font-bold text-ocean-800">{dog.name || 'New Dog'}</p>
        <button onClick={onDelete} className="text-sm font-semibold text-ocean-700 hover:underline">
          Remove
        </button>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Input placeholder="Name" value={dog.name ?? ''} onChange={(e) => onChange({ name: e.target.value })} />
        <Input
          placeholder="Breed"
          value={dog.breed ?? ''}
          onChange={(e) => onChange({ breed: e.target.value })}
        />
        <Input
          type="date"
          label="Birthday"
          value={dog.birthday ?? ''}
          onChange={(e) => onChange({ birthday: e.target.value || undefined })}
        />
        <Input
          placeholder="Seating Position"
          value={dog.seating_position ?? ''}
          onChange={(e) => onChange({ seating_position: e.target.value })}
        />
        <Input
          placeholder="Food Brand"
          value={dog.food_brand ?? ''}
          onChange={(e) => onChange({ food_brand: e.target.value })}
        />
        <Input
          placeholder="Feeding Instructions"
          value={dog.feeding_instructions ?? ''}
          onChange={(e) => onChange({ feeding_instructions: e.target.value })}
        />
        <div className="sm:col-span-2">
          <Textarea
            placeholder="Quirks"
            value={dog.quirks ?? ''}
            onChange={(e) => onChange({ quirks: e.target.value })}
          />
        </div>
        <Textarea
          placeholder="Health Issues"
          value={dog.health_issues ?? ''}
          onChange={(e) => onChange({ health_issues: e.target.value })}
        />
        <Textarea
          placeholder="Medications"
          value={dog.medications ?? ''}
          onChange={(e) => onChange({ medications: e.target.value })}
        />
        <Input
          placeholder="Primary Vet"
          value={dog.vet_name ?? ''}
          onChange={(e) => onChange({ vet_name: e.target.value })}
        />
        <Input
          placeholder="Vet Clinic"
          value={dog.vet_clinic_name ?? ''}
          onChange={(e) => onChange({ vet_clinic_name: e.target.value })}
        />
        <Input
          placeholder="Vet Phone"
          value={dog.vet_phone ?? ''}
          onChange={(e) => onChange({ vet_phone: e.target.value })}
        />
      </div>
      <div className="mt-3">
        <label className="mb-1 block text-sm font-semibold text-ocean-800">Picture</label>
        <input
          type="file"
          accept="image/*"
          onChange={(e) => e.target.files?.[0] && onChange({ pictureFile: e.target.files[0] })}
        />
      </div>
    </div>
  )
}
