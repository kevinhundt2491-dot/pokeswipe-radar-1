// Tailwind wird beim Deploy zu public/assets/tailwind.css kompiliert (statt Laufzeit-Compiler im Browser).
// „Grauwacke“: Die Slate-Töne werden durch ein mattes, leicht grünstichiges Gesteinsgrau ersetzt,
// damit alle Module (auch per JS erzeugte Fenster) automatisch im selben Dark-Theme erscheinen.
/** @type {import('tailwindcss').Config} */
export default {
  content: ["./public/**/*.html", "./client/**/*.js"],
  theme: {
    extend: {
      colors: {
        slate: {
          50: "#f4f5f3", 100: "#e6e8e4", 200: "#cdd1cb", 300: "#b0b5ad", 400: "#8d9289",
          500: "#6c7269", 600: "#535851", 700: "#3a3d38", 800: "#272926", 900: "#1a1c19", 950: "#0f100e",
        },
      },
    },
  },
  plugins: [],
};
