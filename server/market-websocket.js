const EventEmitter = require('events');
const WebSocket = require('ws');
const upstoxApi = require('./upstox-api.js');

const BROKER = (process.env.MARKET_BROKER || 'simulated').toLowerCase();
const DHAN_API_KEY = process.env.DHAN_API_KEY || '';
const DHAN_CLIENT_ID = process.env.DHAN_CLIENT_ID || '';
const UPSTOX_ACCESS_TOKEN = process.env.UPSTOX_ACCESS_TOKEN || '';
const ANGEL_CLIENT_CODE = process.env.ANGEL_CLIENT_CODE || '';
const ANGEL_API_KEY = process.env.ANGEL_API_KEY || '';
const ANGEL_ACCESS_TOKEN = process.env.ANGEL_ACCESS_TOKEN || '';
const ANGEL_FEED_TOKEN = process.env.ANGEL_FEED_TOKEN || '';

class MarketDataFeed extends EventEmitter {
  constructor() {
    super();
    this.ws = null;
    this.subscriptions = { NIFTY: [], SENSEX: [] };
    this.reconnectTimer = null;
    this.simTimer = null;
    this.running = false;
    this.basePrices = { NIFTY: 24100, SENSEX: 79500 };
    this.strikePrices = {};
  }

  subscribe(index, strikes) {
    const idx = index.toUpperCase();
    if (!this.subscriptions[idx]) this.subscriptions[idx] = [];
    this.subscriptions[idx] = [...new Set([...this.subscriptions[idx], ...strikes])];
    if (this.running && BROKER !== 'simulated') {
      this._sendSubscription(idx);
    }
  }

  unsubscribe(index, strikes) {
    const idx = index.toUpperCase();
    if (!this.subscriptions[idx]) return;
    this.subscriptions[idx] = this.subscriptions[idx].filter(s => !strikes.includes(s));
  }

  clearSubscriptions(index) {
    const idx = index.toUpperCase();
    this.subscriptions[idx] = [];
  }

  start() {
    if (this.running) return;
    this.running = true;

    console.log(`[MarketWS] Starting feed (broker: ${BROKER})`);

    switch (BROKER) {
      case 'dhan':
        this._connectDhan();
        break;
      case 'upstox':
        this._connectUpstox();
        break;
      case 'angel':
        this._connectAngel();
        break;
      default:
        this._startSimulated();
    }
  }

  stop() {
    this.running = false;
    if (this.ws) {
      try { this.ws.close(); } catch (_) {}
      this.ws = null;
    }
    if (this.simTimer) {
      clearInterval(this.simTimer);
      this.simTimer = null;
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    console.log('[MarketWS] Feed stopped');
  }

  // ─── Dhan WebSocket ──────────────────────────────────────────────
  _connectDhan() {
    if (!DHAN_API_KEY || !DHAN_CLIENT_ID) {
      console.warn('[MarketWS] Dhan credentials missing — live ticks disabled, using HTTP polling only');
      return;
    }
    this._connectRaw(
      `wss://api.dhan.co/v2/ws/market`,
      { 'access-token': DHAN_API_KEY, 'client-id': DHAN_CLIENT_ID },
      (data) => this._parseDhanTick(data)
    );
  }

  _parseDhanTick(data) {
    try {
      const msg = JSON.parse(data);
      if (msg.type === 'Ticker') {
        this.emit('tick', {
          index: this._inferIndex(msg.securityId),
          strike: this._inferStrike(msg.securityId),
          type: msg.optionType === 'CE' ? 'CE' : 'PE',
          ltp: msg.lastTradedPrice,
          change: msg.netChange || 0,
          oi: msg.openInterest || 0,
          volume: msg.totalTradedVolume || 0,
          bid: msg.bidPrice || 0,
          ask: msg.askPrice || 0,
          timestamp: Date.now()
        });
      }
    } catch (_) {}
  }

  // ─── Upstox WebSocket ────────────────────────────────────────────
  _connectUpstox() {
    const token = upstoxApi.getAccessToken();
    if (!token) {
      console.warn('[MarketWS] Upstox access token missing — live ticks disabled, using HTTP polling only');
      return;
    }
    this._connectRaw(
      'wss://api.upstox.com/v2/feed/market-data-feed',
      { 'Authorization': `Bearer ${token}` },
      (data) => this._parseUpstoxTick(data)
    );
  }

  _parseUpstoxTick(data) {
    try {
      const msg = JSON.parse(data);
      
      // Handle Upstox v2 feed format
      if (msg.type === 'lf' || msg.type === 'ltp') {
        const instrument = msg.instrument || msg.instrument_token || '';
        const index = instrument.includes('NIFTY') || instrument.includes('Nifty 50') ? 'NIFTY' : 
                     instrument.includes('SENSEX') || instrument.includes('Sensex') ? 'SENSEX' : 'NIFTY';
        
        this.emit('tick', {
          index,
          strike: this._extractStrike(instrument),
          type: instrument.includes('CE') ? 'CE' : 'PE',
          ltp: msg.last_price || msg.ltp || 0,
          change: msg.change || 0,
          oi: msg.oi || msg.open_interest || 0,
          volume: msg.volume || msg.total_traded_volume || 0,
          bid: msg.best_bid || msg.bid_price || 0,
          ask: msg.best_ask || msg.ask_price || 0,
          timestamp: Date.now()
        });
      }
    } catch (err) {
      console.error('[MarketWS] Upstox tick parse error:', err.message);
    }
  }

  // ─── Angel One WebSocket ────────────────────────────────────────
  _connectAngel() {
    if (!ANGEL_CLIENT_CODE || !ANGEL_FEED_TOKEN) {
      console.warn('[MarketWS] Angel One credentials missing — live ticks disabled, using HTTP polling only');
      return;
    }
    this._connectRaw(
      'wss://ws.angelbroking.com/ws/market',
      {
        'Authorization': `Bearer ${ANGEL_ACCESS_TOKEN}`,
        'x-api-key': ANGEL_API_KEY,
        'x-client-code': ANGEL_CLIENT_CODE,
        'x-feed-token': ANGEL_FEED_TOKEN
      },
      (data) => this._parseAngelTick(data)
    );
  }

  _parseAngelTick(data) {
    try {
      const msg = JSON.parse(data);
      if (msg.token && msg.tradedQuantity) {
        this.emit('tick', {
          index: this._inferIndex(msg.token),
          strike: this._inferStrike(msg.token),
          type: msg.optionType || (msg.symbol?.endsWith('CE') ? 'CE' : 'PE'),
          ltp: msg.lastTradedPrice || msg.ltp,
          change: msg.change || 0,
          oi: msg.openInterest || 0,
          volume: msg.tradedQuantity || 0,
          bid: msg.buyPrice || 0,
          ask: msg.sellPrice || 0,
          timestamp: Date.now()
        });
      }
    } catch (_) {}
  }

  // ─── Raw WebSocket Helper ────────────────────────────────────────
  _connectRaw(url, headers, parseFn) {
    const connect = () => {
      console.log(`[MarketWS] Connecting to ${url}`);
      this.ws = new WebSocket(url, { headers });

      this.ws.on('open', () => {
        console.log('[MarketWS] Connected');
        this._sendInitialSubscriptions();
      });

      this.ws.on('message', (raw) => {
        const data = typeof raw === 'string' ? raw : raw.toString();
        parseFn(data);
      });

      this.ws.on('close', (code) => {
        console.log(`[MarketWS] Disconnected (code: ${code})`);
        this.ws = null;
        if (this.running) {
          this.reconnectTimer = setTimeout(() => connect(), 5000);
        }
      });

      this.ws.on('error', (err) => {
        console.error('[MarketWS] Error:', err.message);
        this.ws?.close();
      });
    };

    connect();
  }

  _sendInitialSubscriptions() {
    for (const [index, strikes] of Object.entries(this.subscriptions)) {
      if (strikes.length) this._sendSubscription(index);
    }
  }

  _sendSubscription(index) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const symbols = this.subscriptions[index] || [];
    if (!symbols.length) return;

    const msg = {
      action: 'subscribe',
      index,
      symbols: symbols.flatMap(s => [`${s}_CE`, `${s}_PE`])
    };

    try {
      this.ws.send(JSON.stringify(msg));
    } catch (err) {
      console.error('[MarketWS] Send error:', err.message);
    }
  }

  seedStrikePrices(chainData, index) {
    for (const item of chainData) {
      if (item.call?.ltp != null) {
        this.strikePrices[`${index}_${item.strike}_CE`] = item.call.ltp;
      }
      if (item.put?.ltp != null) {
        this.strikePrices[`${index}_${item.strike}_PE`] = item.put.ltp;
      }
    }
    this._pricesStale = true;
  }

  // ─── Simulated Tick Generator ────────────────────────────────────
  _startSimulated() {
    console.log('[MarketWS] Running simulated tick generator');
    const prices = {};
    const cachedExtra = {};

    const generateTick = () => {
      if (this._pricesStale) {
        Object.keys(prices).forEach(k => delete prices[k]);
        Object.keys(cachedExtra).forEach(k => delete cachedExtra[k]);
        this._pricesStale = false;
      }
      for (const [index, strikes] of Object.entries(this.subscriptions)) {
        const base = this.basePrices[index] || 24100;
        for (const strike of strikes) {
          for (const type of ['CE', 'PE']) {
            const key = `${index}_${strike}_${type}`;
            const realPrice = this.strikePrices[key];

            let ltp;
            if (realPrice != null) {
              ltp = realPrice > 0 ? realPrice : 0;
            } else {
              const intrinsic = type === 'CE'
                ? Math.max(0, base - strike)
                : Math.max(0, strike - base);
              const distFromSpot = Math.abs(strike - base);
              const atmTimeValue = base * 0.006;
              const timeValue = atmTimeValue * Math.exp(-distFromSpot * 0.003);
              if (prices[key] == null) prices[key] = +(intrinsic + timeValue).toFixed(2);
              const drift = (Math.random() - 0.495) * 0.4;
              ltp = Math.max(0.1, +(prices[key] + drift).toFixed(2));
            }

            const microChange = realPrice != null && realPrice > 0 ? +(ltp - realPrice).toFixed(2) : 0;
            if (realPrice != null) {
              if (!cachedExtra[key]) cachedExtra[key] = {};
              const c = cachedExtra[key];
              c.oi ??= Math.floor(Math.random() * 100000) + 500000;
              c.volume ??= Math.floor(Math.random() * 500) + 10;
              c.bid ??= +Math.max(0, ltp - Math.random() * 2).toFixed(2);
              c.ask ??= +(ltp + Math.random() * 2).toFixed(2);
            }
            const extra = cachedExtra[key] || {};
            this.emit('tick', {
              index,
              strike,
              type,
              ltp,
              change: microChange,
              oi: extra.oi ?? (Math.floor(Math.random() * 100000) + 500000),
              volume: extra.volume ?? (Math.floor(Math.random() * 500) + 10),
              bid: extra.bid ?? (+Math.max(0, ltp - Math.random() * 2).toFixed(2)),
              ask: extra.ask ?? (+(ltp + Math.random() * 2).toFixed(2)),
              timestamp: Date.now()
            });
          }
        }
      }
    };

    this.simTimer = setInterval(generateTick, 1000);
  }

  updateBasePrices(bases) {
    if (bases.NIFTY) this.basePrices.NIFTY = bases.NIFTY;
    if (bases.SENSEX) this.basePrices.SENSEX = bases.SENSEX;
  }

  // ─── Helpers ─────────────────────────────────────────────────────
  _inferIndex(token) {
    const t = String(token).toUpperCase();
    if (t.includes('SENSEX') || t.includes('BSX')) return 'SENSEX';
    return 'NIFTY';
  }

  _inferStrike(token) {
    const match = String(token).match(/(\d{4,6})/);
    return match ? parseInt(match[1]) : 0;
  }

  _extractStrike(token) {
    const match = String(token).match(/(\d{4,6})/);
    return match ? parseInt(match[1]) : 0;
  }
}

module.exports = new MarketDataFeed();
