import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react'

const fieldClasses =
  'w-full rounded-xl border border-sand-300 bg-white px-4 py-2.5 text-ocean-900 placeholder:text-ocean-900/40 focus:border-ocean-500 focus:outline-none focus:ring-2 focus:ring-ocean-200'

function Label({ label, htmlFor }: { label?: string; htmlFor?: string }) {
  if (!label) return null
  return (
    <label htmlFor={htmlFor} className="mb-1 block text-sm font-semibold text-ocean-800">
      {label}
    </label>
  )
}

export function Input({
  label,
  id,
  className = '',
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & { label?: string }) {
  return (
    <div>
      <Label label={label} htmlFor={id} />
      <input id={id} className={`${fieldClasses} ${className}`} {...rest} />
    </div>
  )
}

export function Textarea({
  label,
  id,
  className = '',
  ...rest
}: TextareaHTMLAttributes<HTMLTextAreaElement> & { label?: string }) {
  return (
    <div>
      <Label label={label} htmlFor={id} />
      <textarea id={id} className={`${fieldClasses} min-h-24 ${className}`} {...rest} />
    </div>
  )
}

export function Select({
  label,
  id,
  className = '',
  children,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement> & { label?: string; children: ReactNode }) {
  return (
    <div>
      <Label label={label} htmlFor={id} />
      <select id={id} className={`${fieldClasses} ${className}`} {...rest}>
        {children}
      </select>
    </div>
  )
}
