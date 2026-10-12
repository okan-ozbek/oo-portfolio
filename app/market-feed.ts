export type MarketCandle = {id: number; open: number; high: number; low: number; close: number; volume: number};
type Period = {id: number; open: number; trades: {price: number; volume: number}[]};

// A local illustrative feed, independent of frame rate and external market data.
export function createMarketFeed(count = 32) {
  let seed = 73129, previousClose = 100, direction = 1, remaining = 12, volatility = 2.8;
  let nextId = 0;
  const history: Period[] = [];
  const random = () => {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let value = Math.imul(seed ^ seed >>> 15, 1 | seed);
    value ^= value + Math.imul(value ^ value >>> 7, 61 | value);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
  const generate = () => {
    if (remaining-- <= 0) {
      direction *= -1; remaining = 8 + Math.floor(random() * 11);
      volatility = 1.6 + random() * 2.8;
    }
    const open = previousClose + (random() < .08 ? (random() - .5) * volatility * 3 : 0);
    let move = direction * (.5 + random()) * volatility + (random() - .5) * volatility * 3.5;
    if (random() < .14) move *= 2.4;
    if (random() < .12) move *= .08;
    const close = open + move;
    const intraperiodVolatility = volatility * (.4 + random() * 2.1);
    let walk = 0;
    const deviations = Array.from({length: 12}, () => (walk += (random() - .5) * intraperiodVolatility * 1.8));
    const trades = deviations.map((deviation, index) => {
      const fraction = (index + 1) / deviations.length;
      return {
        price: index === deviations.length - 1 ? close : open + move * fraction + deviation - deviations[deviations.length - 1] * fraction,
        volume: 18 + random() * 25 + Math.abs(move) * 4,
      };
    });
    history.push({id: nextId++, open, trades}); previousClose = close;
    if (history.length > count) history.shift();
  };
  const summarize = (period: Period, elapsed: number): MarketCandle => {
    let close = period.open, high = close, low = close, volume = 0;
    for (const trade of period.trades.slice(0, elapsed)) {
      close = trade.price; high = Math.max(high, close); low = Math.min(low, close); volume += trade.volume;
    }
    return {id: period.id, open: period.open, close, high, low, volume};
  };
  return (time: number) => {
    const activeId = count - 1 + Math.floor(time / 4);
    while (nextId <= activeId) generate();
    const elapsed = Math.floor((time % 4) / 4 * 12);
    return history.map(period => summarize(period, period.id === activeId ? elapsed : 12));
  };
}
