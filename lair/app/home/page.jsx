'use client';

import { useEffect } from 'react';

export default function HomeAlias() {
  useEffect(() => {
    const oldTab = location.hash.slice(1);
    const destination = { chat: 'conversation', work: 'workflows', activity: 'operations', settings: 'operations' }[oldTab] || 'overview';
    location.replace(`/lair/#${destination}`);
  }, []);
  return <main className="home-alias"><p>Opening the Aeryx command deck…</p><a href="/lair/#overview">Continue to the Lair</a></main>;
}
