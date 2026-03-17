import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient2'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [session, setSession] = useState(undefined)
  const [profile, setProfile] = useState(null)

  const [showBalance, setShowBalance] = useState(() => {
    const saved = localStorage.getItem('showBalance')
    return saved !== null ? JSON.parse(saved) : true
  })

  useEffect(() => {
    localStorage.setItem('showBalance', JSON.stringify(showBalance))
  }, [showBalance])

  async function fetchProfile(userId) {
    const { data } = await supabase
      .from('profiles')
      .select(`
        id, display_name, balance, is_premium,
        premium_type, premium_expires_at,
        last_mined_at, last_premium_at,
        referral_code, referred_by, referral_count
      `)
      .eq('id', userId)
      .single()
    setProfile(data)
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      if (session) fetchProfile(session.user.id)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
      if (session) fetchProfile(session.user.id)
      else setProfile(null)
    })

    return () => subscription.unsubscribe()
  }, [])

  async function signIn(email, password) {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw error
  }

  async function signUp(email, password, displayName) {
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: displayName } },
    })
    if (error) throw error
  }

  async function signOut() {
    await supabase.auth.signOut()
  }

  async function refreshProfile() {
    if (session?.user?.id) await fetchProfile(session.user.id)
  }

  const loading = session === undefined

  return (
    <AuthContext.Provider value={{
      session,
      profile,
      signIn,
      signUp,
      signOut,
      refreshProfile,
      showBalance,
      setShowBalance,
    }}>
      {!loading && children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)