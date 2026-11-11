'use client';
import { useState } from 'react';

const INITIAL_POSTS = [
  { user: 'Leyla_TCG', text: 'Gerade Pikachu ex aus Stürmische Funken gezogen! Wer tauscht gegen 151 Hits?', time: 'vor 5 Min.' },
  { user: 'CardMaster_NRW', text: 'Suche noch Turtok ex SIR aus 151 in Near Mint. Biete fairen Tauschwert!', time: 'vor 18 Min.' },
];

export default function CommunityWall() {
  const [posts, setPosts] = useState(INITIAL_POSTS);
  const [input, setInput] = useState('');

  const handleSend = (e) => {
    e.preventDefault();
    if (!input.trim()) return;
    setPosts([{ user: 'Sammler (Du)', text: input.trim(), time: 'gerade eben' }, ...posts]);
    setInput('');
  };

  return (
    <div className="bg-slate-900/90 border border-cyan-500/30 rounded-2xl p-6">
      <h2 className="text-xl font-bold text-cyan-400 mb-1">Community Postwall & Live-Chat</h2>
      <p className="text-sm text-slate-400 mb-6">Tausche dich direkt mit anderen Pokémon-TCG-Sammlern aus</p>

      <form onSubmit={handleSend} className="flex gap-3 mb-6">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Schreibe einen Post oder ein Tausch-Gesuch..."
          className="flex-1 px-4 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-white placeholder-slate-500 focus:outline-none focus:border-cyan-400"
        />
        <button
          type="submit"
          className="px-5 py-2.5 rounded-xl font-bold bg-cyan-400 text-slate-950 hover:bg-cyan-300 transition"
        >
          Posten
        </button>
      </form>

      <div className="space-y-3">
        {posts.map((p, i) => (
          <div key={i} className="p-4 rounded-xl bg-slate-800/70 border border-slate-700/80">
            <div className="flex items-center justify-between mb-1">
              <span className="font-bold text-cyan-300 text-sm">{p.user}</span>
              <span className="text-xs text-slate-500">{p.time}</span>
            </div>
            <p className="text-sm text-slate-200">{p.text}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
