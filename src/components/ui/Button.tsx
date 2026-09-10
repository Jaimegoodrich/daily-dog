import type { ButtonHTMLAttributes } from 'react'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'

const variantClasses: Record<Variant, string> = {
  primary:
    'bg-ocean-600 text-white hover:bg-ocean-700 active:bg-ocean-800 shadow-sm shadow-ocean-900/10',
  secondary:
    'bg-sun-400 text-ocean-900 hover:bg-sun-500 active:bg-sun-600 shadow-sm shadow-sun-900/10',
  ghost: 'bg-transparent text-ocean-700 hover:bg-ocean-100',
  danger: 'bg-ocean-800 text-white hover:bg-ocean-900 active:bg-ocean-900',
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  fullWidth?: boolean
}

export function Button({
  variant = 'primary',
  fullWidth,
  className = '',
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      className={`inline-flex items-center justify-center gap-2 rounded-2xl px-5 py-3 font-display font-semibold text-base transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${variantClasses[variant]} ${fullWidth ? 'w-full' : ''} ${className}`}
      {...rest}
    >
      {children}
    </button>
  )
}
