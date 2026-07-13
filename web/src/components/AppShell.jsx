import { NavLink } from 'react-router-dom'

const NAV = [
  { to: '/', label: 'Dashboard', end: true },
  // { to: '/orders', label: 'Orders' },   // hidden for now (route still works via direct URL)
  { to: '/clients', label: 'Clients' },
  { to: '/strategies', label: 'Strategies' },
  { to: '/history', label: 'History' },
  { to: '/broker', label: 'Broker' },
  { to: '/admin', label: 'Admin' },
]

export default function AppShell({ children }) {
  return (
    <>
      <header className="appbar"><div className="in">
        <div className="brand"><span className="brand-logo"><img src="/logo.png" alt="Young Turtle" /></span></div>
        <nav className="inav">
          {NAV.map(n => (
            <NavLink key={n.to} to={n.to} end={n.end}
              className={({ isActive }) => (isActive ? 'on' : undefined)}>
              {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="rt"><div className="gl">⌕ Search client</div><div className="av">YT</div></div>
      </div></header>
      {children}
    </>
  )
}
