import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { AuthProvider, useAuth } from './contexts/AuthContext2'
import Login       from './pages/Login'
import Home        from './pages/Home'
import Lottery     from './pages/Lottery'
import Stats       from './pages/Stats'
import Premium     from './pages/Premium'
import Referral    from './pages/Referral'

function PrivateRoute({ children }) {
  const { session, loading } = useAuth()
  if (loading) return null
  return session ? children : <Navigate to="/login" replace />
}

// /register?ref=CODIGO → /login?ref=CODIGO
function RegisterRedirect() {
  const { search } = useLocation()
  return <Navigate to={`/login${search}`} replace />
}

function AppRoutes() {
  const { session, loading } = useAuth()
  if (loading) return null
  return (
    <Routes>
      <Route path="/login"    element={session ? <Navigate to="/" replace /> : <Login />} />
      <Route path="/register" element={<RegisterRedirect />} />
      <Route path="/"         element={<PrivateRoute><Home /></PrivateRoute>} />
      <Route path="/lottery"  element={<PrivateRoute><Lottery /></PrivateRoute>} />
      <Route path="/stats"    element={<PrivateRoute><Stats /></PrivateRoute>} />
      <Route path="/premium"  element={<PrivateRoute><Premium /></PrivateRoute>} />
      <Route path="/referral" element={<PrivateRoute><Referral /></PrivateRoute>} />
    </Routes>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  )
}