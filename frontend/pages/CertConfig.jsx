import { useState } from 'react'
import { useStore } from '../store'
import { useApi } from '../hooks/useApi'
import { useWebSocket } from '../hooks/useWebSocket'

const STEPS_LIST = [
  { id: 'write_master_conf', label: 'Generate master_conf.csv' },
  { id: 'write_config',      label: 'Write NVS config CSV with cert path and defaults' },
  { id: 'flash_config',      label: 'Generate NVS binary from master_conf.csv' },
]

export default function CertConfig() {
  const {
    setStep, addTerminalLine,
    sensorAddresses, selectedDevice, certPath,
    serialNo, setSerialNo, hardVer, setHardVer,
  } = useStore()
  const { fetchConfigDefaults } = useApi()
  const { send, on } = useWebSocket()
  const [stepStatus, setStepStatus] = useState({ write_master_conf: 'idle', write_config: 'idle', flash_config: 'idle' })
  const [running, setRunning] = useState(false)
  const [done, setDone] = useState(false)

  const deviceId = selectedDevice?.device_id
  const canRun = deviceId && serialNo.trim() && hardVer.trim()

  const setStatus = (id, status) => setStepStatus(prev => ({ ...prev, [id]: status }))

  const run = async () => {
    setRunning(true)
    try {
      const defaults = await fetchConfigDefaults()

      // Step 1 — generate master_conf.csv
      setStatus('write_master_conf', 'running')
      addTerminalLine(`\x1b[33m$ Generating master_conf.csv for ${deviceId}...\x1b[0m`)
      await new Promise((resolve, reject) => {
        const cleanup = on('master_conf_written', (msg) => {
          cleanup()
          msg.success ? resolve() : reject(new Error(msg.error))
        })
        send('write_master_conf', {
          device_id:        deviceId,
          serial_no:        serialNo.trim(),
          hard_ver:         hardVer.trim(),
          sensor_addresses: sensorAddresses,
        })
        setTimeout(() => { cleanup(); reject(new Error('Timeout')) }, 15000)
      })
      addTerminalLine('\x1b[32m✓ master_conf.csv written\x1b[0m')
      setStatus('write_master_conf', 'done')

      // Step 2 — write NVS config CSV
      setStatus('write_config', 'running')
      addTerminalLine(`\x1b[33m$ Writing NVS config CSV for ${deviceId}...\x1b[0m`)
      await new Promise((resolve, reject) => {
        const cleanup = on('config_written', (msg) => {
          cleanup()
          msg.success ? resolve() : reject(new Error(msg.error))
        })
        send('write_config', {
          device_id:        deviceId,
          cert_path:        certPath,
          cert_data:        null,
          defaults,
          sensor_addresses: sensorAddresses,
        })
        setTimeout(() => { cleanup(); reject(new Error('Timeout')) }, 15000)
      })
      addTerminalLine('\x1b[32m✓ config.csv written\x1b[0m')
      setStatus('write_config', 'done')

      // Step 3 — flash config to ESP
      setStatus('flash_config', 'running')
      addTerminalLine('\x1b[33m$ Flashing config to ESP...\x1b[0m')
      await new Promise((resolve, reject) => {
        const cleanup = on('config_flashed', (msg) => {
          cleanup()
          msg.success ? resolve() : reject(new Error(msg.error))
        })
        send('flash_config', { device_id: deviceId })
        setTimeout(() => { cleanup(); reject(new Error('Flash timeout')) }, 60000)
      })
      addTerminalLine('\x1b[32m✓ Config flashed to ESP\x1b[0m')
      setStatus('flash_config', 'done')

      setDone(true)
    } catch (err) {
      addTerminalLine(`\x1b[31m✗ Error: ${err.message}\x1b[0m`)
      setStepStatus(prev => {
        const updated = { ...prev }
        Object.keys(updated).forEach(k => { if (updated[k] === 'running') updated[k] = 'error' })
        return updated
      })
    } finally {
      setRunning(false)
    }
  }

  const statusIcon = (s) => {
    if (s === 'idle')    return <span className="text-surface-3">○</span>
    if (s === 'running') return <span className="text-accent-amber animate-pulse">◉</span>
    if (s === 'done')    return <span className="text-accent-green">✓</span>
    if (s === 'error')   return <span className="text-red-400">✗</span>
  }

  return (
    <div className="flex-1 flex flex-col p-8 overflow-y-auto animate-fade-in">
      <div className="mb-6">
        <div className="font-mono text-xs text-accent-green tracking-widest mb-1">STEP 03</div>
        <div className="font-display text-3xl text-white tracking-wider">CERT &amp; CONFIG</div>
        <p className="text-sm text-surface-3 mt-1 font-body">Enter device details, generate config files, then flash to ESP.</p>
      </div>

      {/* Device banner */}
      <div className="mb-6 flex items-center gap-3 bg-surface-2 border border-border rounded-xl px-4 py-3">
        <span className="text-accent-green font-mono text-sm">◆</span>
        <div>
          <div className="font-mono text-xs text-surface-3 tracking-widest uppercase">Device</div>
          <div className="font-mono text-sm text-white">{deviceId || '—'}</div>
        </div>
        {certPath && (
          <>
            <div className="h-8 w-px bg-border mx-1" />
            <div className="min-w-0">
              <div className="font-mono text-xs text-surface-3 tracking-widest uppercase">Cert path</div>
              <div className="font-mono text-xs text-accent-green truncate max-w-xs">{certPath}</div>
            </div>
          </>
        )}
      </div>

      {/* Serial No + Hardware Version inputs */}
      <div className="grid grid-cols-2 gap-4 mb-6">
        <div>
          <label className="block font-mono text-xs text-surface-3 tracking-widest uppercase mb-1.5">
            Serial Number <span className="text-red-400">*</span>
          </label>
          <input
            type="text"
            value={serialNo}
            onChange={e => setSerialNo(e.target.value)}
            disabled={running}
            placeholder="e.g. SN202500001"
            className="w-full bg-surface-2 border border-border rounded-lg px-3 py-2 font-mono text-sm text-white placeholder-surface-3 focus:outline-none focus:border-accent-green disabled:opacity-50"
          />
        </div>
        <div>
          <label className="block font-mono text-xs text-surface-3 tracking-widest uppercase mb-1.5">
            Hardware Version <span className="text-red-400">*</span>
          </label>
          <input
            type="text"
            value={hardVer}
            onChange={e => setHardVer(e.target.value)}
            disabled={running}
            placeholder="e.g. 2.0.0"
            className="w-full bg-surface-2 border border-border rounded-lg px-3 py-2 font-mono text-sm text-white placeholder-surface-3 focus:outline-none focus:border-accent-green disabled:opacity-50"
          />
        </div>
      </div>

      {/* Step checklist */}
      <div className="bg-surface-2 border border-border rounded-xl p-4 mb-6 space-y-3">
        {STEPS_LIST.map(step => (
          <div key={step.id} className="flex items-center gap-3">
            <span className="font-mono text-lg w-5 text-center">{statusIcon(stepStatus[step.id])}</span>
            <span className={`font-body text-sm ${
              stepStatus[step.id] === 'done'    ? 'text-accent-green' :
              stepStatus[step.id] === 'error'   ? 'text-red-400'     :
              stepStatus[step.id] === 'running' ? 'text-white'       : 'text-surface-3'
            }`}>
              {step.label}
            </span>
          </div>
        ))}
      </div>

      {!done ? (
        <button
          onClick={run}
          disabled={running || !canRun}
          className="w-full bg-accent-green text-surface font-semibold py-3 rounded-xl hover:bg-accent-green/90 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
        >
          {running
            ? <span className="font-mono text-sm animate-pulse">Running...</span>
            : !canRun
              ? 'Enter Serial No & Hardware Version to continue'
              : 'Run →'}
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
