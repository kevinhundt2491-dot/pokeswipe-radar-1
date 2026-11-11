'use client';

export default function Navbar({ activeTab, setActiveTab }) {
  const tabs = [
    { id: 'swipe', label: 'PokeSwipe' },
    { id: 'radar', label: 'Flip-Radar' },
    { id: 'market', label: 'Marktplatz' },
    { id: 'community', label: 'Community & Chat' },
  ];

  return (
    <header className="border-b border-slate-800 bg-[#0d1322]/90 backdrop-blur sticky top-0 z-50">
      <div className="max-w-6xl mx-auto px-4 py-3 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <span className="h-3 w-3 rounded-full bg-cyan-400 animate-pulse" />
          <h1 className="text-xl font-extrabold tracking-wider bg-gradient-to-r from-cyan-400 via-emerald-400 to-pink-500 bg-clip-text text-transparent">
            POKESWIPE & RADAR
          </h1>
        </div>
        <nav className="flex flex-wrap gap-2">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              className={`px-3.5 py-1.5 rounded-lg text-sm font-semibold transition-all ${
                activeTab === t.id
                  ? 'bg-cyan-400 text-slate-950 shadow-[0_0_15px_rgba(34,211,238,0.5)]'
                  : 'bg-slate-800/80 text-slate-300 hover:bg-slate-700'
              }`}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </div>
    </header>
  );
}
