import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { Eye, EyeOff } from "lucide-react"
import './Login.css'

export default function Login() {
  const { signIn, signUp } = useAuth()
  const navigate = useNavigate()

  const [mode, setMode] = useState('login')

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const ref = params.get('ref')
    if (ref) {
      localStorage.setItem('referral_code', ref.toUpperCase())
      setMode('register')
    }
  }, [])

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')

    if (mode === 'register' && password !== confirmPassword) {
      setError('As senhas não coincidem.')
      return
    }

    setLoading(true)
    try {
      if (mode === 'login') {
        await signIn(email, password)
      } else {
        await signUp(email, password, displayName)
        const refCode = localStorage.getItem('referral_code')
        if (refCode) {
          const { supabase } = await import('../lib/supabaseClient2')
          await supabase.rpc('apply_referral', { p_code: refCode })
          localStorage.removeItem('referral_code')
        }
      }
      navigate('/')
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  function toggleMode() {
    setMode(m => (m === 'login' ? 'register' : 'login'))
    setError('')
    setPassword('')
    setConfirmPassword('')
  }

  return (
    <div className="login-page">
      <div className="login-grid" aria-hidden="true">
        {Array.from({ length: 64 }).map((_, i) => (
          <div key={i} className="login-grid__cell" />
        ))}
      </div>
      <div className="login-orb" aria-hidden="true" />

      <div className="login-card">
        <div className="login-card__header">
          <a href="/" className="login-card__logo">
            <svg width="28" height="28" viewBox="0 0 32 32" fill="none">
              <rect width="32" height="32" rx="8" fill="#5b5ef4" />
              <path d="M8 16 L16 8 L24 16 L16 24 Z" fill="white" opacity="0.9" />
              <circle cx="16" cy="16" r="4" fill="white" />
            </svg>
            <span>Lucky Mine</span>
          </a>

          <div className="login-card__tabs">
            <button
              className={`login-tab ${mode === 'login' ? 'login-tab--active' : ''}`}
              onClick={() => { setMode('login'); setError('') }}
              type="button"
            >Entrar</button>
            <button
              className={`login-tab ${mode === 'register' ? 'login-tab--active' : ''}`}
              onClick={() => { setMode('register'); setError('') }}
              type="button"
            >Criar conta</button>
          </div>
        </div>

        <form className="login-form" onSubmit={handleSubmit} noValidate>
          {mode === 'register' && (
            <div className="login-field" style={{ '--delay': '0ms' }}>
              <label htmlFor="displayName">Nome</label>
              <input
                id="displayName"
                type="text"
                placeholder="Como devemos te chamar?"
                value={displayName}
                onChange={e => setDisplayName(e.target.value)}
                required
                autoComplete="name"
              />
            </div>
          )}

          <div className="login-field" style={{ '--delay': '60ms' }}>
            <label htmlFor="email">E-mail</label>
            <input
              id="email"
              type="email"
              placeholder="voce@email.com"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              autoComplete="email"
            />
          </div>

          <div className="login-field" style={{ '--delay': '120ms' }}>
            <label htmlFor="password">Senha</label>
            <div className="login-input-wrap">
              <input
                id="password"
                type={showPassword ? 'text' : 'password'}
                placeholder="••••••••"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              />
              <button
                type="button"
                className="login-eye"
                onClick={() => setShowPassword(v => !v)}
                tabIndex={-1}
                aria-label={showPassword ? 'Ocultar senha' : 'Ver senha'}
              >
                {showPassword ? <EyeOff size={16} color='white'/> : <Eye size={16} color='white'/>}
              </button>
            </div>
          </div>

          {mode === 'register' && (
            <div className="login-field" style={{ '--delay': '180ms' }}>
              <label htmlFor="confirmPassword">Confirmar senha</label>
              <div className="login-input-wrap">
                <input
                  id="confirmPassword"
                  type={showConfirm ? 'text' : 'password'}
                  placeholder="••••••••"
                  value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)}
                  required
                  autoComplete="new-password"
                  className={confirmPassword && password !== confirmPassword ? 'login-input--error' : ''}
                />
                <button
                  type="button"
                  className="login-eye"
                  onClick={() => setShowConfirm(v => !v)}
                  tabIndex={-1}
                  aria-label={showConfirm ? 'Ocultar senha' : 'Ver senha'}
                >
                  {showConfirm ? <EyeOff size={16} color='white' /> : <Eye size={16} color='white'/>}
                </button>
              </div>
              {confirmPassword && password !== confirmPassword && (
                <span className="login-field__hint">As senhas não coincidem</span>
              )}
            </div>
          )}

          {error && <p className="login-error">{error}</p>}

          <button className="login-submit" type="submit" disabled={loading}>
            {loading
              ? <span className="login-spinner" />
              : mode === 'login' ? 'Entrar' : 'Criar conta'}
          </button>
        </form>

        <p className="login-toggle">
          {mode === 'login' ? 'Ainda não tem conta?' : 'Já tem conta?'}
          {' '}
          <button type="button" onClick={toggleMode}>
            {mode === 'login' ? 'Criar conta' : 'Entrar'}
          </button>
        </p>
      </div>
    </div>
  )
}