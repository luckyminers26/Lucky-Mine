import { useState, useRef, useEffect } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { Eye, EyeOff } from "lucide-react"
import './Header.css'
import logo from '../assets/luckymine.png';

export default function Header() {
  const { profile, signOut, showBalance, setShowBalance } = useAuth()
  const [open, setOpen] = useState(false)
  const menuRef = useRef(null)
  const navigate = useNavigate()

  useEffect(() => {
    const handle = (e) => { if (menuRef.current && !menuRef.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [])

  async function handleSignOut() {
    setOpen(false)
    await signOut()
    navigate('/login')
  }

  return (
    <header className="header">
      <Link to="/" className="header__logo" aria-label="Home">
      <img className='' src={logo} alt="Logo" width="40" />
      </Link>
      {profile && (
        <span className="header__logo-balance">

          {showBalance
            ? Number(profile.balance ?? 0).toLocaleString("en-US", {
              minimumFractionDigits: 4,
              maximumFractionDigits: 4
            })
            : "••••••••••"
          }

          <button
            className="header__eye"
            onClick={() => setShowBalance(!showBalance)}>
            {showBalance ? <Eye size={16} color='white' /> : <EyeOff size={16} color='white' />}
          </button>
        </span>
      )}


      <div className="header__right" ref={menuRef}>
        {profile?.is_premium && <span className="header__premium-badge">💎 Premium</span>}

        <button
          className={`header__hamburger ${open ? 'header__hamburger--open' : ''}`}
          onClick={() => setOpen(o => !o)}
          aria-label="Menu"
        >
          <span /><span /><span />
        </button>

        {open && (
          <div className="header__menu">
            {profile && (
              <div className="header__menu-user">
                <span className="header__menu-name">{profile.display_name}</span>
              </div>
            )}

            <div className="header__menu-divider" />

            <Link to="/lottery" className="header__menu-item" onClick={() => setOpen(false)}>
              <span>🎲</span> Lotto
            </Link>

            <Link to="/stats" className="header__menu-item" onClick={() => setOpen(false)}>
              <span>📊</span> Supply & Stats
            </Link>

            <Link to="/referral" className="header__menu-item" onClick={() => setOpen(false)}>
              <span>🔗</span> Referrals
            </Link>

            <Link to="/premium" className="header__menu-item" onClick={() => setOpen(false)}>
              <span>💎</span> Premium
            </Link>

            <Link to="/betting" className="header__menu-item" onClick={() => setOpen(false)}>
              <span>☘️</span> Betting
            </Link>

            <div className="header__menu-divider" />

            <button className="header__menu-item header__menu-item--logout" onClick={handleSignOut}>
              <span>→</span> Logout
            </button>
          </div>
        )}
      </div>
    </header>
  )
}