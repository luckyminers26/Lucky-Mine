import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../contexts/AuthContext2'
import useMidnightCountdown from '../hooks/useMidnightCountdown'
import Header from '../components/Header'
import './Lottery.css'

function formatBalance(val) {
  return Number(val ?? 0).toLocaleString('en-US', {
    minimumFractionDigits: 8,
    maximumFractionDigits: 8,
  })
}

function TicketGrid({ total, myTicket, winners }) {
  const winSet = new Set(winners ?? [])
  const cells  = Array.from({ length: Math.min(total, 120) }, (_, i) => i + 1)
  return (
    <div className="ticket-grid">
      {total === 0 ? (
        <p className="ticket-grid__empty">Nenhum ticket ainda. Seja o primeiro!</p>
      ) : (
        <>
          {cells.map(n => (
            <div
              key={n}
              className={[
                'ticket-cell',
                n === myTicket         ? 'ticket-cell--mine'   : '',
                winSet.has(n)          ? 'ticket-cell--winner' : '',
                n === myTicket && winSet.has(n) ? 'ticket-cell--both' : '',
              ].join(' ')}
              title={`#${n}`}
            />
          ))}
          {total > 120 && (
            <div className="ticket-grid__more">+{total - 120} outros</div>
          )}
        </>
      )}
    </div>
  )
}

export default function Lottery() {
  const { session, profile, refreshProfile } = useAuth()
  const countdown = useMidnightCountdown()

  const [config, setConfig]         = useState(null)
  const [lottery, setLottery]       = useState(null)
  const [myEntry, setMyEntry]       = useState(null)
  const [pastLotteries, setPastLotteries] = useState([])
  const [loading, setLoading]       = useState(true)
  const [entering, setEntering]     = useState(false)
  const [toast, setToast]           = useState(null)

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
        .select(`id, total_entries, winners_count, prize_per_winner, drawn_at,
                 lottery_entries ( won, user_id, prize, profiles ( display_name ) )`)
        .eq('status', 'finished')
        .order('drawn_at', { ascending: false })
        .limit(5)
      setPastLotteries(past ?? [])
    } finally {
      setLoading(false)
    }
  }, [session])

  useEffect(() => { loadData() }, [loadData])

  // Realtime
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

      if (data.error === 'already_entered')        { showToast('Você já está nesta rodada!', 'warn'); return }
      if (data.error === 'insufficient_balance')   { showToast('Saldo insuficiente.', 'error'); return }
      if (data.error === 'no_open_lottery')        { showToast('Nenhuma rodada aberta.', 'warn'); return }

      if (data.ok) {
        showToast(`Ticket #${data.ticket_num} confirmado! Boa sorte 🎲`, 'success')
        await loadData()
        await refreshProfile()
      }
    } catch {
      showToast('Erro ao participar. Tente novamente.', 'error')
    } finally {
      setEntering(false)
    }
  }



  const estimatedPool    = lottery && config ? lottery.total_entries * lottery.entry_cost * config.prize_pool_pct / 100 : 0
  const estimatedWinners = lottery && config ? Math.max(1, Math.floor(lottery.total_entries * config.winner_pct / 100)) : 0
  const estimatedPrize   = estimatedWinners > 0 ? estimatedPool / estimatedWinners : 0

  const hasBalance = profile?.balance >= (config?.entry_cost ?? 0)

  return (
    <div className="lottery-page">
      <Header />

      {toast && (
        <div className={`lottery-toast lottery-toast--${toast.type}`}>{toast.msg}</div>
      )}

      <main className="lottery-main">

        {/* Hero com countdown */}
        <div className="lottery-hero">
          <div className="lottery-hero__orb lottery-hero__orb--1" />
          <div className="lottery-hero__orb lottery-hero__orb--2" />
          <h1 className="lottery-hero__title">🎲 Loteria Diária</h1>
          <p className="lottery-hero__sub">
            Sorteio automático todo dia à meia-noite (UTC-03:00).<br />
            {config ? `${config.winner_pct}%` : '5%'} dos participantes ganham.
          </p>
          <div className="lottery-hero__countdown">
            <span className="lottery-hero__countdown-label">Próximo sorteio em</span>
            <span className="lottery-hero__countdown-value">{countdown}</span>
          </div>
        </div>

        {loading ? (
          <div className="lottery-loading"><span className="lottery-spinner" /></div>
        ) : (
          <>
            {/* Rodada atual */}
            <section className="lottery-card lottery-card--current">
              <div className="lottery-card__header">
                <div className="lottery-card__header-left">
                  <span className="lottery-card__status lottery-card__status--open">● Aberta</span>
                  <span className="lottery-card__id">Rodada #{lottery?.id ?? '—'}</span>
                </div>
                <span className="lottery-card__closes">Fecha à meia-noite</span>
              </div>

              <div className="lottery-stats">
                <div className="lottery-stat lottery-stat--highlight">
                  <span className="lottery-stat__label">Prêmio POR vencedor</span>
                  <span className="lottery-stat__value lottery-stat__value--gold">
                    {lottery?.total_entries > 0 ? formatBalance(estimatedPrize) : '—'} TKN
                  </span>
                </div>
                <div className="lottery-stat">
                  <span className="lottery-stat__label">Entrada</span>
                  <span className="lottery-stat__value">{formatBalance(config?.entry_cost ?? 0)}</span>
                </div>
              </div>

              <TicketGrid
                total={lottery?.total_entries ?? 0}
                myTicket={myEntry?.ticket_num}
                winners={[]}
              />

              <div className="lottery-enter">
                {myEntry ? (
                  <div className="lottery-enter__ticket">
                    <span className="lottery-enter__ticket-label">Seu ticket</span>
                    <span className="lottery-enter__ticket-num">#{myEntry.ticket_num}</span>
                    <span className="lottery-enter__waiting">Aguardando sorteio à meia-noite…</span>
                  </div>
                ) : (
                  <>
                    <div className="lottery-enter__cost">
                      <span>Entrada:</span>
                      <strong>{formatBalance(config?.entry_cost ?? 0)} TKN</strong>
                    </div>
                    {!hasBalance && (
                      <p className="lottery-enter__no-balance">Saldo insuficiente para participar.</p>
                    )}
                    <button
                      className="lottery-enter__btn"
                      onClick={handleEnter}
                      disabled={entering || !lottery || !hasBalance}
                    >
                      {entering
                        ? <span className="lottery-spinner lottery-spinner--sm" />
                        : '🎲 Participar desta rodada'}
                    </button>
                  </>
                )}
              </div>
            </section>

            {/* Resultados anteriores */}
            {pastLotteries.length > 0 && (
              <div className="past-lotteries">
                <h3 className="past-lotteries__title">Últimas rodadas</h3>
                {pastLotteries.map(lot => {
                  const winners = lot.lottery_entries.filter(e => e.won)
                  const iWon = winners.some(e => e.user_id === session?.user?.id)
                  return (
                    <section key={lot.id} className={`lottery-card lottery-card--result ${iWon ? 'lottery-card--winner' : ''}`}>
                      <div className="lottery-card__header">
                        <div className="lottery-card__header-left">
                          <span className="lottery-card__status lottery-card__status--closed">● Encerrada</span>
                          <span className="lottery-card__id">Rodada #{lot.id}</span>
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
                          🏆 Você foi um dos vencedores desta rodada!
                        </div>
                      )}

                      {winners.length > 0 ? (
                        <ul className="winners-list">
                          {winners.map((e, i) => (
                            <li key={i} className={`winners-list__item ${e.user_id === session?.user?.id ? 'winners-list__item--me' : ''}`}>
                              <span className="winners-list__icon">🏆</span>
                              <span className="winners-list__name">
                                {e.profiles?.display_name ?? 'Usuário'}
                                {e.user_id === session?.user?.id && <span className="winners-list__you"> (você)</span>}
                              </span>
                              <span className="winners-list__prize">+{formatBalance(e.prize)} TKN</span>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="lottery-no-winners">Nenhum vencedor nesta rodada.</p>
                      )}
                    </section>
                  )
                })}
              </div>
            )}

            {/* Split da loteria */}
            <section className="lottery-split">
              <h3 className="lottery-split__title">Distribuição do prêmio</h3>
              <div className="lottery-split__cards">
                <div className="split-card split-card--prize">
                  <div className="split-card__pct">80%</div>
                  <div className="split-card__label">Prêmio</div>
                  <div className="split-card__desc">Dividido entre os vencedores sorteados</div>
                </div>
                <div className="split-card split-card--staking">
                  <div className="split-card__pct">10%</div>
                  <div className="split-card__label">Staking</div>
                  <div className="split-card__desc">Proporcional ao stake de cada usuário</div>
                </div>
                <div className="split-card split-card--burn">
                  <div className="split-card__pct">10%</div>
                  <div className="split-card__label">Queima</div>
                  <div className="split-card__desc">Removido permanentemente de circulação</div>
                </div>
              </div>
            </section>

            {/* Regras */}
            <section className="lottery-rules">
              <h3>Como funciona</h3>
              <ul>
                <li>Cada usuário entra <strong>uma vez</strong> por rodada pagando {formatBalance(config?.entry_cost ?? 0)} TKN.</li>
                <li>Todo dia à meia-noite (UTC-03:00) o sorteio acontece automaticamente.</li>
                <li><strong>{config?.winner_pct ?? 5}%</strong> dos participantes são sorteados como vencedores.</li>
                <li><strong>{config?.prize_pool_pct ?? 80}%</strong> do total arrecadado é dividido igualmente entre os vencedores.</li>
                <li>Uma nova rodada abre  após o sorteio.</li>
              </ul>
            </section>
          </>
        )}
      </main>
    </div>
  )
}