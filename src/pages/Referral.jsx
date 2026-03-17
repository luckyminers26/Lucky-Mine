import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabaseClient2'
import { useAuth } from '../contexts/AuthContext'
import Header from '../components/Header'
import './Referral.css'

const MAX_REFERRALS = 10
const REWARD_TKN    = 1
const LOTTERY_REQ   = 10

export default function Referral() {
  const { profile, session } = useAuth()

  const [referrals, setReferrals] = useState([])
  const [loading, setLoading]     = useState(true)
  const [copied, setCopied]       = useState(false)
  const [origin, setOrigin]       = useState('')

  // Captura origin após mount (evita erro de SSR/hydration)
  useEffect(() => { setOrigin(window.location.origin) }, [])

  const referralLink = profile?.referral_code && origin
    ? `${origin}/register?ref=${profile.referral_code}`
    : null

  const loadReferrals = useCallback(async () => {
    setLoading(true)

    // Busca referrals
    const { data: refs, error } = await supabase
      .from('referrals')
      .select('id, lottery_count, rewarded, rewarded_at, created_at, referred_id')
      .eq('referrer_id', session.user.id)
      .order('created_at', { ascending: false })

    if (error) { console.error('referrals error:', error.message); setLoading(false); return }
    if (!refs || refs.length === 0) { setReferrals([]); setLoading(false); return }

    // Busca nomes dos referidos separadamente
    const ids = refs.map(r => r.referred_id)
    // Usa view pública para evitar RLS bloqueando outros perfis
    const { data: profiles } = await supabase
      .from('profiles_public')
      .select('id, display_name')
      .in('id', ids)

    const profileMap = Object.fromEntries((profiles ?? []).map(p => [p.id, p]))

    const merged = refs.map(r => ({
      ...r,
      profiles: profileMap[r.referred_id] ?? null,
    }))

    setReferrals(merged)
    setLoading(false)
  }, [session])

  useEffect(() => { loadReferrals() }, [loadReferrals])

  async function copyLink() {
    if (!referralLink) return
    try {
      await navigator.clipboard.writeText(referralLink)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // fallback para browsers sem clipboard API
      const el = document.createElement('textarea')
      el.value = referralLink
      document.body.appendChild(el)
      el.select()
      document.execCommand('copy')
      document.body.removeChild(el)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  const rewarded    = referrals.filter(r => r.rewarded).length
  const pending     = referrals.filter(r => !r.rewarded).length
  const slots       = MAX_REFERRALS - referrals.length
  const totalEarned = rewarded * REWARD_TKN

  return (
    <div className="ref-page">
      <Header />
      <main className="ref-main">

        {/* Hero */}
        <div className="ref-hero">
          <div className="ref-hero__orb" />
          <div className="ref-hero__badge">REFERRAL</div>
          <h1 className="ref-hero__title">Convide.<br />Ganhe.</h1>
          <p className="ref-hero__sub">
            Convide até <strong>{MAX_REFERRALS}</strong> amigos.
            Ganhe <strong>{REWARD_TKN} TKN</strong> por cada um que jogar
            na loteria <strong>{LOTTERY_REQ} vezes</strong>.
          </p>
        </div>

        {/* Stats */}
        <div className="ref-stats">
          <div className="ref-stat">
            <span className="ref-stat__label">Convidados</span>
            <span className="ref-stat__value">
              {referrals.length}<span className="ref-stat__max">/{MAX_REFERRALS}</span>
            </span>
          </div>
          <div className="ref-stat">
            <span className="ref-stat__label">Recompensados</span>
            <span className="ref-stat__value">{rewarded}</span>
          </div>
          <div className="ref-stat">
            <span className="ref-stat__label">Pendentes</span>
            <span className="ref-stat__value">{pending}</span>
          </div>
          <div className="ref-stat">
            <span className="ref-stat__label">TKN ganhos</span>
            <span className="ref-stat__value ref-stat__value--mono">{totalEarned}.00000000</span>
          </div>
        </div>

        {/* Link */}
        <div className="ref-card">
          <div className="ref-card__header">
            <span className="ref-card__title">Seu link de convite</span>
            {slots > 0
              ? <span className="ref-slots">{slots} vagas</span>
              : <span className="ref-slots ref-slots--full">Limite atingido</span>
            }
          </div>

          <div className="ref-link-wrap">
            <span className="ref-link-text">
              {referralLink ?? (profile?.referral_code ? 'Carregando…' : 'Código não encontrado')}
            </span>
            <button
              className={`ref-copy-btn ${copied ? 'ref-copy-btn--copied' : ''}`}
              onClick={copyLink}
              disabled={!referralLink || slots === 0}
            >
              {copied ? '✓ Copiado' : 'Copiar'}
            </button>
          </div>

          <div className="ref-code-row">
            <span className="ref-code-label">Código:</span>
            <code className="ref-code">{profile?.referral_code ?? '—'}</code>
          </div>
        </div>

        {/* Lista de convidados */}
        <div className="ref-card">
          <span className="ref-card__title">Seus convidados</span>

          {loading ? (
            <div className="ref-loading">
              <span className="ref-spinner" /> Carregando…
            </div>
          ) : referrals.length === 0 ? (
            <div className="ref-empty">
              Nenhum convidado ainda. Compartilhe seu link!
            </div>
          ) : (
            <ul className="ref-list">
              {referrals.map((r, i) => {
                const name = r.profiles?.display_name ?? 'Usuário'
                const pct  = Math.min(100, (r.lottery_count / LOTTERY_REQ) * 100)
                return (
                  <li key={r.id} className="ref-item" style={{ '--d': `${i * 40}ms` }}>
                    <div className="ref-item__top">
                      <div className="ref-item__info">
                        <span className="ref-item__name">{name}</span>
                        <span className="ref-item__count">
                          {r.lottery_count}/{LOTTERY_REQ} loterias
                        </span>
                      </div>
                      <span className={`ref-item__status ${r.rewarded ? 'ref-item__status--done' : 'ref-item__status--pending'}`}>
                        {r.rewarded ? `✓ +${REWARD_TKN} TKN` : 'Pendente'}
                      </span>
                    </div>
                    <div className="ref-progress">
                      <div className="ref-progress__bar" style={{ '--pct': `${pct}%` }} />
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        {/* Como funciona */}
        <div className="ref-how">
          <span className="ref-how__title">Como funciona</span>
          <ol className="ref-how__steps">
            <li>Copie seu link e envie para um amigo</li>
            <li>O amigo se cadastra usando seu link</li>
            <li>Quando ele jogar na loteria {LOTTERY_REQ} vezes…</li>
            <li>Você recebe <strong>{REWARD_TKN} TKN</strong> automaticamente 🎉</li>
          </ol>
        </div>

      </main>
    </div>
  )
}