import type { ReactNode } from 'react'
import { NavLink } from 'react-router-dom'
import { useAuth } from '@/contexts/AuthContext'

interface NavItem {
  to: string
  label: string
}

export function Layout({ navItems, children }: { navItems: NavItem[]; children: ReactNode }) {
  const { profile, employee, signOut } = useAuth()
  const displayName = employee?.display_name ?? profile?.full_name ?? ''

  return (
    <div className="min-h-screen bg-sand-50">
      <header className="bg-gradient-to-r from-ocean-700 via-ocean-600 to-ocean-400 px-4 py-4 text-white shadow-md">
        <div className="mx-auto flex max-w-5xl items-center justify-between">
          <div className="font-display text-xl font-extrabold tracking-tight">
            🐾 Daily Dog
          </div>
          <div className="flex items-center gap-3 text-sm">
            <span className="hidden sm:inline font-semibold">{displayName}</span>
            <button
              onClick={signOut}
              className="rounded-full bg-white/20 px-3 py-1.5 font-semibold hover:bg-white/30"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      <nav className="sticky top-0 z-10 border-b border-sand-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-5xl gap-1 overflow-x-auto px-2">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/admin' || item.to === '/today'}
              className={({ isActive }) =>
                `whitespace-nowrap px-4 py-3 font-display text-sm font-semibold transition-colors ${
                  isActive
                    ? 'border-b-2 border-ocean-600 text-ocean-800'
                    : 'text-ocean-700/70 hover:text-ocean-700'
                }`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </div>
      </nav>

      <main className="mx-auto max-w-5xl px-4 py-6">{children}</main>
    </div>
  )
}
