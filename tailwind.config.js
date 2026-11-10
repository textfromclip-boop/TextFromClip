/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // LearnFromClip palette: one ink, one accent, quiet neutrals, and a highlighter for lecture quotes.
        paper: '#F7F7F5',
        surface: '#FFFFFF',
        ink: '#021433',
        muted: '#4B5563',
        rule: '#E3E3DE',
        accent: '#2E62F4',
        'accent-light': '#2E62F4',
        'accent-mid': '#2E62F4',
        'accent-dark': '#1F49C7',
        'accent-soft': '#EEF2FE',
        mark: '#FFF1A8',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        serif: ['Newsreader', 'Georgia', 'Cambria', '"Times New Roman"', 'serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
    },
  },
  plugins: [],
}
