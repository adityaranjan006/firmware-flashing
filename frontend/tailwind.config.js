/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './main.jsx',
    './App.jsx',
    './pages/**/*.jsx',
    './components/**/*.jsx',
    './hooks/**/*.js',
    './store.js',
  ],
  theme: {
    extend: {
      colors: {
        surface:   '#0f1117',
        'surface-2': '#1a1d27',
        'surface-3': '#6b7280',
        border:    '#2a2d3a',
        'accent-green': '#4ade80',
      },
      fontFamily: {
        display: ['Inter', 'sans-serif'],
        mono:    ['JetBrains Mono', 'monospace'],
      },
    },
  },
  plugins: [],
}
