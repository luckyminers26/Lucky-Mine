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
    if (!window.ethereum) { setError('MetaMask not found'); return }
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
        setError('Switch to BSC network')
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
          insufficient_balance: `Insufficient balance.`,
          already_lifetime: 'You already have lifetime premium.',
          already_active: 'You already have monthly sub.',
          lifetime_slots_full: 'No vacancy :D',
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
    if (!config) { setError('Config not loaded yet, please wait.'); return }

    const price = plan === 'monthly'
      ? config.monthly_price_usdt
      : config.lifetime_price_usdt

    if (price == null) {
      setError('Price not found in database.')
      return
    }

    setLoading(`${plan}-usdt`)
    try {
      const usdt = new ethers.Contract(USDT_ADDRESS, USDT_ABI, signer)
      const decimals = await usdt.decimals()
      const amount = ethers.parseUnits(String(price), decimals)
      const to = config.receive_wallet || RECEIVE_WALLET
      if (!to) { setError('Receiving wallet not configured in database.'); return }

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
            <h2>{success === 'lifetime' ? 'Lifetime Premium activated!!' : 'Monthly Premium activated!'}</h2>
            <p>Welcome to the club. Enjoy your benefits.</p>
            <button className="prem-success__btn" onClick={() => navigate('/')}>to Home</button>
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
          <h1 className="prem-hero__title">Mining more.<br />Come back less.</h1>
          <p className="prem-hero__sub">Collect 24h of tokens with one click.</p>
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
              <strong>{isLifetime ? 'You already have Lifetime Premium' : 'You already have Monthly Premium'}</strong>
              <p>
                {isLifetime
                  ? 'Permanent access active.'
                  : expiresStr
                    ? `Valid until ${expiresStr}.`
                    : 'Plan active.'}
              </p>
            </div>
          </div>
        )}

        <div className="prem-plans">

          {/* ── Mensal ── */}
          <div className="prem-plan">
            <div className="prem-plan__header">
              <span className="prem-plan__tag">Monthly</span>
              <h3>Premium 30 days</h3>
              <p>Renew anytime. Does not stack.</p>
            </div>
            <div className="prem-plan__prices">

              <div className="prem-price-row">
                <div className="prem-price-row__info">
                  <span className="prem-price-row__label">Pay with LCKM</span>
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
                      ? <><span className="prem-spinner" /> Burning...</>
                      : isPremium ? '✓ Ativo' : 'Ativar'}
                  </button>
                </div>
              </div>

              <div className="prem-divider" />

              <div className="prem-price-row">
                <div className="prem-price-row__info">
                  <span className="prem-price-row__label">Pay with USDT</span>
                  <span className="prem-price-row__note"> Wallet · USDT BSC</span>
                  <span className="prem-price-row__note">You need ~0.001 BNB to pay network fees.</span>

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
                      ? <><span className="prem-spinner" /> Waiting for tx…</>
                      : isPremium
                        ? '✓ Active'
                        : wallet ? 'Pay with USDT' : '🦊 Connect wallet'}
                  </button>
                </div>
              </div>

            </div>
          </div>

          {/* ── Vitalício ── */}
          <div className="prem-plan prem-plan--lifetime">
            <div className="prem-plan__header">
              <span className="prem-plan__tag prem-plan__tag--gold">LIFETIME</span>
              <h3>Premium for ever</h3>
              <p>{slotsLeft !== null && (
                <strong className={slotsLeft < 100 ? 'prem-slots--urgent' : ''}>
                  {slotsLeft} slots remaining before price doubles.
                </strong>
              )}</p>
            </div>
            <div className="prem-plan__prices">

              <div className="prem-price-row">
                <div className="prem-price-row__info">
                  <span className="prem-price-row__label">Pay with LCKM</span>
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
                      ? <><span className="prem-spinner" /> Burning...</>
                      : isPremium ? '✓ Active' : slotsLeft === 0 ? 'Sold out' : 'Activate'}
                  </button>
                </div>
              </div>

              <div className="prem-divider" />

              <div className="prem-price-row">
                <div className="prem-price-row__info">
                  <span className="prem-price-row__label">Pay with USDT</span>
                  <span className="prem-price-row__note"> Wallet · USDT BSC</span>
                  <span className="prem-price-row__note">You need ~0.001 BNB to pay network fees.</span>

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
                      ? <><span className="prem-spinner" /> Waiting for tx…</>
                      : isLifetime
                        ? '✓ Active'
                        : slotsLeft === 0
                          ? 'Sold out'
                          : wallet ? 'Pay with USDT' : '🦊 Connect wallet'}
                  </button>
                </div>
              </div>

            </div>
          </div>

        </div>

        {wallet ? (
          <p className="prem-wallet-info">
            🦊 Connected: <code>{wallet.slice(0, 6)}…{wallet.slice(-4)}</code>
          </p>
        ) : (
          <button className="prem-connect-btn" onClick={connectWallet}>
            🦊 Connect MetaMask to pay with USDT
          </button>
        )}

      </main>
    </div>
  )
}