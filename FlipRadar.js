'use client';

const DEALS = [
  { card: 'Latias ex (SIR) - Stürmische Funken', market: '165 €', deal: '125 €', profit: '+40 €', platform: 'Cardmarket' },
  { card: 'Karpador (IR) - Entwicklungen in Paldea', market: '95 €', deal: '68 €', profit: '+27 €', platform: 'eBay Sofortkauf' },
  { card: 'Turtok ex (SIR) - 151', market: '64 €', deal: '45 €', profit: '+19 €', platform: 'Kleinanzeigen' },
];

export default function FlipRadar() {
  return (
    <div className="bg-slate-900/90 border border-emerald-500/30 rounded-2xl p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-bold text-emerald-400">Live Flip-Radar</h2>
          <p className="text-sm text-slate-400">Echtzeit-Deals unter aktuellem Marktwert</p>
        </div>
        <span className="px-3 py-1 rounded-full text-xs font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
          Radar Aktiv
        </span>
      </div>
      <div className="space-y-3">
        {DEALS.map((d, i) => (
          <div key={i} className="flex flex-wrap items-center justify-between gap-4 p-4 rounded-xl bg-slate-800/70 border border-slate-700/80">
            <div>
              <p className="font-bold text-white">{d.card}</p>
              <p className="text-xs text-slate-400">Quelle: {d.platform} • Marktpreis: {d.market}</p>
            </div>
            <div className="flex items-center gap-4">
              <div className="text-right">
                <p className="text-sm text-slate-400">Angebot</p>
                <p className="text-lg font-extrabold text-cyan-400">{d.deal}</p>
              </div>
              <span className="px-3 py-1.5 rounded-lg bg-emerald-500/20 text-emerald-300 font-bold text-sm">
                {d.profit}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
