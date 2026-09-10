export function Spinner({ className = '' }: { className?: string }) {
  return (
    <div
      className={`h-6 w-6 animate-spin rounded-full border-4 border-ocean-200 border-t-ocean-600 ${className}`}
      role="status"
      aria-label="Loading"
    />
  )
}

export function FullPageSpinner() {
  return (
    <div className="flex h-screen items-center justify-center bg-sand-50">
      <Spinner className="h-10 w-10" />
    </div>
  )
}
