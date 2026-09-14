import { forwardRef } from 'react'
import type { HTMLAttributes } from 'react'

export const Card = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(function Card(
  { className = '', ...rest },
  ref
) {
  return (
    <div
      ref={ref}
      className={`rounded-3xl border border-sand-200 bg-white p-5 shadow-sm shadow-ocean-900/5 ${className}`}
      {...rest}
    />
  )
})
