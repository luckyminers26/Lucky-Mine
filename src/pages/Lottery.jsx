import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabaseClient2'
import { useAuth } from '../contexts/AuthContext'
import useMidnightCountdown from '../hooks/useMidnightCountdown'
import Header from '../components/Header'
import './Lottery.css'

function formatBalance(val) {
  return Number(val ?? 0).toLocaleString('en-US', {
    minimumFractionDigits: 4,
    maximumFractionDigits: 4,
  })
}

export default function Lottery() {
  const { session, profile, refreshProfile } = useAuth()
  const countdown = useMidnightCountdown()

  const [config, setConfig] = useState(null)
  const [lottery, setLottery] = useState(null)
  const [myEntry, setMyEntry] = useState(null)
  const [pastLotteries, setPastLotteries] = useState([])
  const [loading, setLoading] = useState(true)
  const [entering, setEntering] = useState(false)
  const [toast, setToast] = useState(null)

  function showToast(msg, type = 'success') {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 3500)
  }

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const { data: cfg } = await supabase
        .from('lottery_config')
        .select('*')
        .eq('id', 1)
        .single()
      setConfig(cfg)

      const { data: open } = await supabase
        .from('lotteries')
        .select('*')
        .eq('status', 'open')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      setLottery(open)

      if (open && session?.user?.id) {
        const { data: entry } = await supabase
          .from('lottery_entries')
          .select('*')
          .eq('lottery_id', open.id)
          .eq('user_id', session.user.id)
          .maybeSingle()
        setMyEntry(entry)
      } else {
        setMyEntry(null)
      }

      const { data: past } = await supabase
        .from('lotteries')
        .select('id, total_entries, winners_count, prize_per_winner, drawn_at, lottery_entries ( won, user_id, prize )')
        .eq('status', 'finished')
        .order('drawn_at', { ascending: false })
        .limit(5)

      const allUserIds = (past ?? [])
        .flatMap(l => l.lottery_entries.filter(e => e.won).map(e => e.user_id))
      const uniqueIds = [...new Set(allUserIds)]

      let nameMap = {}
      if (uniqueIds.length > 0) {
        const { data: profiles } = await supabase
          .from('profiles_public')
          .select('id, display_name')
          .in('id', uniqueIds)
        nameMap = Object.fromEntries((profiles ?? []).map(p => [p.id, p.display_name]))
      }

      const pastWithNames = (past ?? []).map(l => ({
        ...l,
        lottery_entries: l.lottery_entries.map(e => ({
          ...e,
          display_name: nameMap[e.user_id] ?? 'Usuário',
        })),
      }))
      setPastLotteries(pastWithNames)

    } finally {
      setLoading(false)
    }
  }, [session])

  useEffect(() => { loadData() }, [loadData])

  useEffect(() => {
    const ch = supabase.channel('lottery-rt')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'lotteries' }, () => {
        loadData(); refreshProfile()
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'lottery_entries' }, loadData)
      .subscribe()
    return () => supabase.removeChannel(ch)
  }, [loadData, refreshProfile])

  async function handleEnter() {
    if (!profile) return
    setEntering(true)
    try {
      const { data, error } = await supabase.rpc('enter_lottery')
      if (error) throw error

      if (data.error === 'already_entered') { showToast('Você já está nesta rodada!', 'warn'); return }
      if (data.error === 'insufficient_balance') { showToast('Saldo insuficiente.', 'error'); return }
      if (data.error === 'no_open_lottery') { showToast('Nenhuma rodada aberta.', 'warn'); return }

      if (data.ok) {
        showToast(`Ticket #${data.ticket_num} Confirmed! Good luck 🎲`, 'success')
        await loadData()
        await refreshProfile()
      }
    } catch {
      showToast('Error. Try again.', 'error')
    } finally {
      setEntering(false)
    }
  }

  const estimatedPool = lottery && config ? lottery.total_entries * lottery.entry_cost * config.prize_pool_pct / 100 : 0
  const estimatedWinners = lottery && config ? Math.max(1, Math.floor(lottery.total_entries * config.winner_pct / 100)) : 0
  const estimatedPrize = estimatedWinners > 0 ? estimatedPool / estimatedWinners : 0

  const hasBalance = profile?.balance >= (config?.entry_cost ?? 0)

  return (
    <div className="lottery-page">
      <Header />

      {toast && (
        <div className={`lottery-toast lottery-toast--${toast.type}`}>{toast.msg}</div>
      )}

      <main className="lottery-main">
        <div className="lottery-hero">
          <div className="lottery-hero__orb lottery-hero__orb--1" />
          <h1 className="lottery-hero__title">Daily Lotto</h1>
          <div className="lottery-hero__countdown">
            <span className="lottery-hero__countdown-label">Next drawning</span>
            <span className="lottery-hero__countdown-value">{countdown}</span>
          </div>
        </div>

        {loading ? (
          <div className="lottery-loading"><span className="lottery-spinner" /></div>
        ) : (
          <>
            <section className="lottery-card lottery-card--current">
              <div className="lottery-card__header">
                <div className="lottery-card__header-left">
                  <span className="lottery-card__status lottery-card__status--open">● Open</span>
                  <span className="lottery-card__id">Round #{lottery?.id ?? '—'}</span>
                </div>
              </div>

              <div className="lottery-stats">
                <div className="lottery-stat lottery-stat--highlight">
                  <span className="lottery-stat__label">Prize per winner</span>
                  <span className="lottery-stat__value lottery-stat__value--gold">
                    {lottery?.total_entries > 0 ? formatBalance(estimatedPrize) : '—'} LCKM
                  </span>
                </div>
                <div className="lottery-stat">
                  <span className="lottery-stat__label">Ticket</span>
                  <span className="lottery-stat__value">{formatBalance(config?.entry_cost ?? 0)}</span>
                </div>
              </div>

              <div className="lottery-enter">
                {myEntry ? (
                  <div className="lottery-enter__ticket">
                    <span className="lottery-enter__ticket-label">your number</span>
                    <span className="lottery-enter__ticket-num">#{myEntry.ticket_num}</span>
                  </div>
                ) : (
                  <>
                    {!hasBalance && (
                      <p className="lottery-enter__no-balance">Insufficient balance.</p>
                    )}
                    <button
                      className="lottery-enter__btn"
                      onClick={handleEnter}
                      disabled={entering || !lottery || !hasBalance}
                    >
                      {entering
                        ? <span className="lottery-spinner lottery-spinner--sm" />
                        : '🎲 Join round'}
                    </button>
                  </>
                )}
              </div>
            </section>

            {pastLotteries.length > 0 && (
              <div className="past-lotteries">
                <h3 className="past-lotteries__title">Last rounds</h3>
                {pastLotteries.map(lot => {
                  const winners = lot.lottery_entries.filter(e => e.won)
                  const iWon = winners.some(e => e.user_id === session?.user?.id)
                  return (
                    <section key={lot.id} className={`lottery-card lottery-card--result ${iWon ? 'lottery-card--winner' : ''}`}>
                      <div className="lottery-card__header">
                        <div className="lottery-card__header-left">
                          <span className="lottery-card__status lottery-card__status--closed">● Encerrada</span>
                          <span className="lottery-card__id">Round #{lot.id}</span>
                        </div>
                        <span className="lottery-drawn-at--inline">
                          {new Date(lot.drawn_at).toLocaleString('pt-BR', {
                            day: '2-digit', month: '2-digit',
                            hour: '2-digit', minute: '2-digit'
                          })}
                        </span>
                      </div>

                      {iWon && (
                        <div className="lottery-winner-banner">
                          🏆 You were one of the winners!
                        </div>
                      )}

                      {winners.length > 0 ? (
                        <ul className="winners-list">
                          {winners.map((e, i) => (
                            <li key={i} className={`winners-list__item ${e.user_id === session?.user?.id ? 'winners-list__item--me' : ''}`}>
                              <span className="winners-list__icon">🏆</span>
                              <span className="winners-list__name">
                                {e.display_name}
                              </span>
                              <span className="winners-list__prize">+{formatBalance(e.prize)} LCKM</span>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="lottery-no-winners">No winner in this round.</p>
                      )}
                    </section>
                  )
                })}
              </div>
            )}

            <section className="lottery-split">
              <h3 className="lottery-split__title">Prize distribution</h3>
              <div className="lottery-split__cards">
                <div className="split-card split-card--prize">
                  <div className="split-card__pct">80%</div>
                  <div className="split-card__label">Prize</div>
                  <div className="split-card__desc">Divided among the winners.</div>
                </div>
                <div className="split-card split-card--staking">
                  <div className="split-card__pct">10%</div>
                  <div className="split-card__label">Staking</div>
                  <div className="split-card__desc">Proportional to each user's stake.</div>
                </div>
                <div className="split-card split-card--burn">
                  <div className="split-card__pct">10%</div>
                  <div className="split-card__label">Burn</div>
                  <div className="split-card__desc">Permanently removed from circulation</div>
                </div>
              </div>
            </section>

            <section className="lottery-rules">
              <h3>How it works</h3>
              <ul>
                <li>Each user enters <strong>once</strong> per round by paying {formatBalance(config?.entry_cost ?? 0)} LCKM.</li>
                <li>Every day at midnight (UTC-03:00), the draw happens automatically.</li>
                <li><strong>{config?.winner_pct ?? 5}%</strong> of participants are selected as winners.</li>
                <li><strong>{config?.prize_pool_pct ?? 80}%</strong> of the total collected is evenly distributed among the winners.</li>
                <li>A new round starts after the draw.</li>
              </ul>
            </section>
          </>
        )}
      </main>
    </div>
  )
}