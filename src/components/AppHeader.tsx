import { Link } from 'react-router-dom'
import { useAuth } from '../state/useAuth.ts'
import { useRoom } from '../state/useRoom.ts'
import { Logo } from './Logo.tsx'

/**
 * Global bar shown on every page: the brand, which transport the rooms run on,
 * and which identity this device is using. No props — it reads both the room and
 * auth context, so it never drifts from the real state.
 */
export function AppHeader() {
  const { authProviderLabel, profile } = useAuth()
  const { adapterLabel, adapterDegraded, transportReady } = useRoom()

  return (
    <header className="app-header" data-testid="app-header">
      <Link to="/" className="brand">
        <Logo size={34} />
        <span className="brand__text">
          <strong>Filipino Videoke</strong>
          <small>Live videoke rooms · sing together</small>
        </span>
      </Link>

      <div className="app-header__meta">
        <span
          className={`chip chip--transport${adapterDegraded ? ' chip--warn' : ''}`}
          title="Where room state is shared"
        >
          {transportReady ? adapterLabel : 'starting…'}
        </span>
        <span className="chip chip--identity" title="Identity on this device">
          {profile?.name ? `${profile.name} · ` : ''}
          {authProviderLabel}
        </span>
      </div>
    </header>
  )
}
