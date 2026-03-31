import { useStore } from '../store'

const STEPS = [
  { id: 'device_select',    label: 'Select Device',    icon: '01' },
  { id: 'programmer_setup', label: 'Programmer Setup', icon: '02' },
  { id: 'firmware_flash',   label: 'Flash Firmware',   icon: '03' },
  { id: 'sensors',          label: 'Sensor Config',    icon: '04' },
  { id: 'certconfig',       label: 'Cert & Config',    icon: '05' },
  { id: 'flashing',         label: 'Re-Flash',         icon: '06' },
  { id: 'done',             label: 'Complete',         icon: '07' },
]

const STEP_ORDER = STEPS.map(s => s.id)

function getStepState(stepId, currentStep) {
  const currentIdx = STEP_ORDER.indexOf(currentStep)
  const stepIdx = STEP_ORDER.indexOf(stepId)
  if (stepIdx < currentIdx) return 'done'
  if (stepIdx === currentIdx) return 'active'
  return 'pending'
}

export default function StepSidebar() {
  const { currentStep, agentConnected, connectedPort, user, logout, setStep } = useStore()

  const handleLogout = () => {
    logout()
    setStep('login')
  }

  return (
    <aside className="w-56 bg-surface-1 border-r border-border flex flex-col shrink-0">
      {/* Logo */}
      <div className="px-5 py-5 border-b border-border">
        <div className="font-display text-2xl text-accent-green tracking-wider">DEVCONFIG</div>
        <div className="font-mono text-xs text-surface-3 mt-0.5 tracking-widest">TOOL v1.0</div>
      </div>

      {/* Steps */}
      <nav className="flex-1 py-4 px-3">
        {STEPS.map((step, idx) => {
          const state = getStepState(step.id, currentStep)
          return (
            <div key={step.id}>
              <div className={`
                flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-200
                ${state === 'active' ? 'bg-surface-2 border border-accent-green/20' : ''}
                ${state === 'done' ? 'opacity-60' : ''}
                ${state === 'pending' ? 'opacity-30' : ''}
              `}>
                {/* Step number / check */}
                <div className={`
                  w-7 h-7 rounded-md flex items-center justify-center font-mono text-xs shrink-0 font-bold
                  ${state === 'active' ? 'bg-accent-green text-surface text-[10px]' : ''}
                  ${state === 'done' ? 'bg-accent-green/20 text-accent-green text-[10px]' : ''}
                  ${state === 'pending' ? 'bg-surface-3 text-surface-3' : ''}
                `}>
                  {state === 'done' ? '✓' : step.icon}
                </div>
                <span className={`
                  text-sm font-body font-medium
                  ${state === 'active' ? 'text-white' : 'text-surface-3'}
                `}>
                  {step.label}
                </span>
              </div>
              {idx < STEPS.length - 1 && (
                <div className="step-connector ml-6" />
              )}
            </div>
          )
        })}
      </nav>

      {/* Agent + Port status */}
      <div className="px-4 py-3 border-t border-border space-y-2">
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full shrink-0 ${agentConnected ? 'bg-accent-green status-dot-active' : 'bg-accent-red'}`} />
          <span className="font-mono text-xs text-surface-3">
            {agentConnected ? 'Agent Online' : 'Agent Offline'}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full shrink-0 ${connectedPort ? 'bg-accent-green status-dot-active' : 'bg-surface-3'}`} />
          <span className="font-mono text-xs text-surface-3 truncate">
            {connectedPort ?? 'No device'}
          </span>
        </div>
      </div>

      {/* User + Logout */}
      <div className="px-4 py-3 border-t border-border">
        {user && (
          <div className="font-mono text-[10px] text-surface-3 mb-2 truncate">{user.username}</div>
        )}
        <button
          onClick={handleLogout}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-lg bg-surface-2 border border-border hover:border-accent-red/40 hover:text-accent-red text-surface-3 transition-all duration-200"
        >
          <span className="font-mono text-xs">⎋</span>
          <span className="font-mono text-xs tracking-widest">LOGOUT</span>
        </button>
      </div>
    </aside>
  )
}
