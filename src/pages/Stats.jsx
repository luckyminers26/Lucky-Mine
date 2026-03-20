import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient2'
import Header from '../components/Header'
import './Stats.css'

function formatNum(val, decimals = 4) {
  return Number(val ?? 0).toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
}

function formatCompact(val) {
  const n = Number(val ?? 0)
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + 'M'
  if (n >= 1_000)     return (n / 1_000).toFixed(2) + 'K'
  return n.toFixed(2)
}

function SupplyBar({ label, value, max, color }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0
  return (
    <div className="supply-bar">
      <div className="supply-bar__header">
        <span className="supply-bar__label">{label}</span>
        <span className="supply-bar__value">{formatCompact(value)} LCKM</span>
      </div>
      <div className="supply-bar__track">
        <div className="supply-bar__fill" style={{ '--w': `${pct}%`, '--color': color }} />
      </div>
    </div>
  )
}

export default function Stats() {
  const [supply, setSupply]   = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      setLoading(true)
      const { data } = await supabase
        .from('token_supply')
        .select('max_supply, mined_supply, burned_supply, staking_pool, staking_reserve, updated_at')
        .eq('id', 1)
        .single()
      setSupply(data)
      setLoading(false)
    }
    load()
  }, [])

  const maxSupply     = Number(supply?.max_supply      ?? 100_000_000)
  const mined         = Number(supply?.mined_supply     ?? 0)
  const burned        = Number(supply?.burned_supply    ?? 0)
  const staking       = Number(supply?.staking_pool     ?? 0)
  const reserve       = Number(supply?.staking_reserve  ?? 0)

  const circulating   = Math.max(0, mined - burned - staking - reserve)

  return (
    <div className="stats-page">
      <Header />
      <main className="stats-main">

        <div className="stats-hero">
          <div className="stats-hero__orb" />
          <div className="stats-hero__label">TOKENOMICS</div>
          <h1 className="stats-hero__title">Supply & Métricas</h1>
        </div>

        {loading ? (
          <div className="stats-loading"><span className="stats-spinner" /></div>
        ) : (
          <>
            <div className="stats-grid">

              <div className="stats-card stats-card--max">
                <div className="stats-card__label">
                  <span className="stats-card__icon"></span> Max supply 
                </div>
                <div className="stats-card__value">{formatCompact(maxSupply)}</div>
                <div className="stats-card__sub">{formatNum(maxSupply, 0)} LCKM</div>
              </div>

              <div className="stats-card stats-card--circ">
                <div className="stats-card__label">
                  <span className="stats-card__icon"></span> In Circulation
                </div>
                <div className="stats-card__value">{formatCompact(circulating)}</div>
                <div className="stats-card__sub">{formatNum(circulating, 4)} LCKM</div>
              </div>

              <div className="stats-card stats-card--mined">
                <div className="stats-card__label">
                  <span className="stats-card__icon">⛏</span> Total mined
                </div>
                <div className="stats-card__value">{formatCompact(mined)}</div>
                <div className="stats-card__sub">{formatNum(mined, 4)} LCKM</div>
              </div>

              <div className="stats-card stats-card--burned">
                <div className="stats-card__label">
                  <span className="stats-card__icon">🔥</span> Burned
                </div>
                <div className="stats-card__value">{formatCompact(burned)}</div>
                <div className="stats-card__sub">{formatNum(burned, 4)} LCKM</div>
              </div>

              <div className="stats-card stats-card--staking">
                <div className="stats-card__label">
                  <span className="stats-card__icon">🔒</span> Staked
                </div>
                <div className="stats-card__value">{formatCompact(staking)}</div>
                <div className="stats-card__sub">{formatNum(staking, 4)} LCKM</div>
              </div>

              <div className="stats-card stats-card--reserve">
                <div className="stats-card__label">
                  <span className="stats-card__icon">📦</span> Staking Reserve
                </div>
                <div className="stats-card__value">{formatCompact(reserve)}</div>
              </div>

            </div>
          </>
        )}
      </main>
    </div>
  )
}