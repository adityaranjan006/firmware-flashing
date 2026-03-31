import { useState, useEffect } from 'react'
import { useStore } from '../store'
import { useApi } from '../hooks/useApi'
import { useWebSocket } from '../hooks/useWebSocket'

const STATUS_COLOR = {
  active:      'text-accent-green',
  inactive:    'text-surface-3',
  maintenance: 'text-accent-amber',
  error:       'text-accent-red',
}

const PROVISIONING_COLOR = {
  provisioned:   'text-accent-green',
  unprovisioned: 'text-accent-amber',
  pending:       'text-accent-amber',
  failed:        'text-accent-red',
}

export default function DeviceSelect() {
  const { setStep, setSelectedDevice, setDeviceInfo, token, addTerminalLine } = useStore()
  const { fetchDevices } = useApi()
  const { send, on } = useWebSocket()

  const [devices, setDevices] = useState([])
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState(null)
  const [downloading, setDownloading] = useState(false)
  const [activeId, setActiveId] = useState(null)

  const loadDevices = () => {
    setLoading(true)
    setFetchError(null)
    fetchDevices()
      .then(data => setDevices(data.devices || []))
      .catch(err => setFetchError(err.response?.data?.message || err.message))
      .finally(() => setLoading(false))
  }

  useEffect(() => { loadDevices() }, [])

  const handleSelect = async (device) => {
    if (device.is_flashed || downloading) return
    setActiveId(device.device_id)
    setDownloading(true)
    addTerminalLine(`\x1b[33m$ Selected device: ${device.device_id} — downloading certificate...\x1b[0m`)

    try {
      const result = await new Promise((resolve, reject) => {
        const cleanup = on('certificate_downloaded', (msg) => {
          cleanup()
          msg.success ? resolve(msg) : reject(new Error(msg.error))
        })
        send('download_certificate', { device_id: device.device_id, token })
        setTimeout(() => { cleanup(); reject(new Error('Certificate download timed out')) }, 30000)
      })

      setSelectedDevice(device)
      setDeviceInfo(device.device_id, result.cert_path)
      addTerminalLine(`\x1b[32m✓ Certificate ready — proceeding to programmer setup\x1b[0m`)
      setStep('programmer_setup')
    } catch (err) {
      setActiveId(null)
      addTerminalLine(`\x1b[31m✗ ${err.message}\x1b[0m`)
    } finally {
      setDownloading(false)
    }
  }

  const sort = arr => [...arr].sort((a, b) => a.device_id.localeCompare(b.device_id))
  const unflashed = sort(devices.filter(d => !d.is_flashed))
  const flashed   = sort(devices.filter(d =>  d.is_flashed))

  return (
    <div className="flex-1 flex flex-col p-8 overflow-y-auto animate-fade-in">
      {/* Header */}
      <div className="mb-6 flex items-start justify-between">
        <div>
          <div className="font-mono text-xs text-accent-green tracking-widest mb-1">STEP 01</div>
          <div className="font-display text-3xl text-white tracking-wider">SELECT DEVICE</div>
          <p className="text-sm text-surface-3 mt-1 font-body">
            Choose an unflashed device. Its certificate will be downloaded automatically.
          </p>
        </div>
        <button
          onClick={loadDevices}
          disabled={loading || downloading}
          className="px-4 py-2 bg-surface-2 border border-border rounded-lg font-mono text-xs text-surface-3 hover:text-white hover:border-accent-green/30 transition-all disabled:opacity-40"
        >
          {loading ? 'Loading...' : '↻ Refresh'}
        </button>
      </div>

      {/* Error */}
      {fetchError && (
        <div className="mb-5 bg-accent-red/10 border border-accent-red/30 rounded-xl px-4 py-3">
          <span className="font-mono text-xs text-accent-red">Failed to load devices: {fetchError}</span>
        </div>
      )}

      {/* Loading skeleton */}
      {loading && (
        <div className="space-y-2">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-16 bg-surface-2 border border-border rounded-xl animate-pulse" />
          ))}
        </div>
      )}

      {/* Unflashed devices */}
      {!loading && unflashed.length > 0 && (
        <div className="mb-6">
          <div className="font-mono text-xs text-surface-3 tracking-widest uppercase mb-2">
            Ready to Flash ({unflashed.length})
          </div>
          <div className="space-y-2">
            {unflashed.map(device => {
              const isActive = activeId === device.device_id
              return (
                <button
                  key={device.device_id}
                  onClick={() => handleSelect(device)}
                  disabled={downloading}
                  className={`
                    w-full flex items-center justify-between px-5 py-4 rounded-xl border
                    transition-all duration-200 text-left
                    ${isActive
                      ? 'bg-accent-green/10 border-accent-green/60 shadow-[0_0_16px_rgba(0,255,136,0.08)]'
                      : 'bg-surface-2 border-border hover:border-accent-green/30 hover:bg-accent-green/5'
                    }
                    disabled:cursor-not-allowed disabled:opacity-60
                  `}
                >
                  {/* Left: identity */}
                  <div className="flex items-center gap-4 min-w-0">
                    <div className={`
                      w-9 h-9 rounded-lg flex items-center justify-center font-mono text-xs font-bold shrink-0
                      ${isActive ? 'bg-accent-green/20 text-accent-green' : 'bg-surface-3 text-white'}
                    `}>
                      {isActive ? (
                        <span className="animate-pulse">↓</span>
                      ) : '○'}
                    </div>
                    <div className="min-w-0">
                      <div className="font-mono text-sm text-white font-semibold">{device.device_id}</div>
                      <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                        {device.provisioning_status && (
                          <span className={`font-mono text-[10px] uppercase tracking-widest ${PROVISIONING_COLOR[device.provisioning_status] || 'text-surface-3'}`}>
                            {device.provisioning_status}
                          </span>
                        )}
                        {device.firmware_version && (
                          <span className="font-mono text-[10px] text-surface-3">fw {device.firmware_version}</span>
                        )}
                        {device.hardware_revision && (
                          <span className="font-mono text-[10px] text-surface-3">hw {device.hardware_revision}</span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Right: status + action */}
                  <div className="flex items-center gap-4 shrink-0 ml-4">
                    {device.status && (
                      <span className={`font-mono text-xs uppercase tracking-widest ${STATUS_COLOR[device.status] || 'text-surface-3'}`}>
                        {device.status}
                      </span>
                    )}
                    {isActive ? (
                      <span className="font-mono text-xs text-accent-amber animate-pulse px-3 py-1.5 bg-accent-amber/10 border border-accent-amber/30 rounded-lg">
                        Downloading...
                      </span>
                    ) : (
                      <span className="font-mono text-xs text-accent-green px-3 py-1.5 bg-accent-green/10 border border-accent-green/20 rounded-lg">
                        Select →
                      </span>
                    )}
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Flashed devices (dimmed, not selectable) */}
      {!loading && flashed.length > 0 && (
        <div>
          <div className="font-mono text-xs text-surface-3 tracking-widest uppercase mb-2">
            Already Flashed ({flashed.length})
          </div>
          <div className="space-y-2 opacity-40">
            {flashed.map(device => (
              <div
                key={device.device_id}
                className="flex items-center justify-between px-5 py-4 rounded-xl border border-border bg-surface-2 cursor-not-allowed"
              >
                <div className="flex items-center gap-4 min-w-0">
                  <div className="w-9 h-9 rounded-lg bg-accent-green/20 flex items-center justify-center font-mono text-xs text-accent-green shrink-0">✓</div>
                  <div className="min-w-0">
                    <div className="font-mono text-sm text-white font-semibold">{device.device_id}</div>
                    <div className="flex items-center gap-3 mt-0.5">
                      {device.firmware_version && (
                        <span className="font-mono text-[10px] text-surface-3">fw {device.firmware_version}</span>
                      )}
                      {device.hardware_revision && (
                        <span className="font-mono text-[10px] text-surface-3">hw {device.hardware_revision}</span>
                      )}
                    </div>
                  </div>
                </div>
                <span className="font-mono text-xs text-accent-green shrink-0">FLASHED</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Empty state */}
      {!loading && devices.length === 0 && !fetchError && (
        <div className="flex-1 flex flex-col items-center justify-center text-center py-16">
          <div className="font-mono text-4xl text-surface-3 mb-3">○</div>
          <div className="font-body text-surface-3 text-sm">No devices found in the database.</div>
          <button onClick={loadDevices} className="mt-4 font-mono text-xs text-accent-green hover:underline">
            Refresh
          </button>
        </div>
      )}

      {!loading && unflashed.length === 0 && flashed.length > 0 && (
        <div className="mt-4 bg-accent-amber/10 border border-accent-amber/20 rounded-xl px-4 py-3">
          <span className="font-mono text-xs text-accent-amber">All registered devices have already been flashed.</span>
        </div>
      )}
    </div>
  )
}
