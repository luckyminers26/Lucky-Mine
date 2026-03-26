import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient2'
import { useAuth } from '../contexts/AuthContext'
import { useJackpotCache } from '../hooks/useJackpotCache'
import Header from '../components/Header'
import './Betting.css'

/* ─── constantes ──────────────────────────────────────────── */
const MIN_BET = 0.0001
const CAROUSEL_MAX = 40
const AUTO_DELAY = 900
const JACKPOT_CHANCE_DISPLAY = '1 em 1.000.000'

function calcPayout(chancePct) {
  return 0.99 / (chancePct / 100)
}

/* ─── helpers ─────────────────────────────────────────────── */
const fmt = n => Number(n).toFixed(8)
const round8 = n => Math.round(n * 1e8) / 1e8
const clamp = (v, mn, mx) => Math.max(mn, Math.min(mx, v))

const fmtBR = n => {
  const num = Number(n)
  if (!isFinite(num)) return '——'
  const str = num.toFixed(4).replace(/\.?0+$/, '')
  const [intPart, decPart] = str.split('.')
  const intFormatted = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  return decPart ? `${intFormatted},${decPart}` : intFormatted
}

const fmtBRInt = n => Math.round(Number(n)).toLocaleString('pt-BR')

function parseSafe(str) {
  const n = parseFloat(str)
  return isNaN(n) || !isFinite(n) ? null : n
}

function validateBet(raw, bal) {
  const amt = parseSafe(raw)
  if (amt === null || amt < MIN_BET) return { ok: false, msg: `Min. ${fmt(MIN_BET)}` }
  if (amt > bal) return { ok: false, msg: 'Insufficient balance' }
  return { ok: true, amt }
}

export default function Betting() {
  const { profile, refreshProfile } = useAuth()
  const navigate = useNavigate()

  const { jackpotInfo, wagerRanking, invalidate: invalidateJackpot } = useJackpotCache()

  const [balance, setBalance] = useState(null)
  const [betInput, setBetInput] = useState('')
  const [chancePct, setChancePct] = useState(50)
  const [multInput, setMultInput] = useState('2')
  const [autoOn, setAutoOn] = useState(false)
  const [running, setRunning] = useState(false)
  const [stopped, setStopped] = useState(null)
  const [stopGain, setStopGain] = useState('')
  const [stopLoss, setStopLoss] = useState('')
  const [history, setHistory] = useState([])
  const [stats, setStats] = useState({ wins: 0, losses: 0, net: 0, streak: 0 })
  const [jackpotModal, setJackpotModal] = useState(null)
  const [jackpotHowTo, setJackpotHowTo] = useState(false)
  const [currentBetDisplay, setCurrentBetDisplay] = useState(null)

  const autoRef = useRef(false)
  const balanceRef = useRef(null)
  const initialBalRef = useRef(null)
  const currentBetRef = useRef(0)
  const baseBetRef = useRef(0)
  const mountedRef = useRef(true)
  const histIdRef = useRef(0)
  const rollHistRef = useRef([])

  /* sync saldo */
  useEffect(() => {
    if (profile?.balance != null && balance === null) {
      const b = Number(profile.balance)
      setBalance(b)
      balanceRef.current = b
      initialBalRef.current = b
    }
  }, [profile])

  /* para ao desmontar */
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      autoRef.current = false
    }
  }, [])

  /* ── uma aposta ──────────────────────────────────────────── */
  const placeBet = useCallback(async (amount, baseAmount, chance) => {
    if (!mountedRef.current) return null

    const amt = round8(clamp(amount, MIN_BET, balanceRef.current ?? 0))
    if (amt < MIN_BET) return null

    const { data, error } = await supabase.rpc('bet_token', {
      p_amount: amt,
      p_chance: chance,
    })

    if (!mountedRef.current) return null

    if (error || !data || data.error) {
      if (data?.error === 'rate_limited') return null
      const msg =
        data?.error === 'insufficient' ? 'Insufficient balance.' :
          data?.error === 'below_minimum' ? 'Bet too low.' :
            data?.error === 'invalid_chance' ? 'Invalid.' :
              data?.error === 'not_found' ? 'Profile not found.' :
                `Error: ${data?.error ?? error?.message ?? 'unknown'}`
      autoRef.current = false
      setAutoOn(false)
      setRunning(false)
      setStopped(msg)
      return null
    }

    const roll = data.roll
    const won = data.won
    const newBal = Number(data.balance)
    const delta = Number(data.delta)
    const jackpotHit = data.jackpot === true
    const jackpotAmt = Number(data.jackpot_amt ?? 0)

    rollHistRef.current = (data.roll_hist ?? [])
    balanceRef.current = newBal
    setBalance(newBal)

    /* carrossel */
    const entry = { id: ++histIdRef.current, won, delta, roll, jackpot: jackpotHit }
    setHistory(prev => [entry, ...prev].slice(0, CAROUSEL_MAX))

    /* stats */
    setStats(prev => {
      const streak = won
        ? (prev.streak >= 0 ? prev.streak + 1 : 1)
        : (prev.streak <= 0 ? prev.streak - 1 : -1)
      return {
        wins: prev.wins + (won ? 1 : 0),
        losses: prev.losses + (won ? 0 : 1),
        net: round8(prev.net + delta + jackpotAmt),
        streak,
      }
    })

    /* jackpot */
    if (jackpotHit) {
      autoRef.current = false
      setAutoOn(false)
      setCurrentBetDisplay(null)
      invalidateJackpot()  // força re-fetch na próxima visita
      setJackpotModal({
        nums: rollHistRef.current.slice(0, jackpotInfo?.streak_req ?? 7),
        amt: jackpotAmt,
        burnAmt: Number(data.burn_amt ?? 0),
        stakingAmt: Number(data.staking_amt ?? 0),
      })
      return { won, newBal, delta, jackpotHit: true, jackpotAmt }
    }

    return { won, newBal, delta, jackpotHit: false, jackpotAmt: 0 }
  }, [jackpotInfo])

  /* ── manual ──────────────────────────────────────────────── */
  async function handleManualBet() {
    if (running || autoOn) return
    const bal = balanceRef.current ?? 0
    const v = validateBet(betInput, bal)
    if (!v.ok) { setStopped(v.msg); return }
    setStopped(null)
    baseBetRef.current = v.amt
    setRunning(true)
    await placeBet(v.amt, v.amt, chancePct)
    setRunning(false)
  }

  /* ── automático ──────────────────────────────────────────── */
  async function startAuto() {
    if (autoRef.current) return
    const bal = balanceRef.current ?? 0
    const v = validateBet(betInput, bal)
    if (!v.ok) { setStopped(v.msg); return }

    const mult = clamp(parseSafe(multInput) ?? 1, 1, 1000)

    initialBalRef.current = bal
    currentBetRef.current = v.amt
    baseBetRef.current = v.amt
    autoRef.current = true
    setAutoOn(true)
    setCurrentBetDisplay(v.amt)
    setStopped(null)

    const gainLimit = parseSafe(stopGain)
    const lossLimit = parseSafe(stopLoss)
    const chance = chancePct

    while (autoRef.current && mountedRef.current) {
      const curBal = balanceRef.current ?? 0
      const bet = round8(clamp(currentBetRef.current, MIN_BET, curBal))

      if (curBal < MIN_BET) {
        autoRef.current = false; setStopped('Insufficient balance.'); break
      }

      setCurrentBetDisplay(bet)
      setRunning(true)
      const res = await placeBet(bet, v.amt, chance)
      if (!mountedRef.current) break
      setRunning(false)

      if (!res) {
        await new Promise(r => setTimeout(r, AUTO_DELAY))
        continue
      }

      if (res.jackpotHit) { autoRef.current = false; break }

      currentBetRef.current = res.won
        ? v.amt
        : round8(clamp(bet * mult, MIN_BET, res.newBal))

      const gained = round8(res.newBal - initialBalRef.current)
      if (gainLimit !== null && gained >= gainLimit) {
        autoRef.current = false; setStopped(`Stop gain! +${fmt(gainLimit)}.`); break
      }
      if (lossLimit !== null && -gained >= lossLimit) {
        autoRef.current = false; setStopped(`Stop loss! −${fmt(lossLimit)}.`); break
      }

      await new Promise(r => setTimeout(r, AUTO_DELAY))
    }

    if (mountedRef.current) {
      setAutoOn(false)
      setRunning(false)
      setCurrentBetDisplay(null)
      refreshProfile()
    }
  }

  function stopAuto() {
    autoRef.current = false
    setAutoOn(false)
    setCurrentBetDisplay(null)
  }

  /* ── display ─────────────────────────────────────────────── */
  const bal = balance ?? Number(profile?.balance ?? 0)
  const betVal = parseSafe(betInput) ?? 0
  const betBase = parseSafe(betInput) ?? 0
  const valid = betInput !== '' ? validateBet(betInput, bal) : { ok: false, msg: '' }
  const payout = calcPayout(chancePct)
  const netCls = stats.net >= 0 ? 'bet-stat__value--green' : 'bet-stat__value--red'
  const netCard = stats.net >= 0 ? 'bet-stat--net-pos' : 'bet-stat--net-neg'
  const multActive = currentBetDisplay !== null && betBase > 0
    && (currentBetDisplay - betBase) > 0.00005

  const jackpotPool = jackpotInfo?.pool ?? null
  const jackpotPrize = jackpotInfo?.prize ?? 1000
  const jackpotStreak = jackpotInfo?.streak_req ?? 7
  const jackpotWinners = jackpotInfo?.winners ?? []

  function setQuick(fn) { setBetInput(fmt(round8(Math.max(fn(bal), MIN_BET)))) }
  function doDouble() {
    const v = parseSafe(betInput); if (!v) return
    setBetInput(fmt(round8(Math.min(v * 2, bal))))
  }
  function doHalf() {
    const v = parseSafe(betInput); if (!v) return
    setBetInput(fmt(round8(Math.max(v / 2, MIN_BET))))
  }

  const PRESETS = [10, 50, 90]

  return (
    <>
      {/* ── modal jackpot ─────────────────────────────────── */}
      {jackpotModal && (
        <div className="bet-jackpot-overlay">
          <div className="bet-jackpot-modal">
            <span className="bet-jackpot-modal__emoji">🏆</span>
            <h2 className="bet-jackpot-modal__title">JACKPOT!</h2>
            <p style={{ color: '#9090a8', fontSize: '0.82rem', margin: 0 }}>
              {jackpotStreak} consecutive numbers in the same ten!
            </p>
            <div className="bet-jackpot-modal__nums">
              {jackpotModal.nums.map((n, i) => (
                <div key={i} className="bet-jackpot-modal__num">
                  {String(n).padStart(2, '0')}
                </div>
              ))}
            </div>
            <div className="bet-jackpot-modal__prize">
              +{fmtBRInt(jackpotModal.amt)} LCKM
            </div>
            {(jackpotModal.burnAmt > 0 || jackpotModal.stakingAmt > 0) && (
              <div className="bet-jackpot-modal__breakdown">
                {jackpotModal.burnAmt > 0 && (
                  <span>🔥 {fmtBRInt(jackpotModal.burnAmt)} Burned</span>
                )}
                {jackpotModal.stakingAmt > 0 && (
                  <span>💎 {fmtBRInt(jackpotModal.stakingAmt)} Staking</span>
                )}
              </div>
            )}
            <button
              className="bet-jackpot-modal__btn"
              onClick={() => { setJackpotModal(null); refreshProfile() }}
            >
              Close 🎉
            </button>
          </div>
        </div>
      )}

      <div className="bet-page">
        <Header />
        <main className="bet-main">

          {/* ── modal how-to ───────────────────────────────── */}
          {jackpotHowTo && (
            <div className="bet-jackpot-overlay" onClick={() => setJackpotHowTo(false)}>
              <div className="bet-jackpot-modal" onClick={e => e.stopPropagation()}>
                <h2 className="bet-jackpot-modal__title" style={{ fontSize: '1.2rem' }}>
                  How to win the Jackpot?
                </h2>
                <div style={{ textAlign: 'left', width: '100%', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  <p style={{ fontSize: '0.85rem', color: 'var(--text)', margin: 0 }}>
                    If the last <strong>{jackpotStreak} drawn numbers</strong> all belong
                    to the <strong>same decade</strong> (e.g. 1x: 11-12-13-14-15-16-13), you win the jackpot.
                  </p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <p style={{ fontSize: '1rem', color: '#9090a8', margin: 0 }}>
                      🏆 Prize: <strong style={{ color: 'var(--gold)' }}>{fmtBRInt(jackpotPrize)} LCKM</strong>
                    </p>
                    <p style={{ fontSize: '1rem', color: '#9090a8', margin: 0 }}>
                      🔥 Burned: <strong style={{ color: 'var(--red)' }}>500 LCKM</strong>
                    </p>
                    <p style={{ fontSize: '1rem', color: '#9090a8', margin: 0 }}>
                      💎 Staking: <strong style={{ color: 'var(--accent)' }}>500 LCKM</strong>
                    </p>

                  </div>
                </div>
                <button className="bet-jackpot-modal__btn" onClick={() => setJackpotHowTo(false)}>
                  Close
                </button>
              </div>
            </div>
          )}

          {/* ── hero ──────────────────────────────────────── */}
          <div className="bet-hero">
            <div className="bet-hero__orb" />
            <h1 className="bet-hero__title">🎲 Bets</h1>
            <div className="bet-hero__jackpot">
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span className="bet-hero__jackpot-label">🏆 Jackpot Pool</span>
                <button
                  className="bet-howto-btn"
                  onClick={() => setJackpotHowTo(true)}
                  title="How does the jackpot work?"
                >?</button>
              </div>
              <span className="bet-hero__jackpot-value">
                {jackpotPool !== null ? fmtBR(jackpotPool) : '——'}
              </span>
            </div>
          </div>

          {/* ── chance + payout ───────────────────────────── */}
          <div className="bet-card">
            <h3 className="bet-card__title">Chance &amp; Payout</h3>

            <div className="bet-chance-wrap">
              <div className="bet-chance-header">
                <span className="bet-chance-pct">{chancePct}%</span>
                <span className="bet-chance-roll">
                  win if roll ≥ {100 - chancePct} (0–99)
                </span>
              </div>
              <input
                className="bet-slider"
                type="range" min="1" max="95" step="1"
                value={chancePct}
                onChange={e => setChancePct(Number(e.target.value))}
                disabled={autoOn}
              />
              <div className="bet-chance-presets">
                {PRESETS.map(p => (
                  <button key={p}
                    className={`bet-preset-btn ${chancePct === p ? 'bet-preset-btn--active' : ''}`}
                    disabled={autoOn}
                    onClick={() => setChancePct(p)}
                  >{p}%</button>
                ))}
              </div>
            </div>

            <div className="bet-prob-bar">
              <div className="bet-prob-fill" style={{ width: `${chancePct}%` }} />
              <span className="bet-prob-label">WIN {chancePct}%</span>
              <span className="bet-prob-label bet-prob-label--loss">LOSS {100 - chancePct}%</span>
            </div>

            <div className="bet-payout-grid">
              <div className="bet-payout-card bet-payout-card--payout">
                <span className="bet-payout-card__val bet-payout-card__val--accent">
                  ×{payout.toFixed(2)}
                </span>
                <span className="bet-payout-card__label">Payout</span>
              </div>
              <div className="bet-payout-card bet-payout-card--win">
                <span className="bet-payout-card__val bet-payout-card__val--green">
                  +{betVal > 0 ? fmt(betVal * (payout - 1)) : '0.0000'}
                </span>
                <span className="bet-payout-card__label">If win</span>
              </div>
              <div className="bet-payout-card bet-payout-card--loss">
                <span className="bet-payout-card__val bet-payout-card__val--red">
                  −{betVal > 0 ? fmt(betVal) : '0.0000'}
                </span>
                <span className="bet-payout-card__label">If loss</span>
              </div>
            </div>
          </div>

          {/* ── configuração ──────────────────────────────── */}
          <div className="bet-card">

            <div className="bet-field">
              <label className="bet-field__label">Bet value</label>
              <input
                className={`bet-input${betInput && !valid.ok && !autoOn ? ' bet-input--error' : ''}${multActive ? ' bet-input--mult' : ''}`}
                type="number" min={MIN_BET} step={MIN_BET}
                value={autoOn && currentBetDisplay !== null ? currentBetDisplay : betInput}
                onChange={e => { if (!autoOn) setBetInput(e.target.value) }}
                placeholder="0.0000"
                disabled={autoOn}
              />


              <div className="bet-quick-row">
                <button className="bet-quick-btn" disabled={autoOn}
                  onClick={() => setQuick(() => MIN_BET)}>MIN</button>
                <button className="bet-quick-btn" disabled={autoOn}
                  onClick={() => setQuick(b => b)}>MAX</button>
                <button className="bet-quick-btn" disabled={autoOn} onClick={doDouble}>×2</button>
                <button className="bet-quick-btn" disabled={autoOn} onClick={doHalf}>÷2</button>
              </div>
            </div>

            <div className="bet-field">
              <div className="bet-mult-row">
                <input
                  className="bet-input"
                  type="number" min="1" max="1000"
                  value={multInput}
                  onChange={e => setMultInput(e.target.value)}
                  disabled={autoOn}
                />
                <span className="bet-mult-desc">
                  Multiply on loss<br />Reset when win.
                </span>
              </div>
            </div>

            <div className="bet-field">
              <div className="bet-limits-row">
                <div className="bet-limit-box">
                  <span className="bet-limit-box__label bet-limit-box__label--gain">Stop Gain +</span>
                  <input
                    className="bet-input"
                    type="number" min={MIN_BET} step={MIN_BET}
                    placeholder="no limit"
                    value={stopGain}
                    onChange={e => setStopGain(e.target.value)}
                    disabled={autoOn}
                  />
                </div>
                <div className="bet-limit-box">
                  <span className="bet-limit-box__label bet-limit-box__label--loss">Stop Loss −</span>
                  <input
                    className="bet-input"
                    type="number" min={MIN_BET} step={MIN_BET}
                    placeholder="no limit"
                    value={stopLoss}
                    onChange={e => setStopLoss(e.target.value)}
                    disabled={autoOn}
                  />
                </div>
              </div>
            </div>

            {stopped && <div className="bet-stopped">⚠ {stopped}</div>}

            <div className="bet-action">
              <button
                className="bet-btn"
                disabled={!valid.ok || running || autoOn}
                onClick={handleManualBet}
              >
                {running && !autoOn ? <><div className="bet-spinner" /></> : '⚡ Bet'}
              </button>

              {!autoOn ? (
                <button
                  className="bet-auto-btn"
                  disabled={!valid.ok || running}
                  onClick={startAuto}
                >▶ Start Auto</button>
              ) : (
                <button className="bet-auto-btn bet-auto-btn--stop" onClick={stopAuto}>
                  {running
                    ? <><div className="bet-spinner" style={{ borderTopColor: 'var(--red)' }} /></>
                    : '■ Stop'
                  }
                </button>
              )}
            </div>
          </div>

          {/* ── carrossel ─────────────────────────────────── */}
          <div className="bet-carousel-wrap">
            <span className="bet-carousel-label">Session history</span>
            <div className="bet-carousel">
              {history.map(h => (
                <div
                  key={h.id}
                  className={`bet-dot ${h.jackpot ? 'bet-dot--jackpot' : h.won ? 'bet-dot--win' : 'bet-dot--loss'}`}
                  title={`Roll: ${h.roll} | ${h.won ? '+' : ''}${fmt(h.delta)}${h.jackpot ? ' 🏆 JACKPOT' : ''}`}
                >
                  {h.jackpot ? '★' : h.roll}
                </div>
              ))}
            </div>
          </div>

          {/* ── stats sessão ──────────────────────────────── */}
          {history.length > 0 && (
            <div className="bet-stats">
              <div className="bet-stat bet-stat--win">
                <span className="bet-stat__label">Wins</span>
                <span className="bet-stat__value bet-stat__value--green">{stats.wins}</span>
              </div>
              <div className="bet-stat bet-stat--loss">
                <span className="bet-stat__label">Loss</span>
                <span className="bet-stat__value bet-stat__value--red">{stats.losses}</span>
              </div>
              <div className={`bet-stat ${netCard}`}>
                <span className="bet-stat__label">Total</span>
                <span className={`bet-stat__value ${netCls}`}>
                  {stats.net >= 0 ? '+' : ''}{fmt(stats.net)}
                </span>
              </div>
            </div>
          )}

          {/* ── histórico de vencedores ───────────────────── */}
          <div className="bet-winners">
            <h3 className="bet-winners__title">🏆 Jackpot history</h3>
            {jackpotWinners.length === 0 ? (
              <p className="bet-winners__empty">Be the first!</p>
            ) : (
              <ul className="bet-winners__list">
                {jackpotWinners.slice(0, 20).map((entry, i) => {
                  const [name, amount] = String(entry).split(':')
                  return (
                    <li key={i} className="bet-winners__item">
                      <span className="bet-winners__rank">#{i + 1}</span>
                      <span className="bet-winners__name">{name}</span>
                      <span className="bet-winners__amount">+{amount} LCKM</span>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>

          {/* ── wager ranking semanal ────────────────────── */}
          {(() => {
            const season = wagerRanking?.season
            const ranking = wagerRanking?.ranking ?? []
            const myUserId = profile?.id
            const endsAt = season?.ends_at ? new Date(season.ends_at) : null
            const daysLeft = endsAt
              ? Math.max(0, Math.ceil((endsAt - Date.now()) / 86400000))
              : null

            // prize_pool = pool_start × wager_prize_pct% (fixo e previsível)
            const poolStart = season?.pool_start ?? 0
            const prizePct = wagerRanking?.prize_pct ?? 10
            const estPrizePool = Math.round(poolStart * prizePct / 100)

            const pcts = [23, 17, 13, 11, 7.5, 7.5, 6, 6, 4.5, 4.5]

            return (
              <div className="bet-wager-ranking">
                <div className="bet-wager-ranking__header">
                  <h3 className="bet-wager-ranking__title">🎖 Wager Ranking</h3>
                  {daysLeft !== null && (
                    <span className="bet-wager-ranking__timer">
                      {daysLeft === 0 ? 'Ends today' : `${daysLeft}d left`}
                    </span>
                  )}
                </div>

                <p className="bet-wager-ranking__sub">
                  Bet more, climb higher. Top 10 shares:
                  {estPrizePool > 0 && (
                    <> <strong style={{ color: 'var(--gold)' }}>{fmtBR(estPrizePool)} LCKM</strong></>
                  )}
                </p>

                {ranking.length === 0 ? (
                  <p className="bet-winners__empty">No bets yet this season.</p>
                ) : (
                  <ul className="bet-winners__list">
                    {ranking.map((r, i) => {
                      const isMe = r.user_id === myUserId
                      const estPrize = round8(estPrizePool * pcts[i] / 100)
                      return (
                        <li key={i} className={`bet-winners__item${isMe ? ' bet-winners__item--me' : ''}`}>
                          <span className="bet-winners__rank">#{i + 1}</span>
                          <span className="bet-winners__name">
                            {r.display_name ?? '—'}
                          </span>
                          <span className="bet-winners__wager">{fmtBR(r.wager)}</span>
                          <span className="bet-winners__pct">
                            {estPrizePool > 0
                              ? `~${fmtBR(estPrize)}`
                              : `${pcts[i]}%`
                            }
                          </span>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </div>
            )
          })()}

        </main>
      </div>
    </>
  )
}