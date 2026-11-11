'use client';
import { useState } from 'react';

export default function CommunityWall() {
  const [posts, setPosts] = useState([
    { user: 'ZeroCollector', text: 'Gerade Pikachu ex aus Stürmische Funken gezogen! Wer tauscht?', time: 'vor 5 Min.' },
    { user: 'PokeTrainerNRW', text: 'Suche Glurak 151 in Near Mint, biete Tausch-Karten oder Kauf.', time: 'vor 18 Min.' },
  ]);
  const [input, setInput] = useState('');

  const addPost = (e) => {
    e.preventDefault();
    if (!input.trim()) return;
    setPosts([{ user: 'Sammler', text: input.trim(), time: 'Gerade eben' }, ...posts]);
    setInput('');
  };

  return (
    <div className="bg-slate-900/90 border border-pink-500/30 rounded-2xl p-6">
      <h2 className="text-xl font-bold text-pink-400 mb-4">Community Postwall & Live-Chat</h2>
      <form onSubmit={addPost} className="flex gap-2 mb-6">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Teile deinen Pull, deine Suche oder ein Tauschangebot..."
          className="flex-1 rounded-xl bg-slate-800 border border-slate-700 px-4 py-2.5 text-sm text-white focus:outline-none focus:border-cyan-400"
        />
        <button
          type="submit"
          className="px-5 py-2.5 rounded-xl bg-pink-500 text-white font-bold text-sm hover:bg-pink-400 transition"
        >
          Posten
        </button>
      </form>
      <div className="space-y-3">
        {posts.map((p, i) => (
          <div key={i} className="p-4 rounded-xl bg-slate-800/70 border border-slate-700/60">
            <div className="flex justify-between text-xs text-slate-400 mb-1">
              <span className="font-bold text-cyan-400">{p.user}</span>
              <span>{p.time}</span>
            </div>
            <p className="text-sm text-slate-200">{p.text}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
