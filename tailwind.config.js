/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./*.html", "./**/*.html", "./*.js"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        brand: {
          primary: "#0B5DAA",
          secondary: "#6AB9FF",
          dark: "#081B33",
          bgLight: "#F8FAFC",
          success: "#2ECC71",
          glowBlue: "#38BDF8"
        }
      },
      fontFamily: {
        cairo: ["Cairo", "sans-serif"],
        poppins: ["Poppins", "sans-serif"]
      }
    }
  },
  plugins: []
};
