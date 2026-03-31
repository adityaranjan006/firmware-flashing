import { useStore } from '../store'

const CONFIG_FIELDS = [
  { key: 'DEVID',     label: 'Device ID',      getValue: s => s.deviceId },
  { key: 'SERIALNO',  label: 'Serial No',       getValue: s => s.serialNo },
  { key: 'WIFIAPN',   label: 'WiFi SSID',       getValue: () => 'DreamNet' },
  { key: 'WIFIPASSWD',label: 'WiFi Password',   getValue: () => 'dreamTeam@7' },
  { key: 'MFGNAME',   label: 'Manufacturer',    getValue: () => 'dreamspan' },
  { key: 'MFGDATE',   label: 'Manufacture Date',getValue: s => s.mfgDate },
]

export default function Done() {
  const store = useStore()
  const { setStep, setAuth } = store

  const handleNewDevice = () => {
    useStore.setState({
      currentStep:    'device_select',
      selectedDevice: null,
      portMapping:    { esp: null, stm: null },
      sensorAddresses:{ RL: null, RR: null, PL: null, PR: null, HS: null },
      deviceId:       null,
      certPath:       null,
      serialNo:       '',
      hardVer:        '',
      mfgDate:        '',
      flashStatus:    { esp: 'idle', stm1: 'idle', stm2: 'idle' },
      terminalLines:  [],
      sensorResults:  {},
    })
  }

  return (
    <div className="flex-1 flex flex-col items-center justify-center p-8 animate-fade-in">
      {/* Success icon */}
      <div className="w-20 h-20 rounded-full bg-accent-green/20 border-2 border-accent-green flex items-center justify-center mb-6 shadow-[0_0_40px_rgba(0,255,136,0.2)]">
        <span className="text-accent-green text-4xl">✓</span>
      </div>

      <div className="font-display text-4xl text-white tracking-wider mb-2 text-center">DEVICE READY</div>
      <div className="font-mono text-xs text-accent-green tracking-widest mb-8">CONFIGURATION COMPLETE</div>

      {/* Config summary */}
      <div className="w-full max-w-sm mb-8 bg-surface-2 border border-border rounded-xl overflow-hidden">
        {CONFIG_FIELDS.map(({ key, label, getValue }, i) => {
          const value = getValue(store) || '—'
          return (
            <div
              key={key}
              className={`flex items-center justify-between px-4 py-3 ${i < CONFIG_FIELDS.length - 1 ? 'border-b border-border' : ''}`}
            >
              <span className="font-mono text-xs text-surface-3 tracking-widest uppercase">{label}</span>
              <span className="font-mono text-xs text-white font-semibold truncate ml-4 max-w-[55%] text-right">{value}</span>
            </div>
          )
        })}
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
