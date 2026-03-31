import { useState } from 'react'
import { useStore } from '../store'
import { useWebSocket } from '../hooks/useWebSocket'
import { useApi } from '../hooks/useApi'

export default function Flashing() {
  const { setStep, addTerminalLine, selectedDevice, serialNo, hardVer, setMfgDate } = useStore()
  const { send, on } = useWebSocket()
  const { registerDevice } = useApi()
  const [status, setStatus] = useState('idle') // idle | running | done | error
  const [error, setError] = useState(null)

  const deviceId = selectedDevice?.device_id

  const flashNvs = () => {
    setStatus('running')
    setError(null)
    addTerminalLine(`\x1b[33m$ Flashing NVS binary for ${deviceId}...\x1b[0m`)

    const cleanup = on('flash_nvs_done', async (msg) => {
      cleanup()
      if (msg.success) {
        const today = new Date()
        const mfgDate = `${String(today.getMonth() + 1).padStart(2, '0')}/${String(today.getDate()).padStart(2, '0')}/${today.getFullYear()}`
        setMfgDate(mfgDate)
        try {
          await registerDevice({ device_id: deviceId, serial_no: serialNo, hard_ver: hardVer })
          addTerminalLine(`\x1b[32m✓ Device ${deviceId} saved to factory database\x1b[0m`)
        } catch (err) {
          addTerminalLine(`\x1b[33m⚠ NVS flashed but failed to register device: ${err.message}\x1b[0m`)
        }
        setStatus('done')
      } else {
        setStatus('error')
        setError(msg.error)
        addTerminalLine(`\x1b[31m✗ NVS flash failed: ${msg.error}\x1b[0m`)
      }
    })

    send('flash_nvs', { device_id: deviceId })

    setTimeout(() => {
      cleanup()
      if (status === 'running') {
        setStatus('error')
        setError('Flash timed out')
        addTerminalLine('\x1b[31m✗ NVS flash timed out\x1b[0m')
      }
    }, 60000)
  }

  return (
    <div className="flex-1 flex flex-col p-8 overflow-y-auto animate-fade-in">
      <div className="mb-8">
        <div className="font-mono text-xs text-accent-green tracking-widest mb-1">STEP 06</div>
        <div className="font-display text-3xl text-white tracking-wider">FLASH NVS</div>
        <p className="text-sm text-surface-3 mt-1 font-body">
          Flash the generated NVS binary to the ESP at partition address 0x9000.
        </p>
      </div>

      {/* Status card */}
      <div className={`
        rounded-xl border p-6 mb-6 flex items-center gap-5 transition-all duration-300
        ${status === 'idle'    ? 'bg-surface-2 border-border' : ''}
        ${status === 'running' ? 'bg-accent-amber/5 border-accent-amber/40' : ''}
        ${status === 'done'    ? 'bg-accent-green/5 border-accent-green/40' : ''}
        ${status === 'error'   ? 'bg-red-500/5 border-red-500/40' : ''}
      `}>
        <div className={`
          w-12 h-12 rounded-xl flex items-center justify-center font-mono font-bold text-sm shrink-0
          ${status === 'idle'    ? 'bg-surface-3 text-surface-3' : ''}
          ${status === 'running' ? 'bg-accent-amber/20 text-accent-amber' : ''}
          ${status === 'done'    ? 'bg-accent-green/20 text-accent-green' : ''}
          ${status === 'error'   ? 'bg-red-500/20 text-red-400' : ''}
        `}>
          {status === 'idle'    && 'NVS'}
          {status === 'running' && <div className="w-5 h-5 border-2 border-accent-amber border-t-transparent rounded-full animate-spin" />}
          {status === 'done'    && '✓'}
          {status === 'error'   && '✗'}
        </div>

        <div className="flex-1 min-w-0">
          <div className="font-mono text-sm text-white font-semibold">NVS Partition Binary</div>
          <div className="font-mono text-xs text-surface-3 mt-0.5">
            {deviceId ? `bin/${deviceId}.bin → 0x9000` : '—'}
          </div>
          {status === 'error' && error && (
            <div className="font-mono text-xs text-red-400 mt-1">{error}</div>
          )}
        </div>

        <div className={`
          font-mono text-xs tracking-widest uppercase px-3 py-1 rounded-lg border
          ${status === 'idle'    ? 'text-surface-3 border-border' : ''}
          ${status === 'running' ? 'text-accent-amber border-accent-amber/30 animate-pulse' : ''}
          ${status === 'done'    ? 'text-accent-green border-accent-green/30' : ''}
          ${status === 'error'   ? 'text-red-400 border-red-500/30' : ''}
        `}>
          {status}
        </div>
      </div>

      <div className="flex gap-3 mt-auto">
        <button
          onClick={() => setStep('certconfig')}
          disabled={status === 'running'}
          className="px-6 bg-surface-2 border border-border text-surface-3 font-semibold py-3 rounded-xl hover:border-accent-green/30 hover:text-white transition-all disabled:opacity-30 disabled:cursor-not-allowed"
        >
          ← Back
        </button>

        {status !== 'done' ? (
          <button
            onClick={flashNvs}
            disabled={status === 'running' || !deviceId}
            className="flex-1 bg-accent-green text-surface font-semibold py-3 rounded-xl hover:bg-accent-green/90 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
          >
            {status === 'running'
              ? <span className="font-mono text-sm animate-pulse">Flashing...</span>
              : status === 'error' ? 'Retry Flash →' : 'Flash NVS →'}
          </button>
        ) : (
          <button
            onClick={() => setStep('done')}
            className="flex-1 bg-accent-green text-surface font-semibold py-3 rounded-xl hover:bg-accent-green/90 transition-all animate-slide-up"
          >
            Continue to Sensor Testing →
          </button>
        )}
      </div>
    </div>
  )
}
