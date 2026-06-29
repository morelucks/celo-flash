import React from 'react';

export default function TickerMarquee() {
  return (
    <div className="ticker-marquee">
      <div className="marquee-content">
        <span><span className="ticker-dot"></span> luckify won $3.00 USDm playing UNDERDOGS WILL RISE 🔥</span>
        <span><span className="ticker-dot"></span> luckify won $0.50 USDm playing Daily Free Cup</span>
        <span><span className="ticker-dot"></span> luckify claimed Rank #1 in UNDERDOGS WILL RISE 🔥</span>
        <span><span className="ticker-dot"></span> luckify created tournament "Degens Only" 🏆</span>
      </div>
    </div>
  );
}
