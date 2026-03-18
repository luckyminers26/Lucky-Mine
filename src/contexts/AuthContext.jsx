import { createContext, useContext, useEffect, useState, useRef } from 'react'
import FingerprintJS from '@fingerprintjs/fingerprintjs'
import { supabase } from '../lib/supabaseClient2'

const AuthContext = createContext(null)

let fpPromise = null
async function getVisitorId() {
  if (!fpPromise) fpPromise = FingerprintJS.load().then(fp => fp.get())
  const result = await fpPromise
  return result.visitorId
}

export function AuthProvider({ children }) {
  const [session, setSession]     = useState(undefined)
  const [profile, setProfile]     = useState(null)
  const [visitorId, setVisitorId] = useState(() => localStorage.getItem('visitor_id'))
  const skipAuthChange            = useRef(false)

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

  async function registerDevice() {
    try {
      const vid = await getVisitorId()
      localStorage.setItem('visitor_id', vid)
      setVisitorId(vid)
      await supabase.rpc('register_device', { p_visitor_id: vid })
    } catch (e) {
      console.error('fingerprint error:', e)
    }
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      if (session) {
        fetchProfile(session.user.id)
        registerDevice()
      }
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (skipAuthChange.current) return
      setSession(session)
      if (session) {
        fetchProfile(session.user.id)
      } else {
        setProfile(null)
        localStorage.removeItem('visitor_id')
        setVisitorId(null)
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  async function signIn(email, password) {
    // Verifica dispositivo ANTES de logar
    let vid = null
    try { vid = await getVisitorId() } catch {}

    if (vid) {
      const { data: existing } = await supabase
        .from('device_fingerprints')
        .select('user_id')
        .eq('visitor_id', vid)
        .limit(1)
        .maybeSingle()

      if (existing) {
        // Dispositivo tem vínculo — verifica se é desta mesma conta
        // Faz login silencioso para descobrir o user_id sem triggerar redirect
        skipAuthChange.current = true
        const { data: authData, error } = await supabase.auth.signInWithPassword({ email, password })
        skipAuthChange.current = false

        if (error) throw error

        if (authData.user.id !== existing.user_id) {
          // É outra conta → desfaz login e bloqueia
          skipAuthChange.current = true
          await supabase.auth.signOut()
          skipAuthChange.current = false
          throw new Error('Este dispositivo já possui uma conta cadastrada. Acesse a conta original.')
        }

        // É a mesma conta → confirma a sessão normalmente
        setSession(authData.session)
        fetchProfile(authData.user.id)
        localStorage.setItem('visitor_id', vid)
        setVisitorId(vid)
        return
      }
    }

    // Dispositivo livre → login normal
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw error
    if (vid) {
      localStorage.setItem('visitor_id', vid)
      setVisitorId(vid)
    }
  }

  async function signUp(email, password, displayName) {
    let vid = null
    try { vid = await getVisitorId() } catch {}

    if (vid) {
      const { data: existing } = await supabase
        .from('device_fingerprints')
        .select('user_id')
        .eq('visitor_id', vid)
        .limit(1)
        .maybeSingle()

      if (existing) {
        throw new Error('Este dispositivo já possui uma conta cadastrada.')
      }
    }

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
      visitorId,
      registerDevice,
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