'use client';
import { useState } from 'react';
import Navbar from '../components/Navbar';
import SwipeDeck from '../components/SwipeDeck';
import FlipRadar from '../components/FlipRadar';
import CommunityWall from '../components/CommunityWall';

export default function HomePage() {
  const [activeTab, setActiveTab] = useState('swipe');

  return (
    <div className="min-h-screen flex flex-col">
      <Navbar activeTab={activeTab} setActiveTab={setActiveTab} />
      <main className="flex-1 max-w-6xl w-full mx-auto px-4 py-8">
        {activeTab === 'swipe' && <SwipeDeck />}
        {activeTab === 'radar' && <FlipRadar />}
        {activeTab === 'market' && <FlipRadar />}
        {activeTab === 'community' && <CommunityWall />}
      </main>
      <footer className="border-t border-slate-800 py-4 text-center text-xs text-slate-500">
        PokeSwipe & Radar • pokeswipe-radar.de • Community & TCG Tool
      </footer>
    </div>
  );
}
