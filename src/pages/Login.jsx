import { useState, useEffect } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabaseClient2'
import logo from '../assets/luckymine.png'
import './Login.css'

// Mensagem idêntica à da Edge Function wallet-verify
function buildMessage(address, nonce) {
  return `Bem-vindo ao Lucky Mine!\n\nClique para entrar e aceitar os Termos de Uso.\n\nEste pedido não custará nenhuma taxa.\n\nEndereço:\n${address}\n\nNonce:\n${nonce}`
}

export default function Login() {
  const [error, setError]         = useState('')
  const [mmLoading, setMmLoading] = useState(false)

  useEffect(() => {
    const err = localStorage.getItem('auth_error')
    if (err) {
      setError(err)
      localStorage.removeItem('auth_error')
    }
  }, [])

  /* ── Google ─────────────────────────────────────────────── */
  async function handleGoogle() {
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/`,
        queryParams: { access_type: 'offline', prompt: 'consent' },
      },
    })
  }

  /* ── MetaMask ───────────────────────────────────────────── */
  async function handleMetaMask() {
    setError('')

    if (!window.ethereum?.isMetaMask) {
      setError('MetaMask not found. Install in metamask.io')
      return
    }

    setMmLoading(true)
    try {
      // 1. Pede acesso à carteira
      const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' })
      const address = accounts[0].toLowerCase()

      // 2. Busca nonce
      const nonceRes = await supabase.functions.invoke('wallet-nonce', {
        body: { address },
      })
      if (nonceRes.error || nonceRes.data?.error) {
        throw new Error(nonceRes.data?.error ?? 'Erro ao gerar nonce')
      }
      const { nonce } = nonceRes.data

      // 3. Usuário assina no MetaMask
      const message = buildMessage(address, nonce)
      const signature = await window.ethereum.request({
        method: 'personal_sign',
        params: [message, address],
      })

      // 4. Verifica assinatura e obtém sessão
      const verifyRes = await supabase.functions.invoke('wallet-verify', {
        body: { address, signature },
      })
      if (verifyRes.error || verifyRes.data?.error) {
        const code = verifyRes.data?.error
        throw new Error(
          code === 'nonce_expired'      ? 'Sessão expirada. Tente novamente.'   :
          code === 'signature_mismatch' ? 'Assinatura inválida.'                :
          code === 'nonce_not_found'    ? 'Nonce não encontrado. Tente novamente.' :
          'Erro na verificação. Tente novamente.'
        )
      }

      // 5. Aplica sessão — AuthContext detecta e chama fetchProfile
      const { error: sessionErr } = await supabase.auth.setSession({
        access_token:  verifyRes.data.access_token,
        refresh_token: verifyRes.data.refresh_token,
      })
      if (sessionErr) throw sessionErr

    } catch (err) {
      setError(err?.code === 4001 ? 'Assinatura cancelada.' : (err?.message ?? 'Erro desconhecido.'))
    } finally {
      setMmLoading(false)
    }
  }

  return (
    <div className="login-page">
      <div className="login-grid" aria-hidden="true">
        {Array.from({ length: 64 }).map((_, i) => (
          <div key={i} className="login-grid__cell" />
        ))}
      </div>
      <div className="login-orb" aria-hidden="true" />

      <div className="login-card login-card--oauth">
        <div className="login-card__header login-card__header--center">
          <img src={logo} alt="Lucky Mine" width="56" className="login-logo-img" />
          <h1 className="login-title">Lucky Mine</h1>
          <p className="login-subtitle">Earn and play LCKM</p>
        </div>

        {error && (
          <p style={{
            fontSize: '.78rem', color: '#f4605b',
            background: 'rgba(244,96,91,.08)', border: '1px solid rgba(244,96,91,.2)',
            borderRadius: '6px', padding: '.55rem .8rem',
            marginBottom: '1rem', textAlign: 'center',
          }}>
            {error}
          </p>
        )}

        <div className="login-oauth-btns">
          <button className="login-oauth-btn login-oauth-btn--google" onClick={handleGoogle}>
            <svg width="20" height="20" viewBox="0 0 48 48">
              <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
              <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
              <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
              <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
              <path fill="none" d="M0 0h48v48H0z"/>
            </svg>
            Login with Gmail
          </button>

          <button
            className="login-oauth-btn login-oauth-btn--metamask"
            onClick={handleMetaMask}
            disabled={mmLoading}
          >
            {mmLoading ? (
              <span style={{ display: 'flex', alignItems: 'center', gap: '.5rem' }}>
                <span className="login-mm-spinner" />
                Waiting  MetaMask…
              </span>
            ) : (
              <>
                <svg width="20" height="20" viewBox="0 0 35 33" fill="none">
                  <path d="M32.958 1L19.648 10.91l2.443-5.79L32.958 1z" fill="#E17726"/>
                  <path d="M2.042 1l13.17 10L12.91 5.12 2.042 1z" fill="#E27625"/>
                  <path d="M28.17 23.34l-3.54 5.42 7.58 2.09 2.17-7.36-6.21-.15z" fill="#E27625"/>
                  <path d="M1.63 23.49l2.16 7.36 7.57-2.09-3.53-5.42-6.2.15z" fill="#E27625"/>
                  <path d="M10.96 14.49l-2.11 3.19 7.52.34-.25-8.09-5.16 4.56z" fill="#E27625"/>
                  <path d="M24.04 14.49l-5.22-4.65-.17 8.18 7.51-.34-2.12-3.19z" fill="#E27625"/>
                  <path d="M11.36 28.76l4.53-2.2-3.91-3.05-.62 5.25z" fill="#E27625"/>
                  <path d="M19.11 26.56l4.54 2.2-.63-5.25-3.91 3.05z" fill="#E27625"/>
                </svg>
                Login with MetaMask
              </>
            )}
          </button>
        </div>

      </div>
    </div>
  )
}