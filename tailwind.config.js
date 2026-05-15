/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        sans: [
          '-apple-system',
          'BlinkMacSystemFont',
          'Inter',
          'Segoe UI',
          'Roboto',
          'Helvetica Neue',
          'sans-serif',
        ],
      },
      colors: {
        // Premium-fitness dark palette
        ink: {
          DEFAULT: '#070B14', // background
          surface: '#0E1422',
          elevated: '#141B2D',
          muted: '#0B1120',
          inset: '#080D1A',
        },
        line: {
          hairline: 'rgba(255,255,255,0.05)',
          DEFAULT: 'rgba(255,255,255,0.09)',
          strong: 'rgba(255,255,255,0.16)',
        },
        cobalt: {
          50: '#EAF1FF',
          100: '#CFDFFF',
          300: '#7AA6FF',
          400: '#5B95FF',
          500: '#3D7BFF', // brand accent
          600: '#2960E0',
          700: '#1E48B3',
        },
        fire: {
          400: '#FFB47A',
          500: '#FF9445',
          600: '#FF7A1A', // streak / PR
          700: '#E0610F',
        },
        success: {
          400: '#3FD982',
          500: '#1FCB6B',
          600: '#15A356',
        },
      },
      boxShadow: {
        card: '0 2px 6px rgba(0,0,0,0.25)',
        elevated: '0 8px 16px rgba(0,0,0,0.40)',
        deep: '0 16px 28px rgba(0,0,0,0.50)',
        'glow-cobalt': '0 8px 22px rgba(61,123,255,0.45)',
        'glow-fire':   '0 6px 18px rgba(255,122,26,0.45)',
        'glow-success':'0 6px 16px rgba(31,203,107,0.35)',
        'inset-soft': 'inset 0 1px 0 rgba(255,255,255,0.04)',
      },
      borderRadius: {
        '4xl': '2rem',
      },
      animation: {
        'fade-in': 'fade-in 0.25s ease-out both',
      },
      keyframes: {
        'fade-in': {
          '0%':   { opacity: 0, transform: 'translateY(4px)' },
          '100%': { opacity: 1, transform: 'translateY(0)' },
        },
      },
    },
  },
  plugins: [],
};
