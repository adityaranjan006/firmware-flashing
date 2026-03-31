import { useState, useEffect, useRef } from 'react'
import { useStore } from '../store'
import { useWebSocket } from '../hooks/useWebSocket'

export default function ProgrammerSetup() {
  const { setStep, setPortMapping, addTerminalLine } = useStore()
  const { send, on } = useWebSocket()

  const [serialPorts, setSerialPorts] = useState([])
  const [stlinkProbes, setStlinkProbes] = useState([])
  const [espPort, setEspPort] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const autoSelectedRef = useRef(false)

  useEffect(() => {
    send('start_port_scan', {})
    const cleanup = on('ports_list', (msg) => {
      const ports = msg.ports || []
      const probes = msg.stlink_probes || []
      setSerialPorts(ports)
      const roleOrder = { STM1: 0, STM2: 1 }
      probes.sort((a, b) => (roleOrder[a.role] ?? 99) - (roleOrder[b.role] ?? 99))
      setStlinkProbes(probes)
      setLoading(false)
      // Auto-select suggested ESP port once — don't override user's manual selection
      if (!autoSelectedRef.current) {
        const suggested = ports.find(p => p.suggested_role === 'esp')
        if (suggested) {
          setEspPort(suggested.device)
          autoSelectedRef.current = true
        }
      }
    })
    return () => {
      send('stop_port_scan', {})
      cleanup()
    }
  }, [])

  const confirm = async () => {
    setSaving(true)
    addTerminalLine(`\x1b[33m$ ESP programmer: ${espPort}\x1b[0m`)
    try {
      await new Promise((resolve, reject) => {
        const cleanup = on('port_mapping_saved', (msg) => {
          cleanup()
          msg.success ? resolve() : reject(new Error('Save failed'))
        })
        send('set_port_mapping', { esp_port: espPort })
        setTimeout(() => { cleanup(); reject(new Error('Timeout')) }, 5000)
      })
      setPortMapping({ esp: espPort, stm: null })
      setStep('firmware_flash')
    } catch (err) {
      addTerminalLine(`\x1b[31m✗ ${err.message}\x1b[0m`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex-1 flex flex-col p-8 overflow-y-auto animate-fade-in">
      {/* Header */}
      <div className="mb-6">
        <div className="font-mono text-xs text-accent-green tracking-widest mb-1">STEP 02</div>
        <div className="font-display text-3xl text-white tracking-wider">PROGRAMMER SETUP</div>
        <p className="text-sm text-surface-3 mt-1 font-body">
          Assign the ESP32 programmer port and verify ST-Link is detected.
        </p>
      </div>

      {/* ── ESP32 Programmer ─────────────────────────────────────────────── */}
      <div className="mb-5">
        <div className="font-mono text-xs text-surface-3 tracking-widest uppercase mb-2">
          ESP32 Programmer — Serial Port
        </div>

        {loading && (
          <div className="space-y-2">
            {[...Array(2)].map((_, i) => (
              <div key={i} className="h-16 bg-surface-2 border border-border rounded-xl animate-pulse" />
            ))}
          </div>
        )}

        {!loading && serialPorts.filter(p => p.device.includes('ttyUSB') || p.device.includes('ttyACM')).length === 0 && (
          <div className="bg-surface-2 border border-border rounded-xl px-4 py-4 text-center">
            <div className="font-mono text-xs text-surface-3">No USB serial ports detected — plug in the ESP programmer.</div>
          </div>
        )}

        <div className="space-y-2">
          {!loading && serialPorts
            .filter(p => p.device.includes('ttyUSB') || p.device.includes('ttyACM'))
            .map(port => {
              const selected = espPort === port.device
              return (
                <button
                  key={port.device}
                  onClick={() => setEspPort(selected ? null : port.device)}
                  className={`w-full flex items-center justify-between px-4 py-3.5 rounded-xl border transition-all text-left ${
                    selected
                      ? 'bg-accent-green/10 border-accent-green/50'
                      : 'bg-surface-2 border-border hover:border-accent-green/20'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center font-mono text-sm shrink-0 ${
                      selected ? 'bg-accent-green/20 text-accent-green' : 'bg-surface-3 text-surface-3'
                    }`}>
                      {selected ? '✓' : '○'}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-sm text-white font-semibold">{port.device}</span>
                        {port.suggested_role === 'esp' && (
                          <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-accent-green/10 text-accent-green uppercase tracking-widest">
                            ESP detected
                          </span>
                        )}
                      </div>
                      <div className="font-body text-xs text-surface-3 truncate">{port.description}</div>
                      {port.manufacturer && (
                        <div className="font-mono text-[10px] text-surface-3">
                          {port.manufacturer}
                          {port.vid && <span className="ml-2 opacity-50">{port.vid}:{port.pid}</span>}
                        </div>
                      )}
                    </div>
                  </div>
                  <span className={`font-mono text-xs shrink-0 ml-4 ${selected ? 'text-accent-green' : 'text-surface-3'}`}>
                    {selected ? 'SELECTED' : 'SELECT'}
                  </span>
                </button>
              )
            })}
        </div>
      </div>

      {/* ── STM ST-Link ──────────────────────────────────────────────────── */}
      <div className="mb-6">
        <div className="font-mono text-xs text-surface-3 tracking-widest uppercase mb-2">
          STM ST-Link — USB HID
        </div>

        {loading ? (
          <div className="h-16 bg-surface-2 border border-border rounded-xl animate-pulse" />
        ) : stlinkProbes.length === 0 ? (
          <div className="flex items-center gap-3 px-4 py-3.5 bg-surface-2 border border-accent-red/20 rounded-xl">
            <div className="w-8 h-8 rounded-lg bg-accent-red/10 flex items-center justify-center text-accent-red shrink-0">✗</div>
            <div>
              <div className="font-mono text-sm text-white">No ST-Link detected</div>
              <div className="font-mono text-xs text-surface-3">Connect the ST-Link programmer and wait.</div>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            {stlinkProbes.map(probe => (
              <div key={probe.serial}
                className="flex items-center gap-3 px-4 py-3.5 bg-accent-amber/5 border border-accent-amber/30 rounded-xl"
              >
                <div className="w-8 h-8 rounded-lg bg-accent-amber/20 flex items-center justify-center text-accent-amber font-mono text-xs font-bold shrink-0">
                  {probe.role ? probe.role.replace('STM', '') : probe.index}
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm text-white font-semibold">
                      {probe.role ?? `ST-Link Probe ${probe.index}`}
                    </span>
                    <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-accent-amber/10 text-accent-amber uppercase tracking-widest">
                      Connected
                    </span>
                  </div>
                  <div className="font-mono text-xs text-surface-3">SN: {probe.serial}</div>
                  <div className="font-mono text-[10px] text-surface-3">FW: {probe.firmware}</div>
                </div>
              </div>
            ))}
          </div>
        )}
        <p className="font-mono text-[10px] text-surface-3 mt-2 pl-1">
          ST-Link is auto-discovered by STM32_Programmer_CLI — no port assignment needed.
        </p>
      </div>

      {/* Confirm */}
      <button
        onClick={confirm}
        disabled={saving || !espPort || stlinkProbes.length < 2}
        className="w-full bg-accent-green text-surface font-semibold py-3 rounded-xl hover:bg-accent-green/90 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
      >
        {saving
          ? <span className="font-mono text-sm animate-pulse">Saving...</span>
          : !espPort
            ? 'Select ESP32 port to continue'
            : stlinkProbes.length === 0
              ? 'No ST-Link detected — cannot proceed'
              : stlinkProbes.length < 2
                ? `Only ${stlinkProbes.length} ST-Link detected — need 2`
                : (() => {
                    const stm1 = stlinkProbes.find(p => p.role === 'STM1')
                    const stm2 = stlinkProbes.find(p => p.role === 'STM2')
                    return (
                      <span className="font-mono text-sm">
                        Confirm — ESP: <span className="opacity-80">{espPort}</span>
                        {' | '}STM1 SN: <span className="opacity-80">{stm1?.serial ?? '—'}</span>
                        {' | '}STM2 SN: <span className="opacity-80">{stm2?.serial ?? '—'}</span>
                        {' →'}
                      </span>
                    )
                  })()}
      </button>

      {!loading && stlinkProbes.length < 2 && (
        <p className="text-center font-mono text-xs text-accent-red mt-2">
          {stlinkProbes.length === 0
            ? 'Connect both ST-Link programmers (STM1 + STM2) and wait'
            : 'Only 1 ST-Link detected — connect both STM1 and STM2 ST-Links'}
        </p>
      )}
    </div>
  )
}
