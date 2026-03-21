import { useState } from 'react'
import { useApi } from '../hooks/useApi'
import { useStore } from '../store'

export default function Login() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const { login } = useApi()
  const { setStep } = useStore()

  const handleLogin = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      await login(username, password)
      setStep('sensors')
    } catch (err) {
      setError(err.response?.data?.message || 'Invalid credentials')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex-1 flex items-center justify-center animate-fade-in">
      <div className="w-full max-w-sm">
        {/* Header */}
        <div className="mb-8">
          <div className="font-display text-4xl text-white tracking-wider mb-1">SIGN IN</div>
          <div className="font-mono text-xs text-surface-3 tracking-widest">AUTHENTICATE TO CONTINUE</div>
        </div>

        {/* Form */}
        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label className="block font-mono text-xs text-surface-3 tracking-widest mb-1.5 uppercase">Username</label>
            <input
              type="text"
              value={username}
              onChange={e => setUsername(e.target.value)}
              className="w-full bg-surface-2 border border-border rounded-lg px-4 py-3 font-mono text-sm text-white placeholder-surface-3 focus:outline-none focus:border-accent-green transition-colors"
              placeholder="technician"
              required
              autoFocus
            />
          </div>

          <div>
            <label className="block font-mono text-xs text-surface-3 tracking-widest mb-1.5 uppercase">Password</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="w-full bg-surface-2 border border-border rounded-lg px-4 py-3 font-mono text-sm text-white placeholder-surface-3 focus:outline-none focus:border-accent-green transition-colors"
              placeholder="••••••••"
              required
            />
          </div>

          {error && (
            <div className="bg-accent-red/10 border border-accent-red/30 rounded-lg px-4 py-2.5">
              <span className="font-mono text-xs text-accent-red">{error}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-accent-green text-surface font-body font-semibold py-3 rounded-lg hover:bg-accent-green/90 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed mt-2"
          >
            {loading ? (
              <span className="font-mono text-sm">Authenticating...</span>
            ) : (
              <span className="tracking-wide">Continue →</span>
            )}
          </button>
        </form>
      </div>
    </div>
  )
}
