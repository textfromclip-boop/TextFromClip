/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // TextFromClip brand palette matched to logo (#021331 + #2868F7 -> #5131ED)
        paper: '#F8FAFC',
        surface: '#FFFFFF',
        ink: '#021331',
        muted: '#475569',
        rule: '#E2E8F0',
        accent: '#2868F7',
        'accent-dark': '#5131ED',
        'accent-soft': '#EEF4FF',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        serif: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
    },
  },
  plugins: [],
}
