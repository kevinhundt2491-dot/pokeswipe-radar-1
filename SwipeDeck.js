'use client';
import { useState } from 'react';

const DEMO_CARDS = [
  { id: 1, name: 'Pikachu ex (SIR)', set: 'Stürmische Funken', price: '420,00 €', condition: 'Near Mint', trend: '+14%' },
  { id: 2, name: 'Glurak ex (SIR)', set: '151', price: '185,00 €', condition: 'Mint', trend: '+6%' },
  { id: 3, name: 'Nachtara VMAX (Alt Art)', set: 'Drachenwandel', price: '890,00 €', condition: 'PSA 10', trend: '+9%' },
  { id: 4, name: 'Lugia V (Alt Art)', set: 'Silberne Sturmwinde', price: '165,00 €', condition: 'Near Mint', trend: '+4%' },
];

export default function SwipeDeck() {
  const [index, setIndex] = useState(0);
  const [liked, setLiked] = useState([]);

  const card = DEMO_CARDS[index % DEMO_CARDS.length];

  const handleAction = (isLike) => {
    if (isLike) setLiked((prev) => [...prev, card]);
    setIndex((prev) => prev + 1);
  };

  return (
    <div className="grid md:grid-cols-2 gap-6 items-start">
      <div className="bg-slate-900/90 border border-cyan-500/30 rounded-2xl p-6 shadow-[0_0_25px_rgba(0,243,255,0.1)]">
        <div className="flex justify-between items-center mb-4">
          <span className="text-xs uppercase tracking-widest px-2.5 py-1 rounded bg-cyan-500/20 text-cyan-300 font-bold">
            {card.set}
          </span>
          <span className="text-emerald-400 font-bold text-sm">{card.trend}</span>
        </div>
        <div className="h-64 rounded-xl bg-gradient-to-br from-slate-800 via-slate-900 to-cyan-950 border border-slate-700 flex flex-col items-center justify-center p-6 text-center mb-6">
          <p className="text-2xl font-extrabold text-white mb-2">{card.name}</p>
          <p className="text-sm text-slate-400 mb-4">Zustand: {card.condition}</p>
          <span className="text-3xl font-black text-cyan-400">{card.price}</span>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <button
            onClick={() => handleAction(false)}
            className="py-3 rounded-xl font-bold bg-rose-500/20 border border-rose-500/40 text-rose-300 hover:bg-rose-500/30 transition"
          >
            ✕ Weiter
          </button>
          <button
            onClick={() => handleAction(true)}
            className="py-3 rounded-xl font-bold bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/30 transition"
          >
            ♥ Watchlist
          </button>
        </div>
      </div>

      <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-6">
        <h3 className="text-lg font-bold text-cyan-400 mb-3">Deine Gemerkten Karten ({liked.length})</h3>
        {liked.length === 0 ? (
          <p className="text-slate-400 text-sm">Swipe nach rechts, um spannende Karten auf deine Watchlist zu setzen.</p>
        ) : (
          <ul className="space-y-2">
            {liked.map((item, idx) => (
              <li key={idx} className="flex justify-between items-center bg-slate-800/70 px-3 py-2 rounded-lg text-sm">
                <span className="font-semibold text-white">{item.name}</span>
                <span className="text-cyan-400 font-bold">{item.price}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
