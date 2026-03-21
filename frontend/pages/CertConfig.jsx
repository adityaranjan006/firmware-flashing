import { useState } from 'react'
import { useStore } from '../store'
import { useApi } from '../hooks/useApi'
import { useWebSocket } from '../hooks/useWebSocket'

const STEPS_LIST = [
  { id: 'fetch_cert',    label: 'Fetch certificate from backend' },
  { id: 'write_config',  label: 'Write config CSV with defaults' },
  { id: 'flash_config',  label: 'Flash config file to ESP' },
]

export default function CertConfig() {
  const { setStep, setDeviceInfo, addTerminalLine, sensorAddresses } = useStore()
  const { fetchCertificate, fetchConfigDefaults } = useApi()
  const { send, on } = useWebSocket()
  const [deviceId, setDeviceId] = useState('')
  const [stepStatus, setStepStatus] = useState({ fetch_cert: 'idle', write_config: 'idle', flash_config: 'idle' })
  const [running, setRunning] = useState(false)
  const [done, setDone] = useState(false)

  const setStatus = (id, status) => setStepStatus(prev => ({ ...prev, [id]: status }))

  const run = async () => {
    if (!deviceId.trim()) return
    setRunning(true)

    try {
      // Step 1 — fetch cert
      setStatus('fetch_cert', 'running')
      addTerminalLine(`\x1b[33m$ Fetching certificate for device ${deviceId}...\x1b[0m`)
      const { cert_path, cert_data } = await fetchCertificate(deviceId)
      const defaults = await fetchConfigDefaults()
      addTerminalLine(`\x1b[32m✓ Certificate received: ${cert_path}\x1b[0m`)
      setStatus('fetch_cert', 'done')
      setDeviceInfo(deviceId, cert_path)

      // Step 2 — write config CSV (via local agent)
      setStatus('write_config', 'running')
      addTerminalLine(`\x1b[33m$ Writing config CSV with cert path + defaults...\x1b[0m`)
      await new Promise((resolve, reject) => {
        const cleanup = on('config_written', (msg) => {
          cleanup()
          msg.success ? resolve() : reject(new Error(msg.error))
        })
        send('write_config', {
          device_id: deviceId,
          cert_path,
          cert_data,
          defaults,
          sensor_addresses: sensorAddresses,
        })
        setTimeout(() => { cleanup(); reject(new Error('Timeout')) }, 15000)
      })
      addTerminalLine(`\x1b[32m✓ config.csv written\x1b[0m`)
      setStatus('write_config', 'done')

      // Step 3 — flash config to ESP (via local agent)
      setStatus('flash_config', 'running')
      addTerminalLine(`\x1b[33m$ Flashing config to ESP...\x1b[0m`)
      await new Promise((resolve, reject) => {
        const cleanup = on('config_flashed', (msg) => {
          cleanup()
          msg.success ? resolve() : reject(new Error(msg.error))
        })
        send('flash_config', {})
        setTimeout(() => { cleanup(); reject(new Error('Flash timeout')) }, 60000)
      })
      addTerminalLine(`\x1b[32m✓ Config flashed to ESP\x1b[0m`)
      setStatus('flash_config', 'done')

      setDone(true)
    } catch (err) {
      addTerminalLine(`\x1b[31m✗ Error: ${err.message}\x1b[0m`)
      // Mark current running step as failed
      Object.keys(stepStatus).forEach(k => {
        if (stepStatus[k] === 'running') setStatus(k, 'error')
      })
    } finally {
      setRunning(false)
    }
  }

  const statusIcon = (s) => {
    if (s === 'idle') return <span className="text-surface-3">○</span>
    if (s === 'running') return <span className="text-accent-amber animate-pulse">◉</span>
    if (s === 'done') return <span className="text-accent-green">✓</span>
    if (s === 'error') return <span className="text-accent-red">✗</span>
  }

  return (
    <div className="flex-1 flex flex-col p-8 overflow-y-auto animate-fade-in">
      <div className="mb-6">
        <div className="font-mono text-xs text-accent-green tracking-widest mb-1">STEP 03</div>
        <div className="font-display text-3xl text-white tracking-wider">CERT & CONFIG</div>
        <p className="text-sm text-surface-3 mt-1 font-body">Fetch device certificate, write config file, and flash it to the ESP.</p>
      </div>

      {/* Device ID input */}
      <div className="mb-6">
        <label className="block font-mono text-xs text-surface-3 tracking-widest mb-1.5 uppercase">Device ID</label>
        <input
          type="text"
          value={deviceId}
          onChange={e => setDeviceId(e.target.value)}
          disabled={running || done}
          className="w-full bg-surface-2 border border-border rounded-lg px-4 py-3 font-mono text-sm text-white placeholder-surface-3 focus:outline-none focus:border-accent-green transition-colors disabled:opacity-50"
          placeholder="e.g. DEV-00142"
        />
      </div>

      {/* Step checklist */}
      <div className="bg-surface-2 border border-border rounded-xl p-4 mb-6 space-y-3">
        {STEPS_LIST.map(step => (
          <div key={step.id} className="flex items-center gap-3">
            <span className="font-mono text-lg w-5 text-center">{statusIcon(stepStatus[step.id])}</span>
            <span className={`font-body text-sm ${stepStatus[step.id] === 'done' ? 'text-accent-green' : stepStatus[step.id] === 'error' ? 'text-accent-red' : 'text-surface-3'}`}>
              {step.label}
            </span>
          </div>
        ))}
      </div>

      {/* Run / Continue */}
      {!done ? (
        <button
          onClick={run}
          disabled={running || !deviceId.trim()}
          className="w-full bg-accent-green text-surface font-semibold py-3 rounded-xl hover:bg-accent-green/90 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
        >
          {running ? <span className="font-mono text-sm animate-pulse">Running...</span> : 'Run →'}
        </button>
      ) : (
        <button
          onClick={() => setStep('flashing')}
          className="w-full bg-accent-green text-surface font-semibold py-3 rounded-xl hover:bg-accent-green/90 transition-all animate-slide-up"
        >
          Continue to Flashing →
        </button>
      )}
    </div>
  )
}
