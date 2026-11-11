'use client';
import { useState } from 'react';

const CARDS = [
  {
    name: 'Pikachu ex (SIR) #238',
    set: 'Stürmische Funken (Surging Sparks)',
    condition: 'Near Mint (NM)',
    value: '420 €',
    owner: 'TauschKing_NRW',
    wants: 'Glurak ex (151) oder Latias ex SIR',
    badge: 'Top Chase Card',
  },
  {
    name: 'Glurak ex (SIR) #199',
    set: 'Karmesin & Purpur - 151',
    condition: 'Mint / Boosterfrisch',
    value: '185 €',
    owner: 'PokeCollector_DE',
    wants: 'Nachtara VMAX oder PayPal / Tausch',
    badge: 'Heiß begehrt',
  },
  {
    name: 'Guardevoir ex (SIR) #245',
    set: 'Paldeas Schicksale',
    condition: 'Near Mint (NM)',
    value: '58 €',
    owner: 'ShinyHunter99',
    wants: 'Suche Illustration Rares aus 151',
    badge: 'Tauschbereit',
  },
];

export default function SwipeDeck() {
  const [index, setIndex] = useState(0);
  const [matches, setMatches] = useState([]);

  const currentCard = CARDS[index % CARDS.length];

  const handleAction = (liked) => {
    if (liked && !matches.includes(currentCard.name)) {
      setMatches([...matches, currentCard.name]);
    }
    setIndex((prev) => prev + 1);
  };

  return (
    <div className="grid md:grid-cols-3 gap-6">
      <div className="md:col-span-2 bg-slate-900/90 border border-cyan-500/30 rounded-2xl p-6 shadow-xl">
        <div className="flex items-center justify-between mb-4">
          <span className="px-3 py-1 rounded-full text-xs font-bold bg-cyan-500/20 text-cyan-300 border border-cyan-500/40">
            {currentCard.badge}
          </span>
          <span className="text-xs text-slate-400">Anbieter: {currentCard.owner}</span>
        </div>

        <div className="my-6 p-6 rounded-xl bg-gradient-to-br from-slate-800 via-slate-900 to-slate-950 border border-slate-700 text-center">
          <p className="text-xs uppercase tracking-widest text-cyan-400 mb-1">{currentCard.set}</p>
          <h2 className="text-2xl font-extrabold text-white mb-3">{currentCard.name}</h2>
          <div className="inline-block px-4 py-1.5 rounded-lg bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 font-bold text-lg mb-4">
            Marktwert: {currentCard.value}
          </div>
          <p className="text-sm text-slate-300">Zustand: <span className="font-semibold text-white">{currentCard.condition}</span></p>
          <p className="text-xs text-slate-400 mt-2">Sucht: {currentCard.wants}</p>
        </div>

        <div className="flex gap-4">
          <button
            onClick={() => handleAction(false)}
            className="flex-1 py-3 rounded-xl font-bold bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition"
          >
            Weiter (Skip)
          </button>
          <button
            onClick={() => handleAction(true)}
            className="flex-1 py-3 rounded-xl font-bold bg-gradient-to-r from-cyan-400 to-emerald-400 text-slate-950 shadow-[0_0_20px_rgba(34,211,238,0.4)] hover:opacity-95 transition"
          >
            Tausch-Interesse!
          </button>
        </div>
      </div>

      <div className="bg-slate-900/90 border border-pink-500/30 rounded-2xl p-6">
        <h3 className="text-lg font-bold text-pink-400 mb-2">Deine Tausch-Merkliste</h3>
        <p className="text-xs text-slate-400 mb-4">Karten, die du nach rechts geswiped hast:</p>
        {matches.length === 0 ? (
          <p className="text-sm text-slate-500 italic">Noch keine Karte ausgewählt. Swipe nach rechts!</p>
        ) : (
          <ul className="space-y-2">
            {matches.map((m, i) => (
              <li key={i} className="p-2.5 rounded-lg bg-slate-800/80 border border-pink-500/30 text-sm font-medium text-slate-200">
                ✓ {m}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
