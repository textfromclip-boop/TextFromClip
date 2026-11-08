/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // LearnFromClip brand palette: navy #021433, blue gradient #1287FA -> #2E62F4 -> #4835F0, purple #502EF0, light #FEFEFE
        paper: '#F8FAFC',
        surface: '#FEFEFE',
        ink: '#021433',
        muted: '#475569',
        rule: '#E2E8F0',
        accent: '#2E62F4',
        'accent-light': '#1287FA',
        'accent-mid': '#4835F0',
        'accent-dark': '#502EF0',
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
