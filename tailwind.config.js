// Tailwind wird beim Deploy zu public/assets/tailwind.css kompiliert (statt Laufzeit-Compiler im Browser).
/** @type {import('tailwindcss').Config} */
export default {
  content: ["./public/**/*.html", "./public/js/**/*.js", "./client/**/*.js"],
  theme: { extend: {} },
  plugins: [],
};
