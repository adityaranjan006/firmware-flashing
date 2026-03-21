import { useStore } from '../store'

export default function Done() {
  const { deviceId, sensorResults, setStep, setAuth } = useStore()
  const passCount = Object.values(sensorResults).filter(r => r === 'pass').length
  const totalCount = Object.values(sensorResults).length

  const handleNewDevice = () => {
    // Reset all state except auth
    useStore.setState({
      currentStep: 'sensors',
      sensorAddresses: { RL: null, RR: null, PL: null, PR: null, HS: null },
      deviceId: null,
      certPath: null,
      flashStatus: { esp: 'idle', stm1: 'idle', stm2: 'idle' },
      terminalLines: [],
      sensorResults: {},
    })
    setStep('sensors')
  }

  return (
    <div className="flex-1 flex flex-col items-center justify-center p-8 animate-fade-in">
      {/* Success icon */}
      <div className="w-20 h-20 rounded-full bg-accent-green/20 border-2 border-accent-green flex items-center justify-center mb-6 shadow-[0_0_40px_rgba(0,255,136,0.2)]">
        <span className="text-accent-green text-4xl">✓</span>
      </div>

      <div className="font-display text-4xl text-white tracking-wider mb-2 text-center">DEVICE READY</div>
      <div className="font-mono text-xs text-accent-green tracking-widest mb-8">CONFIGURATION COMPLETE</div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-4 w-full max-w-sm mb-8">
        <div className="bg-surface-2 border border-border rounded-xl p-4 text-center">
          <div className="font-mono text-2xl text-accent-green font-bold">{passCount}/{totalCount}</div>
          <div className="font-mono text-xs text-surface-3 mt-1 tracking-widest">SENSORS PASSED</div>
        </div>
        <div className="bg-surface-2 border border-border rounded-xl p-4 text-center">
          <div className="font-mono text-lg text-white font-bold truncate">{deviceId || '—'}</div>
          <div className="font-mono text-xs text-surface-3 mt-1 tracking-widest">DEVICE ID</div>
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-3 w-full max-w-sm">
        <button
          onClick={handleNewDevice}
          className="flex-1 bg-accent-green text-surface font-semibold py-3 rounded-xl hover:bg-accent-green/90 transition-all"
        >
          Configure New Device
        </button>
        <button
          onClick={() => { setAuth(null, null); setStep('login') }}
          className="px-6 bg-surface-2 border border-border text-surface-3 font-semibold py-3 rounded-xl hover:border-accent-green/30 hover:text-white transition-all"
        >
          Logout
        </button>
      </div>
    </div>
  )
}
