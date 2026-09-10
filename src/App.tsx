import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { AuthProvider, useAuth } from '@/contexts/AuthContext'
import { FullPageSpinner } from '@/components/ui/Spinner'
import { Layout } from '@/components/Layout'
import { Login } from '@/pages/Login'
import { ResetPassword } from '@/pages/ResetPassword'
import { Gallery } from '@/pages/Gallery'
import { EmployeeDashboard } from '@/pages/employee/Dashboard'
import { EmployeeSchedule } from '@/pages/employee/Schedule'
import { RouteRun } from '@/pages/employee/RouteRun'
import { EndOfShift } from '@/pages/employee/EndOfShift'
import { AdminDashboard } from '@/pages/admin/Dashboard'
import { AdminCalendar } from '@/pages/admin/Calendar'
import { WeeklySchedule } from '@/pages/admin/WeeklySchedule'
import { AdminRoutes } from '@/pages/admin/Routes'
import { AdminReports } from '@/pages/admin/Reports'
import { WeeklyReport } from '@/pages/admin/WeeklyReport'
import { AdminEmployees } from '@/pages/admin/Employees'
import { ClientList } from '@/pages/admin/clients/ClientList'
import { ClientForm } from '@/pages/admin/clients/ClientForm'

function AppRoutes() {
  const { session, profile, loading } = useAuth()
  const location = useLocation()

  if (location.pathname === '/reset-password') return <ResetPassword />

  if (loading) return <FullPageSpinner />
  if (!session || !profile) return <Login />

  if (profile.role === 'admin') {
    const navItems = [
      { to: '/admin', label: 'Dashboard' },
      { to: '/admin/clients', label: 'Clients' },
      { to: '/admin/schedule', label: 'Weekly Schedule' },
      { to: '/admin/calendar', label: 'Calendar' },
      { to: '/admin/routes', label: 'Routes' },
      { to: '/admin/reports', label: 'Reports' },
      { to: '/admin/weekly-report', label: 'Weekly Report' },
      { to: '/admin/employees', label: 'Employees' },
      { to: '/admin/gallery', label: 'Gallery' },
    ]
    return (
      <Layout navItems={navItems}>
        <Routes>
          <Route path="/admin" element={<AdminDashboard />} />
          <Route path="/admin/clients" element={<ClientList />} />
          <Route path="/admin/clients/:clientId" element={<ClientForm />} />
          <Route path="/admin/schedule" element={<WeeklySchedule />} />
          <Route path="/admin/calendar" element={<AdminCalendar />} />
          <Route path="/admin/routes" element={<AdminRoutes />} />
          <Route path="/admin/reports" element={<AdminReports />} />
          <Route path="/admin/weekly-report" element={<WeeklyReport />} />
          <Route path="/admin/employees" element={<AdminEmployees />} />
          <Route path="/admin/gallery" element={<Gallery isAdmin />} />
          <Route path="*" element={<Navigate to="/admin" replace />} />
        </Routes>
      </Layout>
    )
  }

  const navItems = [
    { to: '/today', label: 'Today' },
    { to: '/schedule', label: 'Schedule' },
    { to: '/gallery', label: 'Gallery' },
  ]
  return (
    <Layout navItems={navItems}>
      <Routes>
        <Route path="/today" element={<EmployeeDashboard />} />
        <Route path="/schedule" element={<EmployeeSchedule />} />
        <Route path="/route/:routeId" element={<RouteRun />} />
        <Route path="/end-of-shift/:routeId" element={<EndOfShift />} />
        <Route path="/gallery" element={<Gallery />} />
        <Route path="*" element={<Navigate to="/today" replace />} />
      </Routes>
    </Layout>
  )
}

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  )
}

export default App
