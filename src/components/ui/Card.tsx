import type { HTMLAttributes } from 'react'

export function Card({ className = '', ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={`rounded-3xl border border-sand-200 bg-white p-5 shadow-sm shadow-ocean-900/5 ${className}`}
      {...rest}
    />
  )
}
