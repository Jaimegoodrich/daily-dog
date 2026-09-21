import { useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { useAuth } from '@/contexts/AuthContext'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { Input } from '@/components/ui/Field'
import { Spinner } from '@/components/ui/Spinner'
import type { Dog, Photo } from '@/types/database'

type PhotoWithTags = Photo & { dogs: Dog[]; url: string | null }

export function Gallery({ isAdmin = false }: { isAdmin?: boolean }) {
  const { employee } = useAuth()
  const [photos, setPhotos] = useState<PhotoWithTags[] | null>(null)
  const [pendingFiles, setPendingFiles] = useState<File[]>([])
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [dogs, setDogs] = useState<Dog[] | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  async function loadPhotos() {
    const { data } = await supabase
      .from('photos')
      .select('*, photo_tags(dog:dogs(*))')
      .order('created_at', { ascending: false })

    const rows = (data as (Photo & { photo_tags: { dog: Dog }[] })[]) ?? []
    const paths = rows.map((r) => r.storage_path)
    let urlByPath = new Map<string, string>()

    if (paths.length > 0) {
      const { data: signed } = await supabase.storage.from('media').createSignedUrls(paths, 3600)
      signed?.forEach((s) => {
        if (s.signedUrl) urlByPath.set(s.path ?? '', s.signedUrl)
      })
    }

    setPhotos(
      rows.map((r) => ({
        ...r,
        dogs: r.photo_tags.map((t) => t.dog),
        url: urlByPath.get(r.storage_path) ?? null,
      }))
    )
  }

  useEffect(() => {
    loadPhotos()
  }, [])

  function handlePick(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    // Reset so picking the same photo(s) again still fires onChange.
    e.target.value = ''
    if (files.length === 0) return
    setPendingFiles(files)
    if (!dogs) {
      supabase
        .from('dogs')
        .select('*')
        .order('name')
        .then(({ data }) => setDogs(data ?? []))
    }
  }

  // Uploads every picked photo one at a time, tagging each with the same dogs.
  async function handleUpload(dogIds: string[]) {
    if (pendingFiles.length === 0 || dogIds.length === 0 || progress) return
    const files = pendingFiles
    const failures: string[] = []
    setProgress({ done: 0, total: files.length })

    for (const [i, file] of files.entries()) {
      // Photos picked from the library can have spaces or other characters in
      // their names that storage keys don't allow.
      const safeName = file.name.replace(/[^A-Za-z0-9._-]/g, '_')
      const path = `gallery/${Date.now()}-${i}-${safeName}`
      const { error: uploadError } = await supabase.storage.from('media').upload(path, file)
      if (uploadError) {
        failures.push(`${file.name}: ${uploadError.message}`)
      } else {
        const { data: photo, error: photoError } = await supabase
          .from('photos')
          .insert({ uploaded_by: employee?.id ?? null, storage_path: path })
          .select('id')
          .single()
        if (photoError || !photo) {
          failures.push(`${file.name}: ${photoError?.message ?? 'Could not save photo'}`)
        } else {
          await supabase.from('photo_tags').insert(dogIds.map((dog_id) => ({ photo_id: photo.id, dog_id })))
        }
      }
      setProgress({ done: i + 1, total: files.length })
    }

    setProgress(null)
    setPendingFiles([])
    await loadPhotos()
    if (failures.length > 0) {
      alert(`${failures.length} of ${files.length} photos didn't upload:\n\n${failures.join('\n')}`)
    }
  }

  async function handleDelete(photo: PhotoWithTags) {
    if (!confirm('Delete this photo?')) return
    await supabase.storage.from('media').remove([photo.storage_path])
    await supabase.from('photos').delete().eq('id', photo.id)
    await loadPhotos()
  }

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-extrabold text-ocean-900">📸 Gallery</h1>
        <Button onClick={() => fileInputRef.current?.click()}>+ Add Photo</Button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={handlePick}
        />
      </div>

      {photos === null && (
        <div className="flex justify-center py-10">
          <Spinner className="h-8 w-8" />
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
        {photos?.map((photo) => (
          <Card key={photo.id} className="overflow-hidden p-0">
            {photo.url && (
              <img
                src={photo.url}
                alt={photo.dogs.map((d) => d.name).join(', ') || 'dog'}
                className="aspect-square w-full object-cover"
              />
            )}
            <div className="flex flex-col gap-1 p-3">
              <p className="font-display font-bold text-ocean-900">
                {photo.dogs.length > 0 ? photo.dogs.map((d) => d.name).join(', ') : 'Unknown'}
              </p>
              {isAdmin && photo.url && (
                <div className="flex gap-3">
                  <a
                    href={photo.url}
                    download
                    className="text-sm font-semibold text-ocean-600 hover:underline"
                  >
                    Download
                  </a>
                  <button
                    onClick={() => handleDelete(photo)}
                    className="text-sm font-semibold text-ocean-700 hover:underline"
                  >
                    Delete
                  </button>
                </div>
              )}
            </div>
          </Card>
        ))}
      </div>

      <Modal
        open={pendingFiles.length > 0}
        onClose={() => !progress && setPendingFiles([])}
        title={pendingFiles.length > 1 ? `Tag the dogs in these ${pendingFiles.length} photos` : 'Tag the dogs in this photo'}
      >
        <DogPicker dogs={dogs} photoCount={pendingFiles.length} progress={progress} onConfirm={handleUpload} />
      </Modal>
    </div>
  )
}

function DogPicker({
  dogs,
  photoCount,
  progress,
  onConfirm,
}: {
  dogs: Dog[] | null
  photoCount: number
  progress: { done: number; total: number } | null
  onConfirm: (dogIds: string[]) => void
}) {
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())

  if (!dogs) {
    return (
      <div className="flex justify-center py-6">
        <Spinner />
      </div>
    )
  }

  const filtered = dogs.filter((d) => d.name.toLowerCase().includes(search.toLowerCase()))

  function toggle(dogId: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(dogId)) next.delete(dogId)
      else next.add(dogId)
      return next
    })
  }

  return (
    <div>
      <Input
        placeholder="Search dogs..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="mb-3"
      />
      <div className="mb-3 max-h-72 overflow-y-auto">
        {filtered.map((dog) => (
          <label
            key={dog.id}
            className="flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2 font-semibold text-ocean-800 hover:bg-ocean-50"
          >
            <input type="checkbox" checked={selected.has(dog.id)} onChange={() => toggle(dog.id)} />
            {dog.name}
          </label>
        ))}
        {filtered.length === 0 && <p className="py-4 text-center text-ocean-700/50">No dogs found.</p>}
      </div>
      {photoCount > 1 && (
        <p className="mb-3 text-sm text-ocean-700/70">The dogs you pick are tagged on all {photoCount} photos.</p>
      )}
      <Button fullWidth disabled={selected.size === 0 || !!progress} onClick={() => onConfirm([...selected])}>
        {progress
          ? `Uploading ${Math.min(progress.done + 1, progress.total)} of ${progress.total}...`
          : `Tag ${selected.size > 0 ? `${selected.size} Dog${selected.size === 1 ? '' : 's'}` : 'Dogs'} & Upload${photoCount > 1 ? ` ${photoCount} Photos` : ''}`}
      </Button>
    </div>
  )
}
