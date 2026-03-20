import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient2'
import { useAuth } from '../contexts/AuthContext'
import Header from '../components/Header'
import './Betting.css'

/* ─── constantes ──────────────────────────────────────────── */
const MIN_BET = 0.0001
const CAROUSEL_MAX = 40
const AUTO_DELAY = 900
// JACKPOT_MULT existe só para exibição no front — a lógica real está no SQL
const JACKPOT_MULT = 9500

/* payout = 0.99 / chance  (house edge 1%) */
function calcPayout(chancePct) {
  return 0.99 / (chancePct / 100)
}

/* ─── helpers ─────────────────────────────────────────────── */
const fmt = n => Number(n).toFixed(4)
const round4 = n => Math.round(n * 10000) / 10000
const clamp = (v, mn, mx) => Math.max(mn, Math.min(mx, v))

function parseSafe(str) {
  const n = parseFloat(str)
  return isNaN(n) || !isFinite(n) ? null : n
}

function validateBet(raw, bal) {
  const amt = parseSafe(raw)
  if (amt === null || amt < MIN_BET) return { ok: false, msg: `Mínimo ${fmt(MIN_BET)}` }
  if (amt > bal) return { ok: false, msg: 'Saldo insuficiente' }
  return { ok: true, amt }
}

/* Toda lógica de roll e jackpot é server-side.
   O cliente apenas exibe o que o banco retorna. */

export default function Betting() {
  const { profile, refreshProfile } = useAuth()
  const navigate = useNavigate()

  const [balance, setBalance] = useState(null)
  const [jackpotPool, setJackpot] = useState(null)
  const [betInput, setBetInput] = useState('')
  const [chancePct, setChancePct] = useState(50)
  const [multInput, setMultInput] = useState('2')
  const [autoOn, setAutoOn] = useState(false)
  const [running, setRunning] = useState(false)
  const [toast, setToast] = useState(null)
  const [stopped, setStopped] = useState(null)
  const [stopGain, setStopGain] = useState('')
  const [stopLoss, setStopLoss] = useState('')
  const [history, setHistory] = useState([])
  const [stats, setStats] = useState({ wins: 0, losses: 0, net: 0, streak: 0 })
  const [jackpotModal, setJackpotModal] = useState(null)
  const [currentBetDisplay, setCurrentBetDisplay] = useState(null) // aposta atual no auto (com mult)

  /* ── refs ── */
  const autoRef = useRef(false)
  const balanceRef = useRef(null)
  const initialBalRef = useRef(null)
  const currentBetRef = useRef(0)
  const baseBetRef = useRef(0)
  const mountedRef = useRef(true)
  const toastTimer = useRef(null)
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

  /* busca jackpot pool ao montar */
  useEffect(() => {
    supabase.rpc('get_jackpot_pool').then(({ data }) => {
      if (data != null) setJackpot(Number(data))
    })
  }, [])

  /* para ao desmontar */
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      autoRef.current = false
      clearTimeout(toastTimer.current)
    }
  }, [])

  function showToast(type, msg) {
    clearTimeout(toastTimer.current)
    setToast({ type, msg, key: Date.now() })
    toastTimer.current = setTimeout(() => {
      if (mountedRef.current) setToast(null)
    }, 1800)
  }

  /* ── uma aposta ──────────────────────────────────────────── */
  const placeBet = useCallback(async (amount, baseAmount, chance) => {
    if (!mountedRef.current) return null

    const amt = round4(clamp(amount, MIN_BET, balanceRef.current ?? 0))
    if (amt < MIN_BET) return null

    /* cliente envia APENAS o valor e a chance — banco decide tudo */
    const { data, error } = await supabase.rpc('bet_token', {
      p_amount: amt,
      p_chance: chance,
    })

    if (!mountedRef.current) return null

    if (error || !data || data.error) {
      /* rate_limited: silencioso — o loop auto já tem AUTO_DELAY, apenas ignora */
      if (data?.error === 'rate_limited') return null

      const msg =
        data?.error === 'insufficient' ? 'Saldo insuficiente.' :
          data?.error === 'below_minimum' ? 'Aposta abaixo do mínimo.' :
            data?.error === 'invalid_chance' ? 'Chance inválida.' :
              data?.error === 'not_found' ? 'Perfil não encontrado.' :
                `Erro: ${data?.error ?? error?.message ?? 'desconhecido'}`
      autoRef.current = false
      setAutoOn(false)
      setRunning(false)
      setStopped(msg)
      showToast('warn', msg)
      return null
    }

    /* tudo vem do servidor */
    const roll = data.roll
    const won = data.won
    const newBal = Number(data.balance)
    const delta = Number(data.delta)
    const jackpotHit = data.jackpot === true
    const jackpotAmt = Number(data.jackpot_amt ?? 0)

    rollHistRef.current = (data.roll_hist ?? [])

    balanceRef.current = newBal
    setBalance(newBal)

    /* pool local */
    setJackpot(prev => {
      if (jackpotHit) return 0
      return round4((prev ?? 0) + (won ? 0 : amt))
    })

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
        net: round4(prev.net + delta + jackpotAmt),
        streak,
      }
    })

    /* jackpot */
    if (jackpotHit) {
      autoRef.current = false
      setAutoOn(false)
      setCurrentBetDisplay(null)
      setJackpotModal({
        nums: rollHistRef.current.slice(0, 5),
        amt: jackpotAmt,
        base: baseAmount,
      })
      return { won, newBal, delta, jackpotHit: true, jackpotAmt }
    }

    showToast(won ? 'win' : 'loss', won ? `+${fmt(delta)}` : fmt(delta))
    return { won, newBal, delta, jackpotHit: false, jackpotAmt: 0 }
  }, [])

  /* ── manual ──────────────────────────────────────────────── */
  async function handleManualBet() {
    if (running || autoOn) return
    const bal = balanceRef.current ?? 0
    const v = validateBet(betInput, bal)
    if (!v.ok) { showToast('warn', v.msg); return }
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
    if (!v.ok) { showToast('warn', v.msg); return }

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
      const bet = round4(clamp(currentBetRef.current, MIN_BET, curBal))

      if (curBal < MIN_BET) {
        autoRef.current = false; setStopped('Saldo insuficiente.'); break
      }

      /* atualiza display antes de cada aposta */
      setCurrentBetDisplay(bet)
      setRunning(true)
      const res = await placeBet(bet, v.amt, chance)
      if (!mountedRef.current) break
      setRunning(false)

      /* rate_limited: apenas aguarda o próximo ciclo sem quebrar o loop */
      if (!res) {
        await new Promise(r => setTimeout(r, AUTO_DELAY))
        continue
      }

      if (res.jackpotHit) { autoRef.current = false; break }

      /* calcula próxima aposta: multiplica em derrota, reseta em vitória */
      currentBetRef.current = res.won
        ? v.amt
        : round4(clamp(bet * mult, MIN_BET, res.newBal))

      const gained = round4(res.newBal - initialBalRef.current)
      if (gainLimit !== null && gained >= gainLimit) {
        autoRef.current = false; setStopped(`Stop gain atingido (+${fmt(gainLimit)}).`); break
      }
      if (lossLimit !== null && -gained >= lossLimit) {
        autoRef.current = false; setStopped(`Stop loss atingido (−${fmt(lossLimit)}).`); break
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
  const multActive = currentBetDisplay !== null && currentBetDisplay > betBase

  function setQuick(fn) {
    setBetInput(fmt(round4(Math.max(fn(bal), MIN_BET))))
  }
  function doDouble() {
    const v = parseSafe(betInput); if (!v) return
    setBetInput(fmt(round4(Math.min(v * 2, bal))))
  }
  function doHalf() {
    const v = parseSafe(betInput); if (!v) return
    setBetInput(fmt(round4(Math.max(v / 2, MIN_BET))))
  }

  const PRESETS = [10, 50, 90]

  return (
    <>
      <Header />

      {/* ── modal jackpot ───────────────────────────────────── */}
      {jackpotModal && (
        <div className="bet-jackpot-overlay">
          <div className="bet-jackpot-modal">
            <span className="bet-jackpot-modal__emoji">🏆</span>
            <h2 className="bet-jackpot-modal__title">JACKPOT!</h2>
            <p style={{ color: '#9090a8', fontSize: '0.82rem', margin: 0 }}>
              Últimos 5 números com a mesma dezena!
            </p>
            <div className="bet-jackpot-modal__nums">
              {jackpotModal.nums.map((n, i) => (
                <div key={i} className="bet-jackpot-modal__num">
                  {String(n).padStart(2, '0')}
                </div>
              ))}
            </div>
            <div className="bet-jackpot-modal__prize">
              +{fmt(jackpotModal.amt)} LCKM
            </div>
            <p className="bet-jackpot-modal__sub" />
            <button
              className="bet-jackpot-modal__btn"
              onClick={() => { setJackpotModal(null); refreshProfile() }}
            >
              Fechar 🎉
            </button>
          </div>
        </div>
      )}

      <div className="bet-page">
        <main className="bet-main">

          {/* ── hero — jackpot pool ────────────────────────── */}
          <div className="bet-hero">
            <div className="bet-hero__orb" />
            <h1 className="bet-hero__title">🎲 Apostas</h1>
            <div className="bet-hero__jackpot">
              <span className="bet-hero__jackpot-label">🏆 Jackpot</span>
              <span className="bet-hero__jackpot-value">
                {jackpotPool !== null ? fmt(jackpotPool) : '——'}
              </span>
              <span className="bet-hero__jackpot-sub">
                5 apostas seguidas na mesma dezena (0x–9x)
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
                  vitória se rolar ≥ {100 - chancePct} (de 0–99)
                </span>
              </div>
              <input
                className="bet-slider"
                type="range"
                min="1" max="95" step="1"
                value={chancePct}
                onChange={e => setChancePct(Number(e.target.value))}
                disabled={autoOn}
              />
              <div className="bet-chance-presets">
                {PRESETS.map(p => (
                  <button
                    key={p}
                    className={`bet-preset-btn ${chancePct === p ? 'bet-preset-btn--active' : ''}`}
                    disabled={autoOn}
                    onClick={() => setChancePct(p)}
                  >
                    {p}%
                  </button>
                ))}
              </div>
            </div>

            <div className="bet-prob-bar">
              <div className="bet-prob-fill" style={{ width: `${chancePct}%` }} />
              <span className="bet-prob-label">GANHO {chancePct}%</span>
              <span className="bet-prob-label bet-prob-label--loss">PERDA {100 - chancePct}%</span>
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
                <span className="bet-payout-card__label">Se ganhar</span>
              </div>
              <div className="bet-payout-card bet-payout-card--loss">
                <span className="bet-payout-card__val bet-payout-card__val--red">
                  −{betVal > 0 ? fmt(betVal) : '0.0000'}
                </span>
                <span className="bet-payout-card__label">Se perder</span>
              </div>
            </div>
          </div>

          {/* ── configuração ──────────────────────────────── */}
          <div className="bet-card">

            <div className="bet-field">
              <label className="bet-field__label">Valor da aposta</label>
              <input
                className={`bet-input${betInput && !valid.ok ? ' bet-input--error' : ''}`}
                type="number" min={MIN_BET} step={MIN_BET}
                value={betInput}
                onChange={e => setBetInput(e.target.value)}
                placeholder="0.0000"
                disabled={autoOn}
              />
              {betInput && !valid.ok
                ? <p className="bet-hint bet-hint--error">{valid.msg}</p>
                : <p className="bet-hint">Mínimo: {fmt(MIN_BET)}</p>
              }

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
                  type="number" min="1" max="1000" step="0.1"
                  value={multInput}
                  onChange={e => setMultInput(e.target.value)}
                  disabled={autoOn}
                />
                <span className="bet-mult-desc">
                  Multiply on loss<br />
                  Reset when win.
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
                    placeholder="sem limite"
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
                    placeholder="sem limite"
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
                {running && !autoOn
                  ? <><div className="bet-spinner" /></>
                  : '⚡ Bet'
                }
              </button>

              {!autoOn ? (
                <button
                  className="bet-auto-btn"
                  disabled={!valid.ok || running}
                  onClick={startAuto}
                >
                  ▶ Start Auto
                </button>
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
          
          {autoOn && currentBetDisplay !== null && (
            <div className={`bet-current-bet${multActive ? ' bet-current-bet--active' : ''}`}>
              <span className="bet-current-bet__label">Aposta atual</span>
              <span className="bet-current-bet__value">
                {fmt(currentBetDisplay)}
              </span>
            </div>
          )}

          {/* ── carrossel ─────────────────────────────────── */}
          <div className="bet-carousel-wrap">
            <span className="bet-carousel-label">Session history</span>
            <div className="bet-carousel">
              {history.map(h => (
                <div
                  key={h.id}
                  className={`bet-dot ${h.jackpot ? 'bet-dot--jackpot' : h.won ? 'bet-dot--win' : 'bet-dot--loss'}`}
                  title={`Número: ${h.roll} | ${h.won ? '+' : ''}${fmt(h.delta)}${h.jackpot ? ' 🏆 JACKPOT' : ''}`}
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

        </main>
      </div>
    </>
  )
}