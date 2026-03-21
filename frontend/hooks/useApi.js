import axios from 'axios'
import { useStore } from '../store'

const BASE_URL = import.meta.env.VITE_API_URL || 'https://your-golang-backend.com'

const api = axios.create({ baseURL: BASE_URL })

// Inject JWT on every request
api.interceptors.request.use((config) => {
  const token = useStore.getState().token
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

export function useApi() {
  const { setAuth, logout } = useStore()

  const login = async (username, password) => {
    const res = await api.post('/auth/login', { username, password })
    setAuth(res.data.user, res.data.token)
    return res.data
  }

  const fetchCertificate = async (deviceId) => {
    const res = await api.get(`/certificates/${deviceId}`)
    return res.data  // { cert_path, cert_data }
  }

  const fetchConfigDefaults = async () => {
    const res = await api.get('/config/defaults')
    return res.data
  }

  const fetchFirmware = async () => {
    const res = await api.get('/firmware/latest')
    return res.data  // { esp_url, stm1_url, stm2_url }
  }

  const registerDevice = async (payload) => {
    const res = await api.post('/devices/register', payload)
    return res.data
  }

  const saveTestResults = async (deviceId, results) => {
    const res = await api.post(`/devices/${deviceId}/test-results`, results)
    return res.data
  }

  return {
    login,
    fetchCertificate,
    fetchConfigDefaults,
    fetchFirmware,
    registerDevice,
    saveTestResults,
    logout,
  }
}
