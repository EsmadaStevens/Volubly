/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        night: '#0f0d15', // page background
        surface: '#211e27', // cards
        raised: '#241c38', // chips, tabs, footers
        line: '#57414a', // borders
        ink: '#e6e0ec', // main text
        muted: '#ddbfca', // secondary text
        accent: '#ff6ec7', // primary buttons
        'accent-deep': '#f451b0',
        spark: '#00d8f6', // links
        live: '#22e58b', // "live" status only
        warn: '#ff9f1c',
        danger: '#ffb4ab',
        plum: '#dbb8ff',
      },
      fontFamily: {
        sans: ['"DM Sans"', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
