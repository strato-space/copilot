/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        't-primary': '#fff',
        't-secondary': '#B3B3B3',
      },
      fontSize: {},
      fontFamily: {
        'sf-pro': ['SF_Pro_Text', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
    },
  }
}

