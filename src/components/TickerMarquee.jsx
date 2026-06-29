import React from 'react';

export default function TickerMarquee() {
  return (
    <div className="ticker-wrap">
      <div className="ticker">
        <div className="ticker__item">
          <span className="ticker-dot"></span> luckify won $3.00 USDm playing UNDERDOGS WILL RISE 🔥
        </div>
        <div className="ticker__item">
          <span className="ticker-dot"></span> luckify won $0.50 USDm playing Daily Free Cup
        </div>
        <div className="ticker__item">
          <span className="ticker-dot"></span> luckify claimed Rank #1 in UNDERDOGS WILL RISE 🔥
        </div>
        <div className="ticker__item">
          <span className="ticker-dot"></span> luckify created tournament "Degens Only" 🏆
        </div>
      </div>
    </div>
  );
}
