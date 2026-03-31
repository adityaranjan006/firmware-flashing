import { create } from 'zustand'

// Restore auth from localStorage on page load
const _token = localStorage.getItem('devconfig_token') || null
const _user  = _token ? JSON.parse(localStorage.getItem('devconfig_user') || 'null') : null

export const useStore = create((set, get) => ({
  // Auth — persisted in localStorage so refresh doesn't log the user out
  user: _user,
  token: _token,
  setAuth: (user, token) => {
    localStorage.setItem('devconfig_token', token)
    localStorage.setItem('devconfig_user', JSON.stringify(user))
    set({ user, token })
  },
  logout: () => {
    localStorage.removeItem('devconfig_token')
    localStorage.removeItem('devconfig_user')
    set({ user: null, token: null })
  },

  // Agent connection
  agentConnected: false,
  setAgentConnected: (v) => set({ agentConnected: v }),

  // USB port detected by local agent
  connectedPort: null,
  setConnectedPort: (port) => set({ connectedPort: port }),

  // Current step — if token exists on load, skip login and go to device_select
  currentStep: _token ? 'device_select' : 'login',
  setStep: (step) => set({ currentStep: step }),

  // Sensor config phase: idle → handshaking → ready | failed
  sensorConfigPhase: 'idle',
  setSensorConfigPhase: (phase) => set({ sensorConfigPhase: phase }),

  // Sensor addresses collected in step 2
  sensorAddresses: { RL: null, RR: null, PL: null, PR: null, HS: null },
  setSensorAddress: (name, address) =>
    set(state => ({ sensorAddresses: { ...state.sensorAddresses, [name]: address } })),
  resetSensorConfig: () => set({
    sensorConfigPhase: 'idle',
    sensorAddresses: { RL: null, RR: null, PL: null, PR: null, HS: null },
  }),

  // Selected device (from device list)
  selectedDevice: null,
  setSelectedDevice: (device) => set({ selectedDevice: device }),

  // Device info resolved during selection
  deviceId: null,
  certPath: null,
  setDeviceInfo: (deviceId, certPath) => set({ deviceId, certPath }),

  // Device manufacturing info (entered in CertConfig step)
  serialNo: '',
  hardVer: '',
  mfgDate: '',
  setSerialNo: (v) => set({ serialNo: v }),
  setHardVer: (v) => set({ hardVer: v }),
  setMfgDate: (v) => set({ mfgDate: v }),

  // Programmer port mapping (set in ProgrammerSetup step)
  portMapping: { esp: null, stm: null },
  setPortMapping: (mapping) => set({ portMapping: mapping }),

  // Flash status
  flashStatus: { esp: 'idle', stm1: 'idle', stm2: 'idle' },
  setFlashStatus: (key, status) =>
    set(state => ({ flashStatus: { ...state.flashStatus, [key]: status } })),

  // Terminal lines
  terminalLines: [],
  addTerminalLine: (line) =>
    set(state => ({ terminalLines: [...state.terminalLines.slice(-500), line] })),
  clearTerminal: () => set({ terminalLines: [] }),

  // Terminal panel open/close (can be forced open externally)
  terminalOpen: true,
  setTerminalOpen: (v) => set({ terminalOpen: v }),

  // Sensor test results
  sensorResults: {},
  setSensorResult: (name, result) =>
    set(state => ({ sensorResults: { ...state.sensorResults, [name]: result } })),
}))
