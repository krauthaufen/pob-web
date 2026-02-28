/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        poe: {
          bg: "#0c0c0e",
          panel: "#1a1a2e",
          border: "#2a2a3e",
          text: "#c8c8d4",
          accent: "#af6025",
          fire: "#b97123",
          cold: "#3f6db3",
          lightning: "#d4a017",
          chaos: "#d02090",
          phys: "#c8c8c8",
          life: "#c51e1e",
          mana: "#4040ff",
          es: "#6b8cce",
        },
      },
    },
  },
  plugins: [],
};
