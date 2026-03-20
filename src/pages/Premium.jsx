import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { ethers } from 'ethers'
import { supabase } from '../lib/supabaseClient2'
import { useAuth } from '../contexts/AuthContext'
import Header from '../components/Header'
import './Premium.css'

const USDT_ADDRESS = '0x55d398326f99059fF775485246999027B3197955' // USDT BEP-20 BSC Mainnet
const RECEIVE_WALLET = ''

const USDT_ABI = [
  'function transfer(address to, uint256 amount) returns (bool)',
  'function decimals() view returns (uint8)',
]

function fmt8(val) {
  return Number(val ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 })
}

function PremiumBadge({ type }) {
  if (!type) return null
  return (
    <div className={`prem-badge ${type === 'lifetime' ? 'prem-badge--lifetime' : 'prem-badge--monthly'}`}>

    </div>
  )
}

export default function Premium() {
  const { profile, session, refreshProfile } = useAuth()
  const navigate = useNavigate()

  const [config, setConfig] = useState(null)
  const [wallet, setWallet] = useState(null)
  const [signer, setSigner] = useState(null)
  const [loading, setLoading] = useState(null)
  const [success, setSuccess] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    supabase.from('premium_config').select('*').single()
      .then(({ data, error }) => {
        if (error) console.error('premium_config:', error.message)
        if (data) setConfig(data)
      })
  }, [])

  // ── Wallet ──────────────────────────────────────────
  async function connectWallet() {
    if (!window.ethereum) { setError('MetaMask não encontrada'); return }
    try {
      const provider = new ethers.BrowserProvider(window.ethereum)
      await provider.send('eth_requestAccounts', [])
      const network = await provider.getNetwork()
      if (Number(network.chainId) !== 56) {
        try {
          await window.ethereum.request({
            method: 'wallet_switchEthereumChain',
            params: [{ chainId: '0x38' }],
          })
        } catch { }
        setError('Troque para a rede Sepolia')
        return
      }
      const s = await provider.getSigner()
      setSigner(s)
      setWallet(await s.getAddress())
      setError('')
    } catch (e) {
      setError(e.message)
    }
  }

  // ── Pay LCKM ─────────────────────────────────────────
  async function payWithLCKM(plan) {
    setError('')
    setLoading(`${plan}-LCKM`)
    try {
      const { data, error } = await supabase.rpc('activate_premium_lckm', { p_plan: plan })
      if (error) throw error
      if (data.error) {
        const msgs = {
          insufficient_balance: `Saldo insuficiente. Necessário: ${fmt8(data.required)} LCKM`,
          already_lifetime: 'Você já tem Premium Vitalício.',
          already_active: 'Plano mensal já ativo.',
          lifetime_slots_full: 'Todas as vagas vitalícias foram preenchidas.',
        }
        setError(msgs[data.error] ?? data.error)
        return
      }
      await refreshProfile()
      setSuccess(plan)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(null)
    }
  }

  // ── Pay USDC ─────────────────────────────────────────
  async function payWithUsdc(plan) {
    setError('')
    if (!signer) { await connectWallet(); return }
    if (!config) { setError('Configuração não carregada, aguarde.'); return }

    const price = plan === 'monthly'
      ? config.monthly_price_usdt
      : config.lifetime_price_usdt

    if (price == null) {
      setError('Preço não encontrado no banco.')
      return
    }

    setLoading(`${plan}-usdt`)
    try {
      const usdt = new ethers.Contract(USDT_ADDRESS, USDT_ABI, signer)
      const decimals = await usdt.decimals()
      const amount = ethers.parseUnits(String(price), decimals)
      const to = config.receive_wallet || RECEIVE_WALLET
      if (!to) { setError('Wallet de recebimento não configurada no banco.'); return }

      const tx = await usdt.transfer(to, amount)
      await tx.wait()

      const { error } = await supabase.functions.invoke('activate-premium-usdt', {
        body: { plan, tx_hash: tx.hash },
      })
      if (error) throw new Error(error.message)

      await refreshProfile()
      setSuccess(plan)
    } catch (e) {
      setError(e.reason ?? e.message)
    } finally {
      setLoading(null)
    }
  }

  // ── Derived state ────────────────────────────────────
  const isPremium = !!profile?.is_premium
  const isLifetime = profile?.premium_type === 'lifetime'
  // Mensal ativo = tipo monthly E data de expiração no futuro
  const isMonthly = profile?.premium_type === 'monthly' &&
    profile?.premium_expires_at != null &&
    new Date(profile.premium_expires_at) > new Date()

  const slotsLeft = config != null
    ? config.lifetime_max_slots - config.lifetime_used_slots
    : null

  // Formata data de expiração com segurança
  const expiresStr = profile?.premium_expires_at
    ? (() => {
      const d = new Date(profile.premium_expires_at)
      return isNaN(d.getTime()) ? null : d.toLocaleDateString('pt-BR')
    })()
    : null

  if (success) {
    return (
      <div className="prem-page">
        <Header />
        <main className="prem-main">
          <div className="prem-success">
            <div className="prem-success__icon">{success === 'lifetime' ? '💎' : '⚡'}</div>
            <h2>{success === 'lifetime' ? 'Premium Vitalício ativado!' : 'Premium Mensal ativado!'}</h2>
            <p>Bem-vindo ao clube. Aproveite seus benefícios.</p>
            <button className="prem-success__btn" onClick={() => navigate('/')}>Ir para home</button>
          </div>
        </main>
      </div>
    )
  }

  return (
    <div className="prem-page">
      <Header />
      <main className="prem-main">

        <div className="prem-hero">
          <div className="prem-hero__orb" />
          <h1 className="prem-hero__title">Minere mais.<br />Volte menos.</h1>
          <p className="prem-hero__sub">Colete 24h de tokens com um clique.</p>
          {isPremium && (
            <PremiumBadge
              type={profile.premium_type}
              expiresAt={profile.premium_expires_at}
            />
          )}
        </div>

        {error && <div className="prem-error">{error}</div>}

        {/* Banner já assinante */}
        {isPremium && (
          <div className="prem-already">
            <span className="prem-already__icon">{isLifetime ? '💎' : '⚡'}</span>
            <div>
              <strong>{isLifetime ? 'Você já é Premium Vitalício' : 'Você já é Premium Mensal'}</strong>
              <p>
                {isLifetime
                  ? 'Acesso permanente ativo.'
                  : expiresStr
                    ? `Válido até ${expiresStr}.`
                    : 'Plano ativo.'}
              </p>
            </div>
          </div>
        )}

        <div className="prem-plans">

          {/* ── Mensal ── */}
          <div className="prem-plan">
            <div className="prem-plan__header">
              <span className="prem-plan__tag">MENSAL</span>
              <h3>Premium 30 dias</h3>
              <p>Renove quando quiser. Não acumula.</p>
            </div>
            <div className="prem-plan__prices">

              <div className="prem-price-row">
                <div className="prem-price-row__info">
                  <span className="prem-price-row__label">Pagar em LCKM</span>
                </div>
                <div className="prem-price-row__right">
                  <span className="prem-price-row__amount">
                    {config?.monthly_price_lckm != null ? fmt8(config.monthly_price_lckm) : '…'} LCKM
                  </span>
                  <button className="prem-btn prem-btn--LCKM"
                    onClick={() => payWithLCKM('monthly')}
                    disabled={!!loading || isPremium}
                  >
                    {loading === 'monthly-LCKM'
                      ? <><span className="prem-spinner" /> Queimando…</>
                      : isPremium ? '✓ Ativo' : 'Ativar'}
                  </button>
                </div>
              </div>

              <div className="prem-divider" />

              <div className="prem-price-row">
                <div className="prem-price-row__info">
                  <span className="prem-price-row__label">Pagar em USDT</span>
                  <span className="prem-price-row__note">Via wallet · USDT BSC</span>
                  <span className="prem-price-row__note">Você precisa de ~0.001 BNB para pagar a taxa de rede.</span>

                </div>
                <div className="prem-price-row__right">
                  <span className="prem-price-row__amount">
                    ${config?.monthly_price_usdt != null ? fmt8(config.monthly_price_usdt) : '…'} USDT
                  </span>
                  <button className="prem-btn prem-btn--usdt"
                    onClick={() => payWithUsdc('monthly')}
                    disabled={!!loading || isPremium}
                  >
                    {loading === 'monthly-usdt'
                      ? <><span className="prem-spinner" /> Aguardando tx…</>
                      : isPremium
                        ? '✓ Ativo'
                        : wallet ? 'Pagar USDT' : '🦊 Conectar wallet'}
                  </button>
                </div>
              </div>

            </div>
          </div>

          {/* ── Vitalício ── */}
          <div className="prem-plan prem-plan--lifetime">
            <div className="prem-plan__header">
              <span className="prem-plan__tag prem-plan__tag--gold">VITALÍCIO</span>
              <h3>Premium para sempre</h3>
              <p>{slotsLeft !== null && (
                <strong className={slotsLeft < 100 ? 'prem-slots--urgent' : ''}>
                  {slotsLeft} vagas restantes até o preço dobrar.
                </strong>
              )}</p>
            </div>
            <div className="prem-plan__prices">

              <div className="prem-price-row">
                <div className="prem-price-row__info">
                  <span className="prem-price-row__label">Pagar em LCKM</span>
                </div>
                <div className="prem-price-row__right">
                  <span className="prem-price-row__amount">
                    {config?.lifetime_price_lckm != null ? fmt8(config.lifetime_price_lckm) : '…'} LCKM
                  </span>
                  <button className="prem-btn prem-btn--LCKM"
                    onClick={() => payWithLCKM('lifetime')}
                    disabled={!!loading || isPremium || slotsLeft === 0}
                  >
                    {loading === 'lifetime-LCKM'
                      ? <><span className="prem-spinner" /> Queimando…</>
                      : isPremium ? '✓ Ativo' : slotsLeft === 0 ? 'Esgotado' : 'Ativar'}
                  </button>
                </div>
              </div>

              <div className="prem-divider" />

              <div className="prem-price-row">
                <div className="prem-price-row__info">
                  <span className="prem-price-row__label">Pagar em USDT</span>
                  <span className="prem-price-row__note">Via wallet · USDT BSC</span>
                  <span className="prem-price-row__note">Você precisa de ~0.001 BNB para pagar a taxa de rede.</span>

                </div>
                <div className="prem-price-row__right">
                  <span className="prem-price-row__amount">
                    ${config?.lifetime_price_usdt != null ? fmt8(config.lifetime_price_usdt) : '…'} USDT
                  </span>
                  <button className="prem-btn prem-btn--usdt prem-btn--usdt-gold"
                    onClick={() => payWithUsdc('lifetime')}
                    disabled={!!loading || isPremium || slotsLeft === 0}
                  >
                    {loading === 'lifetime-usdt'
                      ? <><span className="prem-spinner" /> Aguardando tx…</>
                      : isLifetime
                        ? '✓ Ativo'
                        : slotsLeft === 0
                          ? 'Esgotado'
                          : wallet ? 'Pagar USDT' : '🦊 Conectar wallet'}
                  </button>
                </div>
              </div>

            </div>
          </div>

        </div>

        {wallet ? (
          <p className="prem-wallet-info">
            🦊 Conectado: <code>{wallet.slice(0, 6)}…{wallet.slice(-4)}</code>
          </p>
        ) : (
          <button className="prem-connect-btn" onClick={connectWallet}>
            🦊 Conectar MetaMask para pagar com USDT
          </button>
        )}

      </main>
    </div>
  )
}