/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Warm paper palette taken from the approved navigation reference
        paper: '#F4EEE6',
        surface: '#FBF8F3',
        ink: '#1B1814',
        muted: '#6B635A',
        rule: '#D9CFC1',
        accent: '#C4441F',
        'accent-dark': '#9E3517',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        serif: ['"Source Serif 4"', 'Georgia', 'serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
    },
  },
  plugins: [],
}
