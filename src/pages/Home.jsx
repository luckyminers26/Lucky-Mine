import { useEffect, useState, useCallback, useRef } from 'react'
import { Link } from "react-router-dom"
import { supabase } from '../lib/supabaseClient2'
import { useAuth } from '../contexts/AuthContext'
import Header from '../components/Header'
import useMidnightCountdown from '../hooks/useMidnightCountdown'
import './Home.css'

const COOLDOWN_REGULAR_MS = 2 * 60 * 60 * 1000
const COOLDOWN_PREMIUM_MS = 24 * 60 * 60 * 1000

function formatBalance(val, dec = 4) {
  return Number(val ?? 0).toLocaleString('en-US', {
    minimumFractionDigits: dec,
    maximumFractionDigits: dec,
  })
}

function useCountdown(targetMs) {
  const [remaining, setRemaining] = useState(() =>
    targetMs ? Math.max(0, targetMs - Date.now()) : 0
  )

  useEffect(() => {
    if (!targetMs) { setRemaining(0); return }
    const tick = () => setRemaining(Math.max(0, targetMs - Date.now()))
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [targetMs])

  if (remaining <= 0) return null

  const h = Math.floor(remaining / 3600000)
  const m = Math.floor((remaining % 3600000) / 60000)
  const s = Math.floor((remaining % 60000) / 1000)

  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

function Particles({ active, gold }) {
  return (
    <div className={`particles ${active ? 'particles--burst' : ''} ${gold ? 'particles--gold' : ''}`}>
      {Array.from({ length: 12 }).map((_, i) => (
        <span key={i} className="particle" style={{ '--i': i }} />
      ))}
    </div>
  )
}

function LockCountdown({ lockedUntil }) {
  const [remaining, setRemaining] = useState(() => Math.max(0, new Date(lockedUntil) - Date.now()))

  useEffect(() => {
    const tick = () => setRemaining(Math.max(0, new Date(lockedUntil) - Date.now()))
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [lockedUntil])

  if (remaining <= 0) return <span className="lock-cd lock-cd--done">Available to withdraw</span>

  const d = Math.floor(remaining / 86400000)
  const h = Math.floor((remaining % 86400000) / 3600000)
  const m = Math.floor((remaining % 3600000) / 60000)

  return (
    <span className="lock-cd">
      🔒 {d > 0 ? `${d}d ` : ''}{h}h {m}m
    </span>
  )
}

export default function Home() {

  const { session, profile, refreshProfile } = useAuth()
  const lotteryCountdown = useMidnightCountdown()
  const [balance, setBalance] = useState(null)
  const [lastMinedAt, setLastMinedAt] = useState(null)
  const [lastPremiumAt, setLastPremiumAt] = useState(null)

  const [stakes, setStakes] = useState([])
  const [stakeInput, setStakeInput] = useState('')
  const [stakingRewards, setStakingRewards] = useState([])
  const [pendingReward, setPendingReward] = useState(0)
  const [stakingConfig, setStakingConfig] = useState(null)
  const [stakingReserve, setStakingReserve] = useState(0)
  const [stakingAction, setStakingAction] = useState(false)
  const [lockedUntil, setLockedUntil] = useState(null)

  const [supply, setSupply] = useState(null)

  const [loadingRegular, setLoadingRegular] = useState(false)
  const [loadingPremium, setLoadingPremium] = useState(false)
  const [burst, setBurst] = useState(false)
  const [premiumBurst, setPremiumBurst] = useState(false)
  const [toast, setToast] = useState(null)
  const toastTimer = useRef(null)

  function showToast(msg, type = 'success') {
    clearTimeout(toastTimer.current)
    setToast({ msg, type })
    toastTimer.current = setTimeout(() => setToast(null), 3500)
  }

  const loadProfile = useCallback(async () => {

    if (!session?.user) return

    const { data } = await supabase
      .from('profiles')
      .select('balance, last_mined_at, last_premium_at')
      .eq('id', session.user.id)
      .single()

    if (data) {
      setBalance(data.balance)
      setLastMinedAt(data.last_mined_at ? new Date(data.last_mined_at).getTime() : null)
      setLastPremiumAt(data.last_premium_at ? new Date(data.last_premium_at).getTime() : null)
    }

  }, [session])

  const loadStaking = useCallback(async () => {

    if (!session?.user) return

    const { data: cfg } = await supabase
      .from('lottery_config')
      .select('stake_lockup_days')
      .eq('id', 1)
      .single()

    setStakingConfig(cfg)

    const { data: stakeList } = await supabase
      .from('stakes')
      .select('id, amount, staked_at')
      .eq('user_id', session.user.id)
      .is('unstaked_at', null)
      .order('staked_at', { ascending: true })

    setStakes(stakeList ?? [])

    if (stakeList?.length > 0 && cfg) {
      const first = stakeList[0]
      const until = new Date(new Date(first.staked_at).getTime() + cfg.stake_lockup_days * 86400000)
      setLockedUntil(until > new Date() ? until : null)
    } else {
      setLockedUntil(null)
    }

    const { data: supply } = await supabase
      .from('token_supply')
      .select('staking_reserve')
      .eq('id', 1)
      .single()

    setStakingReserve(Number(supply?.staking_reserve ?? 0))

    const { data: rewards } = await supabase
      .from('staking_rewards')
      .select('id, amount, stake_pct, rewarded_at')
      .eq('user_id', session.user.id)
      .order('rewarded_at', { ascending: false })
      .limit(5)

    setStakingRewards(rewards ?? [])

    const { data: totals } = await supabase
      .from('staking_rewards')
      .select('amount')
      .eq('user_id', session.user.id)

    const total = (totals ?? []).reduce((s, r) => s + Number(r.amount), 0)
    setPendingReward(total)

  }, [session])

  const loadSupply = useCallback(async () => {

    const { data } = await supabase
      .from('token_supply')
      .select('staking_pool, mined_supply')
      .eq('id', 1)
      .single()

    setSupply(data)

  }, [])

  useEffect(() => {

    loadProfile()
    loadStaking()
    loadSupply()

  }, [loadProfile, loadStaking, loadSupply])

  async function handleMine(kind) {

    const setLoading = kind === 'premium' ? setLoadingPremium : setLoadingRegular

    setLoading(true)

    try {

      const { data, error } = await supabase.rpc('mine_token', { p_kind: kind })

      if (error) throw error

      if (data.error === 'not_premium') {
        showToast('', 'warn')
        return
      }

      if (data.error === 'cooldown') {
        const diff = new Date(data.retry_at) - Date.now()
        showToast(`Aguarde ${Math.floor(diff / 3600000)}h ${Math.floor((diff % 3600000) / 60000)}m.`, 'warn')
        return
      }

      if (data.ok) {

        const now = Date.now()

        if (kind === 'premium') {
          setLastPremiumAt(now)
          setLastMinedAt(now)
          setPremiumBurst(true)
          setTimeout(() => setPremiumBurst(false), 900)
        } else {
          setLastMinedAt(now)
          setBurst(true)
          setTimeout(() => setBurst(false), 900)
        }

        setBalance(prev => (parseFloat(prev ?? 0) + parseFloat(data.reward)).toFixed(4))

        showToast(`+${formatBalance(data.reward)} mined!`, 'success')

        loadProfile()
        refreshProfile()

      }

    } catch {

      showToast('Mining error.', 'error')
      loadProfile()

    } finally {

      setLoading(false)

    }

  }

  async function handleStake() {

    const amount = parseFloat(stakeInput)

    if (!amount || amount <= 0) {
      showToast('Enter a valid amount.', 'warn')
      return
    }

    setStakingAction(true)

    try {

      const { data, error } = await supabase.rpc('do_stake', { p_amount: amount })

      if (error) throw error

      if (data.error === 'insufficient_balance') {
        showToast('Insufficient balance.', 'error')
        return
      }

      if (data.error === 'already_staking') {
        showToast('You already have an active stake.', 'warn')
        return
      }

      if (data.ok) {
        showToast(`${formatBalance(amount)} LCKM staked.`, 'success')
        setStakeInput('')
        await loadStaking()
        await loadProfile()
        await loadSupply()
        await refreshProfile()
      }

    } catch {
      showToast('Stake error.', 'error')
    } finally {
      setStakingAction(false)
    }
  }

  async function handleUnstake() {

    setStakingAction(true)

    try {

      const { data, error } = await supabase.rpc('do_unstake')

      if (error) throw error

      if (data.error === 'locked') {
        const h = data.remaining_hours
        showToast(`Tokens locked for ${h}h more.`, 'warn')
        return
      }

      if (data.ok) {

        const msg = data.still_locked > 0
          ? `${formatBalance(data.returned)} LCKM returned.`
          : `${formatBalance(data.returned)} LCKM returned!`

        showToast(msg, 'success')

        await loadStaking()
        await loadProfile()
        await loadSupply()
        await refreshProfile()
      }
    } catch {
      showToast('Unstake error.', 'error')
    } finally {
      setStakingAction(false)
    }
  }

  const premiumTarget = lastPremiumAt ? lastPremiumAt + COOLDOWN_PREMIUM_MS : null
  const premiumCD = useCountdown(premiumTarget)
  const premiumActive = !!premiumCD

  const regularTarget = premiumActive
    ? premiumTarget
    : (lastMinedAt ? lastMinedAt + COOLDOWN_REGULAR_MS : null)

  const regularCD = useCountdown(regularTarget)

  const canMineRegular = !regularCD
  const canMinePremium = !premiumCD

  const regularPct = lastMinedAt
    ? Math.min(100, ((Date.now() - lastMinedAt) / COOLDOWN_REGULAR_MS) * 100)
    : 100

  const isPremium = profile?.is_premium

  const totalStaked = Number(supply?.staking_pool ?? 0)
  const myTotalStaked = stakes.reduce((s, st) => s + Number(st.amount), 0)
  const myStakePct = totalStaked > 0 ? (myTotalStaked / totalStaked * 100) : 0

  const lockupDays = stakingConfig?.stake_lockup_days ?? 7

  const isLocked = lockedUntil && new Date(lockedUntil) > new Date()

  const hasAnyStake = stakes.length > 0

  const unlockableAmount = stakes
    .filter(st => new Date(new Date(st.staked_at).getTime() + lockupDays * 86400000) <= new Date())
    .reduce((s, st) => s + Number(st.amount), 0)


  return (
    <div className="home">

      <Header />

      {toast && <div className={`home-toast home-toast--${toast.type}`}>{toast.msg}</div>}

      <main className="home-main">

        <div className="home-cards-row">
          <Link to="/lottery" className="home-card">
            <span className="home-card__title">🎲 Daily Lotto</span>
            <span className="home-card__countdown">{lotteryCountdown}</span>
          </Link>

          <Link to="/betting" className="home-card">
            <span className="home-card__title">☘️ Betting</span>
            <span className="home-card__sub">
              Try your lucky
            </span>
          </Link>
        </div>

        <Link to="/referral" className="home-card">
          <span className="referral-home-card__sub">
            🔗 Invite and earn <strong>10 LCKM</strong>
          </span>
        </Link>

        <section className="mine-section">

          <div className="mine-card">
            <div className="mine-card__top">
              <div className="mine-card__icon">⛏</div>
              <div>
                <h2 className="mine-card__title">Mining</h2>
                <p className="mine-card__desc">Collect 0.25 LCKM every 2 hours</p>
              </div>
            </div>

            <div className="mine-btn-wrap">
              <Particles active={burst} />

              <button
                className={`mine-btn ${canMineRegular ? 'mine-btn--ready' : 'mine-btn--wait'}`}
                onClick={() => handleMine('regular')}
                disabled={!canMineRegular || loadingRegular}
              >
                {loadingRegular
                  ? <span className="mine-btn__spinner" />
                  : canMineRegular
                    ? '⚡ Mine LCKM'
                    : `⏳ ${regularCD}`}
              </button>
            </div>
          </div>

          <div className='mine-card mine-card--premium'>
            <div className="mine-card__badge">PREMIUM</div>

            <div className="mine-card__top">
              <div className="mine-card__icon">{isPremium ? '💎' : '🔒'}</div>
              <div>
                <h2 className="mine-card__title">Daily Loot</h2>
                <p className="mine-card__desc">
                  {isPremium
                    ? 'Collect 24h of rewards at once'
                    : 'Equivalent to 12x mining.'}
                </p>
              </div>
            </div>

            <div className="mine-btn-wrap">
              <Particles active={premiumBurst} gold />

              {isPremium ? (
                <button
                  className={`mine-btn mine-btn--premium ${canMinePremium ? 'mine-btn--ready' : 'mine-btn--wait'}`}
                  onClick={() => handleMine('premium')}
                  disabled={!canMinePremium || loadingPremium}
                >
                  {loadingPremium
                    ? <span className="mine-btn__spinner" />
                    : canMinePremium
                      ? '💎 Mine LCKM'
                      : `⏳ ${premiumCD}`}
                </button>
              ) : (
                <Link to="/premium">
                  <button className="mine-btn mine-btn--unlock">
                    🔒 Subscribe Premium
                  </button>
                </Link>
              )}
            </div>
          </div>

        </section>

        <section className="staking-section">

          <div className="staking-header">
            <div>
              <h2 className="staking-title">🔒 Staking</h2>
              <p className="staking-desc">
                Lock tokens to receive a share of the reserve.
              </p>
              <span className="staking-reserve__hint">
                Distributed on the 1st of each month.
              </span>
            </div>

            {totalStaked > 0 && (
              <div className="staking-pool-info">
                <span className="staking-pool-label">Total pool</span>
                <span className="staking-pool-value">{formatBalance(totalStaked, 2)} LCKM</span>
              </div>
            )}
          </div>

          {/* restante staking traduzido */}

          <input
            type="number"
            className="staking-input"
            placeholder="Amount of LCKM"
            value={stakeInput}
            onChange={e => setStakeInput(e.target.value)}
          />

          <button className="staking-btn staking-btn--stake">
            🔒 Stake
          </button>

        </section>
      </main>
    </div>
  )
}