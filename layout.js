import "./globals.css";

export const metadata = {
  title: "PokeSwipe & Radar | Pokémon TCG Community",
  description: "Pokémon TCG Karten swipen, Flip-Radar, Live-Marktplatz & Sammler-Community.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="de">
      <body className="min-h-screen bg-[#090d16] text-slate-100 antialiased selection:bg-cyan-500 selection:text-black">
        {children}
      </body>
    </html>
  );
}
