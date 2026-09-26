/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}'],
  theme: {
    extend: {
      colors: {
        paper: {
          50: '#f7f2e7',
          100: '#eee4cf',
          200: '#ddccae',
        },
        ink: {
          900: '#1c1712',
          700: '#3d362c',
          500: '#756c5c',
          300: '#a89e8a',
        },
        rust: {
          400: '#e8632f',
          500: '#bd3517',
          600: '#a82f16',
        },
        blueprint: {
          500: '#3c5568',
          600: '#2a3d4c',
        },
      },
      fontFamily: {
        sans: ['Work Sans', 'system-ui', 'sans-serif'],
        display: ['Oswald', 'Impact', 'sans-serif'],
        mono: ['IBM Plex Mono', 'ui-monospace', 'monospace'],
      },
      boxShadow: {
        garage: '6px 6px 0px 0px rgba(28, 23, 18, 1)',
        'garage-sm': '3px 3px 0px 0px rgba(28, 23, 18, 1)',
      },
      // Un seul langage de mouvement : départ franc, arrêt net, sans rebond.
      // L'identité est sérigraphiée (ombres dures, pas de flou) : le geste claque en place.
      transitionTimingFunction: {
        clack: 'cubic-bezier(0.2, 0.9, 0.1, 1)',
      },
      transitionDuration: {
        350: '350ms',
        450: '450ms',
      },
      backgroundImage: {
        grain:
          "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.05'/%3E%3C/svg%3E\")",
      },
    },
  },
  plugins: [],
};
