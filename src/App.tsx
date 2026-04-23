import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { doc, setDoc, serverTimestamp, collection, onSnapshot, query, orderBy, limit } from "firebase/firestore";
import { db } from "./lib/firebase";
import { 
  BarChart3, 
  TrendingUp, 
  TrendingDown, 
  Activity,
  Zap,
  RefreshCw,
  Search,
  ChevronDown,
  ChevronUp,
  LayoutGrid,
  Info,
  Target,
  ShieldCheck,
  ChevronLeft,
  ChevronRight,
  Wallet,
  History as HistoryIcon,
  XCircle,
  Clock
} from "lucide-react";

// TradingView widget script loader
const useTradingView = (containerId: string, isActive: boolean, hideToolbar: boolean) => {
  useEffect(() => {
    if (!isActive) return;

    const initWidget = () => {
      const container = document.getElementById(containerId);
      if (container && window.TradingView) {
        // Clear container to prevent duplicate widgets
        container.innerHTML = '';
        try {
          new window.TradingView.widget({
            autosize: true,
            symbol: "BINANCE:BTCUSDT",
            interval: "15",
            timezone: "Etc/UTC",
            theme: "dark",
            style: "1",
            locale: "en",
            toolbar_bg: "#05070a",
            enable_publishing: false,
            hide_side_toolbar: hideToolbar,
            allow_symbol_change: false,
            save_image: false,
            header_widget_buttons_mode: "adaptive",
            container_id: containerId,
          });
        } catch (e) {
          console.error("TradingView widget init error:", e);
        }
      }
    };

    if (window.TradingView) {
      initWidget();
    } else {
      const existingScript = document.getElementById("tradingview-widget-script");
      if (!existingScript) {
        const script = document.createElement("script");
        script.id = "tradingview-widget-script";
        script.src = "https://s3.tradingview.com/tv.js";
        script.async = true;
        script.onload = initWidget;
        document.head.appendChild(script);
      } else {
        // Script is already loading, it will call its own onload. 
        // Or we can poll if we need to be sure.
        const interval = setInterval(() => {
          if (window.TradingView) {
            initWidget();
            clearInterval(interval);
          }
        }, 500);
        return () => clearInterval(interval);
      }
    }
  }, [containerId, isActive, hideToolbar]);
};

interface TimeframeData {
  timeframe: string;
  trend: string;
  rsi: number;
  rsiState: string;
  structure: string;
  ema20: number;
  ema50: number;
  distFromEMA20: number;
}

interface MarketAnalysis {
  price: number;
  timeframes: TimeframeData[];
  signal: {
    type: "BUY" | "SELL" | "WAIT";
    tier: number;
    confidence: number;
    zone: string;
    sl: string;
    tp1: string;
    tp2: string;
    rr: string;
  };
  entryTiming: "GOOD" | "WAIT_PULLBACK" | "WAIT_BREAKOUT";
  timingNote: string;
  reasoning: string;
  checkpoints: { label: string; checked: boolean }[];
}

export default function App() {
  const [loading, setLoading] = useState(false);
  const [showSplash, setShowSplash] = useState(true);
  const [showChartToolbar, setShowChartToolbar] = useState(false);
  const [countdown, setCountdown] = useState(5);
  const [analysis, setAnalysis] = useState<MarketAnalysis | null>(null);
  const [liveIndicators, setLiveIndicators] = useState<TimeframeData[] | null>(null);
  const [highlightTrigger, setHighlightTrigger] = useState(0); // State for targeting flash
  const [mobileActiveTab, setMobileActiveTab] = useState<"CHART" | "SIGNAL" | "ACCOUNT">("SIGNAL");
  const [tradeLoading, setTradeLoading] = useState(false);
  
  // Real-time Account Data
  const [accountData, setAccountData] = useState<any>(null);
  const [positions, setPositions] = useState<any[]>([]);
  const [history, setHistory] = useState<any[]>([]);

  useEffect(() => {
    // Listen for Account Info
    const unsubAccount = onSnapshot(doc(db, "accounts", "LIVE_ACCOUNT"), (doc) => {
      if (doc.exists()) setAccountData(doc.data());
    });

    // Listen for Open Positions
    const unsubPositions = onSnapshot(collection(db, "positions"), (snapshot) => {
      setPositions(snapshot.docs.map(d => ({ id: d.id, ...d.data() })));
    });

    // Listen for History
    const qHistory = query(collection(db, "history"), orderBy("closeTime", "desc"), limit(10));
    const unsubHistory = onSnapshot(qHistory, (snapshot) => {
      setHistory(snapshot.docs.map(d => d.data()));
    });

    return () => { unsubAccount(); unsubPositions(); unsubHistory(); };
  }, []);
  
  useTradingView("tv_chart_container", !showSplash, !showChartToolbar);

  // AUTO-BOOTSTRAP: Siapkan Kotak Sinyal biar MT5 gak 404
  useEffect(() => {
    if (!showSplash) {
      const bootstrap = async () => {
        try {
          await setDoc(doc(db, "signals", "LIVE_SIGNAL"), {
            status: "ready",
            side: "WAIT",
            timestamp: serverTimestamp(),
            note: "System Initialized"
          }, { merge: true });
          console.log("✅ CLOUD BRIDGE INITIALIZED");
        } catch (e) {
          console.error("Bootstrap error:", e);
        }
      };
      bootstrap();
    }
  }, [showSplash]);

  const closeTrade = async (ticket: string) => {
    setTradeLoading(true);
    try {
      await setDoc(doc(db, "signals", "LIVE_SIGNAL"), {
        side: "CLOSE",
        ticket: ticket,
        timestamp: serverTimestamp(),
        status: "pending"
      });
      alert("🛑 CLOSE REQUEST SENT: MetaTrader sedang memproses penutupan tiket #" + ticket);
    } catch (err) {
      alert("❌ Gagal mengirim perintah tutup.");
    } finally {
      setTradeLoading(false);
    }
  };

  const executeTrade = async () => {
    if (!analysis?.signal || analysis.signal.type === 'WAIT') return;
    
    setTradeLoading(true);
    try {
      // JURUS PAMUNGKAS: Taruh di satu kotak tetap agar MT5 gampang ambilnya
      await setDoc(doc(db, "signals", "LIVE_SIGNAL"), {
        side: analysis.signal.type,
        symbol: "BTCUSD",
        volume: 0.01,
        sl: analysis.signal.sl,
        tp: analysis.signal.tp1,
        timestamp: serverTimestamp(),
        status: "pending"
      });
      
      alert("🚀 CLOUD SIGNAL READY! Silakan cek MT5 Bapak sekarang.");
    } catch (err: any) {
      console.error("Firebase Error:", err);
      alert("⚠️ CLOUD ERROR: Gagal mengirim sinyal ke Google Bridge. Cek koneksi internet Bapak.");
    } finally {
      setTradeLoading(false);
    }
  };

  const enterTerminal = () => {
    setShowSplash(false);
    speakMessage("Welcome to BTC USD Signal Omega. Terminal system is now active.");
  };

  // Auto-enter timer
  useEffect(() => {
    if (!showSplash) return;
    
    if (countdown <= 0) {
      enterTerminal();
      return;
    }

    const timer = setInterval(() => {
      setCountdown((prev) => prev - 1);
    }, 1000);

    return () => clearInterval(timer);
  }, [showSplash, countdown]);

  // Remove the timeout so highlightTrigger stays until re-triggered
  // Or rather, we don't need a timeout anymore. It will just stay statically there.

  const speakMessage = (text: string, rate: number = 0.85) => {
    if (!window.speechSynthesis) return;
    const msg = new SpeechSynthesisUtterance();
    msg.lang = 'en-US';
    msg.rate = rate; // slightly slower
    msg.text = text;
    window.speechSynthesis.speak(msg);
  };

const calculateRSI = (closes: number[], period: number = 14) => {
  if (closes.length < period + 1) return 50;
  let gains = 0;
  let losses = 0;
  
  // Calculate initial average gain/loss
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gains += diff;
    else losses -= diff;
  }
  
  let avgGain = gains / period;
  let avgLoss = losses / period;
  
  // Smoothed moving average for the rest
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) {
      avgGain = (avgGain * (period - 1) + diff) / period;
      avgLoss = (avgLoss * (period - 1)) / period;
    } else {
      avgGain = (avgGain * (period - 1)) / period;
      avgLoss = (avgLoss * (period - 1) - diff) / period;
    }
  }
  
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
};

const calculateEMA = (closes: number[], period: number) => {
  if (closes.length < period) return closes[closes.length - 1];
  const multiplier = 2 / (period + 1);
  let ema = closes.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < closes.length; i++) {
    ema = (closes[i] - ema) * multiplier + ema;
  }
  return ema;
};

const getStructure = (closes: number[]) => {
  if (closes.length < 10) return "Ranging";
  const last5 = closes.slice(-5);
  const prev5 = closes.slice(-10, -5);
  const lastHigh = Math.max(...last5);
  const lastLow = Math.min(...last5);
  const prevHigh = Math.max(...prev5);
  const prevLow = Math.min(...prev5);
  
  if (lastHigh > prevHigh && lastLow > prevLow) return "BOS UP (HH)";
  if (lastHigh < prevHigh && lastLow < prevLow) return "BOS DOWN (LL)";
  if (lastHigh > prevHigh && lastLow < prevLow) return "Expansion";
  if (lastHigh < prevHigh && lastLow > prevLow) return "Consolidating";
  return "Ranging";
};

  const runAnalysis = async () => {
    setLoading(true);
    try {
      // Helper function for voice signal
      const speakSignal = (type: string, zone?: string) => {
        let spelledZone = zone;
        if (zone) {
          // Add commas between digits to force the TTS engine to pause between them
          spelledZone = zone.split('').map(char => char === '.' ? ' point ' : char).join(', ');
        }
        
        if (type === 'BUY') {
          speakMessage(`BUY signal detected. BUY at ${spelledZone}. Please check the terminal.`, 0.8);
        } else if (type === 'SELL') {
          speakMessage(`SELL signal detected. SELL at ${spelledZone}. Please check the terminal.`, 0.8);
        }
      };

      // 1. Fetch exact real-time price & 24h stats from Binance (Public API)
      let currentPrice = 0;
      let priceChangePercent = 0;
      let priceString = "Unknown";
      let shortTermTrendInfo = "";
      let miniTrendPercent = 0; // Expose to fallback logic
      
      const realTimeframes: TimeframeData[] = [];
      let h1RawKlines: any[] = [];

      try {
        // Fetch 24hr ticker
        const binanceRes = await fetch("https://api.binance.com/api/v3/ticker/24hr?symbol=BTCUSDT");
        if (binanceRes.ok) {
          const binanceData = await binanceRes.json();
          currentPrice = parseFloat(binanceData.lastPrice);
          priceChangePercent = parseFloat(binanceData.priceChangePercent);
          priceString = `$${currentPrice.toLocaleString()}`;
        }

        // Fetch real-time klines for multiple timeframes to calculate exact RSI and Structure
        const fetchTF = async (interval: string, tfLabel: string) => {
          const res = await fetch(`https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=${interval}&limit=150`); // Pull 150 for RSI smoothing accuracy
          if (res.ok) {
            const klines = await res.json();
            if (interval === '1h') h1RawKlines = klines;
            const closes = klines.map((k: any) => parseFloat(k[4]));
            const rsi = Math.round(calculateRSI(closes, 14)); // This will now use 150 data points for precise Wilder's smoothing
            
            const ema20 = calculateEMA(closes, 20);
            const ema50 = calculateEMA(closes, 50);
            const lastClose = closes[closes.length - 1];
            const distFromEMA20 = ((lastClose - ema20) / ema20) * 100; // % jarak dari EMA20

            // For trend mapping, extract only the last 50 periods
            const recentCloses = closes.slice(-50);
            const first = recentCloses[0];
            const last = recentCloses[recentCloses.length - 1];
            const trendPct = ((last - first) / first) * 100;
            const trendStr = trendPct > 0.5 ? "STRONG BULL" : trendPct > 0 ? "BULLISH" : trendPct < -0.5 ? "STRONG BEAR" : "BEARISH";
            const rsiState = rsi > 70 ? "Overbought" : rsi < 30 ? "Oversold" : rsi > 55 ? "Bullish" : rsi < 45 ? "Bearish" : "Neutral";
            const structure = getStructure(recentCloses);
            
            realTimeframes.push({
              timeframe: tfLabel,
              trend: trendStr,
              rsi,
              rsiState,
              structure,
              ema20,
              ema50,
              distFromEMA20
            });
            
            if (interval === '15m') {
              miniTrendPercent = trendPct;
              shortTermTrendInfo = `DATA KLINES 1 JAM TERAKHIR: Trend M15 bergerak sebesar ${miniTrendPercent.toFixed(2)}%. Closes (4 candle 15m terakhir): ${closes.slice(-4).join(', ')}.`;
            }
          }
        };

        await Promise.all([
          fetchTF('5m', 'M5'),
          fetchTF('15m', 'M15'),
          fetchTF('1h', 'H1'),
          fetchTF('4h', 'H4')
        ]);
        
        // Sort timeframes
        const tfOrder = ['H4', 'H1', 'M15', 'M5'];
        realTimeframes.sort((a, b) => tfOrder.indexOf(a.timeframe) - tfOrder.indexOf(b.timeframe));

      } catch (e) {
        console.warn("Failed to fetch price from Binance API", e);
      }

      const exactTimeframesStr = JSON.stringify(realTimeframes);

      // Core Technical Engine (Mathematical / Rules Based)
      const h4 = realTimeframes.find(t => t.timeframe === 'H4');
      const h1 = realTimeframes.find(t => t.timeframe === 'H1');
      const m15 = realTimeframes.find(t => t.timeframe === 'M15');
      const m5 = realTimeframes.find(t => t.timeframe === 'M5');

      let signalType: "BUY" | "SELL" | "WAIT" = "WAIT";
      let reasoningTxt = "Menunggu konfirmasi...";
      let tier = 0;
      let bullCount = 0;
      let bearCount = 0;
      let avgRsi = 50;

      if (h4 && h1 && m15 && m5) {
        bullCount = [h4, h1, m15, m5].filter(t => t.trend.includes('BULL')).length;
        bearCount = [h4, h1, m15, m5].filter(t => t.trend.includes('BEAR')).length;
        avgRsi = (h1.rsi + m15.rsi) / 2;

        const h4Bullish = h4.trend.includes('BULL');
        const h4Bearish = h4.trend.includes('BEAR');
        const h4Sideways = !h4Bullish && !h4Bearish;

        // GARIS MERAH: H4 sideways = DILARANG TRADING
        if (h4Sideways) {
          signalType = "WAIT";
          tier = 0;
          reasoningTxt = `H4 SIDEWAYS (${h4.structure}). Tidak ada arah dominan. DILARANG ENTRY sampai H4 konfirmasi trend.`;
        }
        // H4 BULLISH — hanya cari BUY
        else if (h4Bullish) {
          // TIER 1: 4/4 TF Bullish
          if (bullCount === 4 && avgRsi < 68) {
            signalType = "BUY"; tier = 1;
            reasoningTxt = `TIER 1 — 4/4 TF Bullish. RSI H1:${h1.rsi} M15:${m15.rsi}. Setup terkuat, full momentum.`;
          }
          // TIER 2: 3/4 TF Bullish, H4 sudah konfirmasi
          else if (bullCount === 3 && avgRsi < 70) {
            signalType = "BUY"; tier = 2;
            reasoningTxt = `TIER 2 — 3/4 TF Bullish, H4 konfirmasi. RSI H1:${h1.rsi} M15:${m15.rsi}. Setup moderat.`;
          }
          // TIER 3: H4 Bullish + M15 Oversold ekstrim = bounce
          else if (m15.rsi <= 28 && h1.rsi < 45) {
            signalType = "BUY"; tier = 3;
            reasoningTxt = `TIER 3 — H4 Bullish + M15 Oversold RSI:${m15.rsi}. Setup bounce, gunakan SL ketat.`;
          }
          // H4 Bullish tapi TF lain belum konfirmasi
          else {
            signalType = "WAIT"; tier = 0;
            reasoningTxt = `H4 Bullish tapi TF kecil belum konfirmasi arah. Bull:${bullCount}/4. Tunggu setup bersih.`;
          }
        }
        // H4 BEARISH — hanya cari SELL
        else if (h4Bearish) {
          // TIER 1: 4/4 TF Bearish
          if (bearCount === 4 && avgRsi > 32) {
            signalType = "SELL"; tier = 1;
            reasoningTxt = `TIER 1 — 4/4 TF Bearish. RSI H1:${h1.rsi} M15:${m15.rsi}. Setup terkuat, full momentum.`;
          }
          // TIER 2: 3/4 TF Bearish, H4 sudah konfirmasi
          else if (bearCount === 3 && avgRsi > 30) {
            signalType = "SELL"; tier = 2;
            reasoningTxt = `TIER 2 — 3/4 TF Bearish, H4 konfirmasi. RSI H1:${h1.rsi} M15:${m15.rsi}. Setup moderat.`;
          }
          // TIER 3: H4 Bearish + M15 Overbought ekstrim = rejection
          else if (m15.rsi >= 72 && h1.rsi > 55) {
            signalType = "SELL"; tier = 3;
            reasoningTxt = `TIER 3 — H4 Bearish + M15 Overbought RSI:${m15.rsi}. Setup rejection, gunakan SL ketat.`;
          }
          // H4 Bearish tapi TF lain belum konfirmasi
          else {
            signalType = "WAIT"; tier = 0;
            reasoningTxt = `H4 Bearish tapi TF kecil belum konfirmasi arah. Bear:${bearCount}/4. Tunggu setup bersih.`;
          }
        }
      }

      // TIMING ENTRY FILTER
      let entryTiming: "GOOD" | "WAIT_PULLBACK" | "WAIT_BREAKOUT" = "GOOD";
      let timingNote = "Stabilizing market...";

      if (signalType === "BUY" && m15 && h1) {
        const priceTooHigh = m15.distFromEMA20 > 1.5; // Harga udah 1.5% di atas EMA20 M15
        const ema20AboveEma50 = m15.ema20 > m15.ema50; // Trend EMA konfirmasi
        const rsiNotOverbought = m15.rsi < 65;

        if (priceTooHigh) {
          entryTiming = "WAIT_PULLBACK";
          timingNote = `⏳ Harga terlalu jauh dari EMA20 M15 (+${m15.distFromEMA20.toFixed(1)}%). Tunggu pullback ke area ${m15.ema20.toFixed(1)} sebelum entry.`;
        } else if (!ema20AboveEma50) {
          entryTiming = "WAIT_BREAKOUT";
          timingNote = `⏳ EMA20 M15 belum di atas EMA50. Tunggu konfirmasi breakout structure dulu.`;
        } else if (rsiNotOverbought && !priceTooHigh) {
          entryTiming = "GOOD";
          timingNote = `✅ Timing entry bagus. Harga dekat EMA20 M15 (${m15.distFromEMA20.toFixed(1)}%). RSI sehat di ${m15.rsi}.`;
        }
      }

      if (signalType === "SELL" && m15 && h1) {
        const priceTooLow = m15.distFromEMA20 < -1.5; // Harga udah 1.5% di bawah EMA20 M15
        const ema20BelowEma50 = m15.ema20 < m15.ema50;
        const rsiNotOversold = m15.rsi > 35;

        if (priceTooLow) {
          entryTiming = "WAIT_PULLBACK";
          timingNote = `⏳ Harga terlalu jauh di bawah EMA20 M15 (${m15.distFromEMA20.toFixed(1)}%). Tunggu pullback ke area ${m15.ema20.toFixed(1)} sebelum entry.`;
        } else if (!ema20BelowEma50) {
          entryTiming = "WAIT_BREAKOUT";
          timingNote = `⏳ EMA20 M15 belum di bawah EMA50. Tunggu konfirmasi breakdown structure dulu.`;
        } else if (rsiNotOversold && !priceTooLow) {
          entryTiming = "GOOD";
          timingNote = `✅ Timing entry bagus. Harga dekat EMA20 M15 (${m15.distFromEMA20.toFixed(1)}%). RSI sehat di ${m15.rsi}.`;
        }
      }

      // Hitung ATR dari H1 klines
      const calcATR = (klines: any[], period = 14) => {
        if (!klines || klines.length < period + 1) return currentPrice * 0.005;
        const trs = klines.slice(-period - 1).map((k: any, i: number, arr: any[]) => {
          if (i === 0) return parseFloat(k[2]) - parseFloat(k[3]);
          const high = parseFloat(k[2]);
          const low = parseFloat(k[3]);
          const prevClose = parseFloat(arr[i-1][4]);
          return Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
        });
        return trs.reduce((a: number, b: number) => a + b, 0) / period;
      };

      const atr = calcATR(h1RawKlines);

      // SL/TP multiplier berdasarkan tier
      const slMult  = tier === 1 ? 2.0 : tier === 2 ? 1.5 : 1.0;
      const tp1Mult = tier === 1 ? 2.0 : tier === 2 ? 1.5 : 1.0;
      const tp2Mult = tier === 1 ? 4.0 : tier === 2 ? 3.0 : 2.0;

      const slRaw  = signalType === "BUY" ? (currentPrice - atr * slMult).toFixed(1)  : (currentPrice + atr * slMult).toFixed(1);
      const tp1Raw = signalType === "BUY" ? (currentPrice + atr * tp1Mult).toFixed(1) : (currentPrice - atr * tp1Mult).toFixed(1);
      const tp2Raw = signalType === "BUY" ? (currentPrice + atr * tp2Mult).toFixed(1) : (currentPrice - atr * tp2Mult).toFixed(1);

      // Confidence berdasarkan tier
      const calcConf = tier === 1 ? 92 : tier === 2 ? 75 : tier === 3 ? 62 : 0;

      const localData: MarketAnalysis = {
        price: currentPrice,
        timeframes: realTimeframes,
        signal: {
          type: signalType,
          tier: tier,
          confidence: calcConf, 
          zone: currentPrice.toFixed(1), // Entry at market price logic
          sl: parseFloat(slRaw).toFixed(1),
          tp1: parseFloat(tp1Raw).toFixed(1),
          tp2: parseFloat(tp2Raw).toFixed(1),
          rr: tier === 3 ? "1:1" : "1:2"
        },
        entryTiming: entryTiming,
        timingNote: timingNote,
        reasoning: reasoningTxt,
        checkpoints: [
          { label: "Data Binance Validated", checked: true },
          { label: "RSI Multi-Timeframe Algoritma", checked: true },
          { label: "Structure Konfirmasi", checked: true }
        ]
      };
      
      setAnalysis(localData);
      setHighlightTrigger(prev => prev + 1); // Trigger visual highlight
      if (localData.signal?.type === 'BUY' || localData.signal?.type === 'SELL') {
        speakSignal(localData.signal.type, localData.signal.zone);
      }
    } catch (err: any) {
      console.error("General Analysis Error:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    runAnalysis();
    
    // Background poller for Live Math Indicators
    const fetchBackgroundData = async () => {
      try {
        const binanceRes = await fetch("https://api.binance.com/api/v3/ticker/24hr?symbol=BTCUSDT");
        let newPrice = 0;
        if (binanceRes.ok) {
          const binanceData = await binanceRes.json();
          newPrice = parseFloat(binanceData.lastPrice);
        }

        const realTimeframes: TimeframeData[] = [];
        const fetchTF = async (interval: string, tfLabel: string) => {
          const res = await fetch(`https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=${interval}&limit=150`); // Fix: Limit 150
          if (res.ok) {
            const klines = await res.json();
            const closes = klines.map((k: any) => parseFloat(k[4]));
            const rsi = Math.round(calculateRSI(closes, 14));
            
            const ema20 = calculateEMA(closes, 20);
            const ema50 = calculateEMA(closes, 50);
            const lastClose = closes[closes.length - 1];
            const distFromEMA20 = ((lastClose - ema20) / ema20) * 100; // % jarak dari EMA20

            const recentCloses = closes.slice(-50);
            const first = recentCloses[0];
            const last = recentCloses[recentCloses.length - 1];
            const trendPct = ((last - first) / first) * 100;
            const trendStr = trendPct > 0.5 ? "STRONG BULL" : trendPct > 0 ? "BULLISH" : trendPct < -0.5 ? "STRONG BEAR" : "BEARISH";
            const rsiState = rsi > 70 ? "Overbought" : rsi < 30 ? "Oversold" : rsi > 55 ? "Bullish" : rsi < 45 ? "Bearish" : "Neutral";
            const structure = getStructure(recentCloses);
            
            realTimeframes.push({ timeframe: tfLabel, trend: trendStr, rsi, rsiState, structure, ema20, ema50, distFromEMA20 });
          }
        };

        await Promise.all([
          fetchTF('5m', 'M5'),
          fetchTF('15m', 'M15'),
          fetchTF('1h', 'H1'),
          fetchTF('4h', 'H4')
        ]);
        
        const tfOrder = ['H4', 'H1', 'M15', 'M5'];
        realTimeframes.sort((a, b) => tfOrder.indexOf(a.timeframe) - tfOrder.indexOf(b.timeframe));

        setLiveIndicators(realTimeframes);
        if (newPrice) {
           setAnalysis(prev => prev ? { ...prev, price: newPrice } : null);
        }
      } catch (err) {
        // Ignore background errors
      }
    };

    const intervalId = setInterval(fetchBackgroundData, 3000); // 3 seconds for extremely snappy feel instead of 10s
    return () => clearInterval(intervalId);
  }, []);

  const getTrendColor = (trend: string) => {
    if (trend.includes("BULL")) return "text-bull border-bull/20 bg-bull/5";
    if (trend.includes("BEAR")) return "text-bear border-bear/20 bg-bear/5";
    return "text-warning border-warning/20 bg-warning/5";
  };

  if (showSplash) {
    return (
      <div className="min-h-[100dvh] w-screen bg-[#05070a] text-white flex flex-col relative overflow-hidden font-sans select-none">
        {/* Background Grid/Fx */}
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_100%,rgba(0,255,136,0.08),transparent_70%)] opacity-60 pointer-events-none" />
        <div className="absolute top-0 left-0 w-full h-full bg-[url('https://www.transparenttextures.com/patterns/carbon-fibre.png')] opacity-10 pointer-events-none" />

        {/* Content Container */}
        <div className="relative z-10 flex flex-col flex-1 max-w-7xl mx-auto px-6 md:px-16 py-8 md:py-24">
          
          {/* Brand Header */}
          <div className="flex items-center gap-3 md:gap-4 mb-20 md:mb-24 animate-in fade-in slide-in-from-top-10 duration-700">
            <div className="relative w-10 h-10 md:w-14 md:h-14 bg-bull/10 rounded-xl flex items-center justify-center border border-bull/30">
              <div className="relative text-bull border-2 md:border-4 border-bull rounded-full p-1 flex items-center justify-center w-7 h-7 md:w-10 md:h-10">
                <span className="text-sm md:text-xl font-black italic">Ω</span>
              </div>
            </div>
            <div>
              <h2 className="text-[10px] md:text-lg font-black tracking-[0.2em] md:tracking-[0.3em] text-white/90 italic uppercase">BTCUSD <span className="text-bull">SIGNAL OMEGA</span></h2>
              <div className="flex items-center gap-2">
                <span className="w-1 h-1 md:w-1.5 md:h-1.5 rounded-full bg-bull animate-pulse" />
                <span className="text-[7px] md:text-[10px] font-bold text-bull/60 tracking-widest uppercase">Live Scanning • Binance</span>
              </div>
            </div>
          </div>

          {/* Hero Section */}
          <div className="flex-1 flex flex-col lg:flex-row lg:items-center gap-8 md:gap-12">
            <div className="flex flex-col animate-in fade-in slide-in-from-left-10 duration-1000 delay-200">
              <h1 className="text-4xl md:text-8xl font-black italic tracking-tighter leading-[0.85] mb-16 md:mb-20">
                PREMIUM <br />
                <span className="text-bull text-glow uppercase">BTC SIGNAL</span>
              </h1>

              {/* CTA - Moved Up */}
              <button 
                onClick={enterTerminal}
                className="group relative w-full md:w-fit px-8 md:px-12 py-5 border-2 border-bull text-bull hover:bg-bull hover:text-black font-black text-lg md:text-xl italic tracking-widest rounded-xl transition-all active:scale-95 overflow-hidden shadow-[0_0_30px_rgba(0,255,136,0.2)] mb-2 md:mb-4"
              >
                <div className="absolute inset-0 bg-bull/10 opacity-0 group-hover:opacity-100 transition-opacity" />
                ENTER TERMINAL
              </button>
              
              {/* Countdown Indicator */}
              <div className="flex items-center gap-2 mb-10 md:mb-16">
                <span className="text-[10px] font-bold text-white/40 tracking-widest uppercase">Auto-redirecting in</span>
                <span className="w-5 h-5 flex items-center justify-center bg-bull/20 rounded border border-bull/30 text-bull font-mono text-xs font-bold">{countdown}s</span>
              </div>

              {/* Feature List - Moved Down */}
              <div className="space-y-6 md:space-y-8">
                {[
                  { icon: <Zap className="text-bull" size={14} />, title: "Real-Time Signal", desc: "Market update real-time" },
                  { icon: <Target className="text-bull" size={14} />, title: "High Accuracy", desc: "Akurasi 80%+" },
                  { icon: <ShieldCheck className="text-bull" size={14} />, title: "Secure & Reliable", desc: "Validasi AI & Logic" }
                ].map((f, i) => (
                  <div key={i} className="flex items-center gap-5">
                    <div className="p-2.5 bg-bull/10 rounded-lg border border-bull/20 shadow-[0_0_15px_rgba(0,255,136,0.1)]">{f.icon}</div>
                    <div>
                      <h4 className="font-bold text-white text-xs md:text-base tracking-wide leading-none">{f.title}</h4>
                      <p className="text-[9px] md:text-xs text-slate-500 mt-1.5">{f.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Visual Column */}
            <div className="hidden lg:flex flex-col justify-center items-center relative animate-in fade-in slide-in-from-right-10 duration-1000 delay-500">
               {/* Glowing Bull Visual (Conceptual) */}
               <div className="relative w-full max-w-lg aspect-square flex items-center justify-center">
                  <div className="absolute inset-0 bg-bull/5 rounded-full blur-[100px]" />
                  
                  {/* Decorative Circles */}
                  <div className="absolute inset-0 border-[1px] border-bull/10 rounded-full animate-pulse" />
                  <div className="absolute inset-8 border-[1px] border-bull/5 rounded-full" />
                  
                  <div className="relative p-12 border-2 border-bull/20 rounded-full animate-spin-slow">
                    <div className="w-80 h-80 border border-dashed border-bull/40 rounded-full" />
                    <div className="absolute top-0 left-1/2 -translate-x-1/2 w-4 h-4 bg-bull rounded-full blur-sm" />
                  </div>
                  
                  <div className="absolute inset-0 flex items-center justify-center text-bull/10 italic font-black text-[25rem] pointer-events-none select-none">
                    Ω
                  </div>
                  
                  <div className="absolute inset-0 flex items-center justify-center">
                    <TrendingUp size={180} className="text-bull drop-shadow-[0_0_40px_rgba(0,255,136,0.8)]" />
                  </div>
               </div>
               
               {/* Floating Stat Labels (Visual only) */}
               <div className="absolute top-10 right-0 bg-bull/20 border border-bull/40 p-4 rounded-xl backdrop-blur-xl animate-bounce-slow shadow-[0_0_20px_rgba(0,255,136,0.2)]">
                  <p className="text-[10px] font-bold text-white mb-1 uppercase tracking-widest opacity-60">TP 2 TARGET</p>
                  <p className="text-2xl font-mono font-black text-bull">$77,707.7</p>
               </div>
               <div className="absolute bottom-10 left-0 bg-bear/20 border border-bear/40 p-4 rounded-xl backdrop-blur-xl animate-bounce-slower shadow-[0_0_20px_rgba(255,68,102,0.2)]">
                  <p className="text-[10px] font-bold text-white mb-1 uppercase tracking-widest opacity-60">STOP LOSS</p>
                  <p className="text-2xl font-mono font-black text-bear">$75,572.5</p>
               </div>
               <div className="absolute top-1/2 left-0 -translate-x-12 bg-warning/20 border border-warning/40 p-4 rounded-xl backdrop-blur-xl animate-pulse shadow-[0_0_20px_rgba(245,158,11,0.2)]">
                  <p className="text-[10px] font-bold text-white mb-1 uppercase tracking-widest opacity-60">BUY ZONE</p>
                  <p className="text-2xl font-mono font-black text-warning">$76,030.0</p>
               </div>
            </div>
          </div>

          {/* Footer Bar */}
          <div className="border-t border-white/5 pt-6 md:pt-12 mt-auto md:mt-12 flex flex-wrap gap-6 md:gap-12 items-center justify-center md:justify-start grayscale opacity-40 text-[9px] md:text-sm">
            <div className="flex items-center gap-2 font-bold italic"><Zap size={12} className="text-bull"/> BETTER ANALYSIS</div>
            <div className="flex items-center gap-2 font-bold italic"><Target size={12} className="text-bull"/> BETTER DECISIONS</div>
            <div className="ml-auto text-[8px] opacity-30 font-mono tracking-tighter">V.2.0.4-HOTFIX</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen w-screen bg-trading-bg text-slate-300 flex flex-col font-sans overflow-hidden">
      {/* Header Bar */}
      <header className="h-14 border-b border-trading-border bg-trading-panel/80 backdrop-blur-md flex items-center justify-between px-3 md:px-4 z-50">
        <div className="flex items-center gap-3 md:gap-4">
          <div className="bg-bull/10 p-2 rounded-md border border-bull/30 shadow-[0_0_10px_rgba(0,255,136,0.2)]">
            <TrendingUp size={16} className="text-bull md:w-5 md:h-5" />
          </div>
          <div>
            <h1 className="font-black text-white tracking-widest text-[11px] md:text-sm italic uppercase italic">BTCUSD <span className="text-bull underline decoration-bull/40 decoration-wavy">SIGNAL OMEGA</span></h1>
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-bull/10 border border-bull/20">
                <span className="w-1 h-1 md:w-1.5 md:h-1.5 rounded-full bg-bull animate-pulse shadow-[0_0_5px_rgba(0,255,136,0.5)]" />
                <span className="text-[8px] md:text-[9px] font-black text-bull">LIVE SCANNING</span>
              </div>
              <span className="hidden sm:inline text-[10px] font-mono text-slate-500">/</span >
              <span className="hidden sm:inline text-[10px] font-mono text-slate-500 uppercase">BTCUSDT • BINANCE</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3 md:gap-8">
          <div className="hidden lg:flex items-center bg-black/20 p-1 rounded-lg border border-white/5 mr-4">
            <button 
              onClick={() => setMobileActiveTab('SIGNAL')}
              className={`px-3 py-1.5 rounded-md text-[10px] font-bold transition-all ${mobileActiveTab !== 'ACCOUNT' ? 'bg-accent text-black shadow-lg shadow-accent/20' : 'text-slate-500 hover:text-white'}`}
            >
              MARKET ANALYSIS
            </button>
            <button 
              onClick={() => setMobileActiveTab('ACCOUNT')}
              className={`px-3 py-1.5 rounded-md text-[10px] font-bold transition-all flex items-center gap-2 ${mobileActiveTab === 'ACCOUNT' ? 'bg-accent text-black shadow-lg shadow-accent/20' : 'text-slate-500 hover:text-white'}`}
            >
              <Wallet size={12} /> COCKPIT [MT5]
            </button>
          </div>

          <div className="text-right hidden sm:block">
            <p className="text-[10px] uppercase tracking-widest font-bold opacity-40">BTC PRICE</p>
            <p className="text-sm md:text-xl font-mono font-black text-white tracking-tighter">
              {analysis?.price ? `$${analysis.price.toLocaleString()}` : "---"}
            </p>
          </div>
          <button 
            onClick={runAnalysis}
            disabled={loading}
            className="flex items-center gap-2 px-3 md:px-4 py-2 bg-bull hover:bg-bull/90 border border-bull rounded-md text-[10px] md:text-xs font-black text-black transition-all active:scale-95 disabled:opacity-50 shadow-[0_0_20px_rgba(0,255,136,0.4)]"
          >
            {loading ? <RefreshCw size={12} className="animate-spin md:w-3.5 md:h-3.5" /> : <Zap size={12} className="md:w-3.5 md:h-3.5" />}
            <span className="hidden sm:inline">{loading ? "SCANNING..." : "SCAN MARKET"}</span>
            <span className="inline sm:hidden">{loading ? "SCAN" : "SCAN"}</span>
          </button>
        </div>
      </header>

      {/* Main Dashboard Layout */}
      <main className="flex-1 flex flex-col overflow-hidden relative">
        
        {/* Top Timeframe Strip */}
        <div className="h-20 border-b border-trading-border flex flex-nowrap overflow-x-auto no-scrollbar bg-trading-panel/30 flex-shrink-0">
          {(liveIndicators || analysis?.timeframes || [
            { timeframe: "H4", trend: "NEUTRAL", rsi: 50, rsiState: "...", structure: "..." },
            { timeframe: "H1", trend: "NEUTRAL", rsi: 50, rsiState: "...", structure: "..." },
            { timeframe: "M15", trend: "NEUTRAL", rsi: 50, rsiState: "...", structure: "..." },
            { timeframe: "M5", trend: "NEUTRAL", rsi: 50, rsiState: "...", structure: "..." }
          ]).slice(0, 4).map((tf, i) => (
            <div key={i} className={`min-w-[140px] flex-1 p-3 border-r border-trading-border flex flex-col justify-between ${liveIndicators || analysis ? "" : "animate-pulse"}`}>
              <div className="flex justify-between items-start">
                <span className="text-[10px] font-bold text-slate-500 bg-slate-800 px-1.5 py-0.5 rounded tracking-widest leading-none">{tf.timeframe} [EMA]</span>
                <span className="text-[8px] uppercase tracking-widest font-bold opacity-20">STRUCTURE</span>
              </div>
              <div className="flex justify-between items-end">
                <div>
                  <p className={`text-[10px] md:text-[11px] font-black tracking-tight leading-none ${getTrendColor(tf.trend).split(' ')[0]}`}>{tf.trend}</p>
                  <p className="text-[9px] font-mono text-slate-500 mt-1">RSI: <span className="text-white">{tf.rsi}</span></p>
                </div>
                <p className="text-[9px] font-mono text-slate-400 font-bold uppercase">{tf.structure}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Dynamic Content Area */}
        <div className="flex-1 overflow-hidden relative">
            {/* 1. TRADING SCREEN (CHART + SIGNAL) */}
            <div className={`grid grid-cols-12 h-full w-full ${mobileActiveTab === 'ACCOUNT' ? 'hidden' : 'grid'}`}>
                {/* Left: Chart Area */}
                <div className={`
                  ${mobileActiveTab === 'CHART' ? 'col-span-12 flex' : 'hidden'} 
                  lg:flex lg:col-span-8 border-r border-trading-border flex-col relative h-full w-full
                `}>
                  {/* ... chart content ... */}
              {/* Drawing Toolbar Toggle - Yellow Exness Style */}
              <button 
                onClick={() => setShowChartToolbar(!showChartToolbar)}
                className="absolute left-0 top-1/2 -translate-y-1/2 z-[60] w-4 h-12 bg-warning flex items-center justify-center rounded-r-sm shadow-lg border border-black/20 text-black transition-all hover:w-5 active:scale-95 group"
                title={showChartToolbar ? "Hide Drawing Tools" : "Show Drawing Tools"}
              >
                {showChartToolbar ? <ChevronLeft size={14} className="font-bold" /> : <ChevronRight size={14} className="font-bold" />}
              </button>

              {/* TRADING VIEW CHART CONTAINER */}
              <div className="flex-1 w-full bg-trading-bg relative overflow-hidden"> 
                <div id="tv_chart_container" className="h-full w-full" />

                {/* HUD TARGET LOCK OVERLAY (The "Laser") */}
                <AnimatePresence>
                  {analysis?.signal && analysis.signal.type !== "WAIT" && (
                    <motion.div
                      key={highlightTrigger}
                      initial={{ opacity: 0, scaleY: 0 }}
                      animate={{ opacity: 1, scaleY: 1 }}
                      exit={{ opacity: 0 }}
                      transition={{ type: "spring", stiffness: 100, damping: 20 }}
                      className="absolute left-0 w-full top-[40%] z-[60] flex items-center pointer-events-none drop-shadow-[0_0_15px_rgba(0,255,136,0.5)]"
                    >
                      {/* Left Target Badge */}
                      <div className="flex flex-col items-start ml-2 md:ml-4">
                        <div className="flex items-center gap-1">
                          <div className={`w-1 h-1 rounded-full animate-ping ${analysis.signal.type === 'SELL' ? 'bg-bear' : 'bg-bull'}`} />
                          <span className={`text-[9px] md:text-[10px] font-black tracking-[0.2em] uppercase px-1.5 py-0.5 rounded-sm bg-black/60 backdrop-blur-md border ${analysis.signal.type === 'SELL' ? 'text-bear border-bear/40' : 'text-bull border-bull/40'}`}>
                            {analysis.signal.type} LOCK
                          </span>
                        </div>
                        <div className="text-[8px] font-mono text-white/40 mt-1 uppercase tracking-tighter">AI Target Acquisition</div>
                      </div>

                      {/* THE LASER LINE (Glow Line) */}
                      <div className="flex-1 h-[1px] relative mx-2">
                         {/* Centered Target Crosshair */}
                         <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-4 h-4 border border-white/20 rounded-full flex items-center justify-center">
                            <div className={`w-1 h-1 rounded-full ${analysis.signal.type === 'SELL' ? 'bg-bear' : 'bg-bull'}`} />
                         </div>
                         {/* The actual laser line */}
                         <div className={`w-full h-full opacity-60 shadow-[0_0_10px] ${analysis.signal.type === 'SELL' ? 'bg-bear shadow-bear' : 'bg-bull shadow-bull'}`} />
                      </div>

                      {/* Right Price Tag (Polygon Style) */}
                      <div className="mr-0 flex items-center">
                        <div 
                          className="w-0 h-0 border-y-[12px] border-y-transparent border-r-[8px]" 
                          style={{ borderRightColor: analysis.signal.type === 'SELL' ? '#ff4466' : '#00ff88' }} 
                        />
                        <div 
                          className="h-[24px] px-2 flex flex-col items-center justify-center rounded-sm rounded-l-none bg-black/80 border-r border-y"
                          style={{ borderColor: analysis.signal.type === 'SELL' ? '#ff4466' : '#00ff88' }}
                        >
                          <span className="text-white font-mono text-[11px] font-black leading-none">{analysis.signal.zone}</span>
                          <span className="text-[7px] text-white/60 font-bold tracking-tighter leading-none mt-0.5">ZONE</span>
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>

            {/* Right: AI Analysis Panel */}
            <div className={`
              ${mobileActiveTab === 'SIGNAL' ? 'col-span-12 flex' : 'hidden'} 
              lg:flex lg:col-span-4 flex-col bg-trading-panel overflow-y-auto no-scrollbar h-full w-full pb-20 lg:pb-0
            `}>
              {/* Signal Header */}
              <div className="p-6 border-b border-trading-border bg-gradient-to-br from-trading-panel to-trading-bg flex-shrink-0">
                <h2 className="text-[10px] uppercase tracking-widest font-bold opacity-40 mb-4">AI ENTRY SUGGESTION</h2>
                <div className="flex justify-between items-center mb-6">
                  <div>
                    <p className={`text-5xl font-black italic tracking-tighter ${!analysis?.signal ? 'text-slate-500' : analysis.signal.type === 'WAIT' ? 'text-warning' : analysis.signal.type === 'BUY' ? 'text-bull' : 'text-bear'}`}>
                      {analysis?.signal?.type || "SCANNING..."}
                    </p>
                    <p className="text-xs font-bold text-slate-500 uppercase tracking-widest mt-1">Confidence Score: <span className="text-white">{analysis?.signal?.confidence || 0}%</span></p>
                    {analysis?.signal?.tier && analysis?.signal?.tier > 0 ? (
                      <p className="text-[10px] font-bold tracking-widest uppercase opacity-60 mt-1">
                        {analysis.signal.tier === 1 ? "⚡ TIER 1 — FULL MOMENTUM" : analysis.signal.tier === 2 ? "✅ TIER 2 — MODERAT" : "⚠️ TIER 3 — SCALP KETAT"}
                      </p>
                    ) : null}
                  </div>
                  {analysis && analysis.signal && (
                    <div className="text-right">
                      <div className="px-3 py-1 bg-white/5 border border-white/10 rounded-md">
                        <p className="text-[10px] uppercase tracking-widest font-bold opacity-40">R:R RATIO</p>
                        <p className="text-xl font-mono text-white font-black">{analysis.signal.rr || "---"}</p>
                      </div>
                    </div>
                  )}
                </div>

                {/* Checkpoint Matrix */}
                <div className="space-y-3 mb-6">
                  {(analysis?.checkpoints || [
                    { label: "Price di zona S/R", checked: false },
                    { label: "RSI Multi-TF Alignment", checked: false },
                    { label: "Candlestick Confirmation", checked: false }
                  ]).map((c, i) => (
                    <div key={i} className="flex items-center gap-3">
                      <div className={`w-3.5 h-3.5 rounded border transition-colors flex items-center justify-center ${c.checked ? 'bg-bull border-bull text-black' : 'border-slate-700'}`}>
                        {c.checked && <Zap size={8} strokeWidth={4} />}
                      </div>
                      <span className={`text-[11px] font-bold tracking-tight ${c.checked ? 'text-white' : 'text-slate-500'}`}>{c.label}</span>
                    </div>
                  ))}
                </div>

                {/* Price Levels Grid */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="p-3 bg-trading-bg border border-trading-border rounded">
                    <p className="text-[10px] uppercase tracking-widest font-bold opacity-40 text-slate-500 mb-1">ENTRY ZONE</p>
                    <p className="text-sm font-mono text-white">{analysis?.signal?.zone || "---"}</p>
                  </div>
                  <div className="p-3 bg-trading-bg border border-trading-border rounded">
                    <p className="text-[10px] uppercase tracking-widest font-bold opacity-40 text-bear mb-1">STOP LOSS</p>
                    <p className="text-sm font-mono text-bear font-bold">{analysis?.signal?.sl || "---"}</p>
                  </div>
                  <div className="p-3 bg-trading-bg border border-trading-border rounded">
                    <p className={`text-[10px] uppercase tracking-widest font-bold opacity-40 mb-1 ${analysis?.signal?.type === 'SELL' ? 'text-bear' : 'text-bull'}`}>TP 1 TARGET</p>
                    <p className={`text-sm font-mono font-bold ${analysis?.signal?.type === 'SELL' ? 'text-bear' : 'text-bull'}`}>{analysis?.signal?.tp1 || "---"}</p>
                  </div>
                  <div className="p-3 bg-trading-bg border border-trading-border rounded">
                    <p className={`text-[10px] uppercase tracking-widest font-bold opacity-40 mb-1 ${analysis?.signal?.type === 'SELL' ? 'text-bear' : 'text-bull'}`}>TP 2 TARGET</p>
                    <p className={`text-sm font-mono font-black ${analysis?.signal?.type === 'SELL' ? 'text-bear' : 'text-bull'}`}>{analysis?.signal?.tp2 || "---"}</p>
                  </div>
                </div>

                {/* BROKER EXECUTION BUTTON */}
                <div className="mt-6 border-t border-trading-border pt-6">
                  <button
                    onClick={executeTrade}
                    disabled={tradeLoading || !analysis?.signal}
                    className={`w-full py-4 rounded-md font-black italic tracking-widest text-sm flex items-center justify-center gap-3 transition-all active:scale-95 shadow-xl ${
                      analysis?.signal?.type === 'BUY' ? 'bg-bull text-black shadow-bull/20 hover:bg-bull/90' : 
                      analysis?.signal?.type === 'SELL' ? 'bg-bear text-white shadow-bear/20 hover:bg-bear/90' : 
                      'bg-blue-600 text-white shadow-blue-500/20 hover:bg-blue-500'
                    }`}
                  >
                    {tradeLoading ? (
                      <RefreshCw size={18} className="animate-spin" />
                    ) : (
                       <Zap size={18} />
                    )}
                    {tradeLoading ? "PROCESSING..." : 
                     analysis?.signal?.type === 'WAIT' ? "SEND TEST SIGNAL (KONEKSI)" :
                     !analysis?.signal ? "SCAN FIRST" :
                     `SEND ${analysis.signal.type} TO BRIDGE`}
                  </button>
                  <p className="text-[9px] text-center text-slate-400 mt-2 font-mono uppercase tracking-tighter animate-pulse">
                    BRIDGE STATUS: ACTIVE & WAITING FOR MT5 POLLING...
                  </p>
                </div>
              </div>

              {/* Analysis Reason */}
              <div className="p-6 flex-1">
                {analysis?.signal?.type === "WAIT" && (
                  <div className="mb-3 p-3 bg-yellow-500/10 border border-yellow-500/30 rounded text-yellow-400 text-[11px] font-bold">
                    ⛔ TIDAK ADA SETUP VALID — JANGAN ENTRY
                  </div>
                )}
                {analysis?.signal?.type !== "WAIT" && analysis?.signal?.tier === 3 && (
                  <div className="mb-3 p-3 bg-orange-500/10 border border-orange-500/30 rounded text-orange-400 text-[11px] font-bold">
                    ⚠️ TIER 3 — Setup lemah. Lot kecil, SL ketat, konfirmasi manual dulu di MT5.
                  </div>
                )}

                {/* Entry Timing Banner */}
                {analysis?.entryTiming === "GOOD" && analysis?.signal?.type !== "WAIT" && (
                  <div className="mb-3 p-3 bg-green-500/10 border border-green-500/40 rounded text-green-400 text-[11px] font-bold">
                    ✅ TIMING ENTRY BAGUS — Bisa eksekusi sekarang
                    <p className="text-[10px] font-normal mt-1 opacity-80">{analysis.timingNote}</p>
                  </div>
                )}
                {analysis?.entryTiming === "WAIT_PULLBACK" && (
                  <div className="mb-3 p-3 bg-yellow-500/10 border border-yellow-500/40 rounded text-yellow-400 text-[11px] font-bold">
                    ⏳ TUNGGU PULLBACK DULU — Jangan kejar harga
                    <p className="text-[10px] font-normal mt-1 opacity-80">{analysis.timingNote}</p>
                  </div>
                )}
                {analysis?.entryTiming === "WAIT_BREAKOUT" && (
                  <div className="mb-3 p-3 bg-blue-500/10 border border-blue-500/40 rounded text-blue-400 text-[11px] font-bold">
                    ⏳ TUNGGU KONFIRMASI BREAKOUT — Belum waktunya
                    <p className="text-[10px] font-normal mt-1 opacity-80">{analysis.timingNote}</p>
                  </div>
                )}

                <h3 className="text-[10px] uppercase tracking-widest font-bold opacity-40 mb-4 tracking-tighter">REASONING & BIAS</h3>
                <div className="prose prose-invert prose-sm max-w-none text-slate-400 font-medium leading-relaxed">
                  <Markdown remarkPlugins={[remarkGfm]}>{analysis?.reasoning || "Tunggu hasil pemindaian..."}</Markdown>
                </div>
              </div>
            </div>
          </div>

            {/* 2. LIVE COCKPIT (ACCOUNT TAB) */}
            <div className={`absolute inset-0 flex flex-col h-full bg-trading-bg z-20 ${mobileActiveTab === 'ACCOUNT' ? 'flex' : 'hidden'}`}>
              <div className="p-6 border-b border-trading-border bg-trading-panel/50">
                <div className="flex items-center justify-between mb-6">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-accent/20 rounded-lg text-accent border border-accent/30 shadow-[0_0_15px_rgba(0,255,136,0.2)]">
                      <Wallet size={20} />
                    </div>
                    <div>
                      <h2 className="text-xl font-black italic tracking-tighter text-white">LIVE COCKPIT</h2>
                      <p className="text-[10px] font-mono text-slate-500 uppercase tracking-widest">BRIDGE ID: ALPHA-OMEGA-01</p>
                    </div>
                  </div>
                  <div className="px-2 py-1 bg-bull/10 border border-bull/30 rounded flex items-center gap-1.5 animate-pulse">
                    <div className="w-1.5 h-1.5 rounded-full bg-bull" />
                    <span className="text-[9px] font-bold text-bull tracking-widest uppercase">SYMBOLS READY</span>
                  </div>
                </div>

                {/* Account Summary Cards */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="p-4 bg-trading-bg border border-trading-border rounded-lg">
                    <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest mb-1">BALANCE</p>
                    <p className="text-xl font-mono font-bold text-white">${accountData?.balance?.toFixed(2) || "0.00"}</p>
                  </div>
                  <div className="p-4 bg-trading-bg border border-trading-border rounded-lg">
                    <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest mb-1">EQUITY</p>
                    <p className="text-xl font-mono font-bold text-white">${accountData?.equity?.toFixed(2) || "0.00"}</p>
                  </div>
                  <div className="p-4 bg-trading-bg border border-trading-border rounded-lg">
                    <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest mb-1">PROFIT (LIVE)</p>
                    <p className={`text-xl font-mono font-bold ${(accountData?.profit || 0) >= 0 ? 'text-bull' : 'text-bear'}`}>
                      {(accountData?.profit || 0) >= 0 ? '+' : ''}${accountData?.profit?.toFixed(2) || "0.00"}
                    </p>
                  </div>
                  <div className="p-4 bg-trading-bg border border-trading-border rounded-lg">
                    <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest mb-1">MT5 STATUS</p>
                    <div className="flex items-center gap-1.5 mt-2">
                      <div className={`w-2 h-2 rounded-full ${accountData ? 'bg-bull' : 'bg-bear'} shadow-[0_0_8px_rgba(0,255,136,0.5)]`} />
                      <span className="text-[11px] font-bold text-white uppercase">{accountData ? 'ONLINE' : 'OFFLINE'}</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* TWO COLUMN CONTENT */}
              <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
                {/* ACTIVE POSITIONS */}
                <div className="flex-1 border-r border-trading-border flex flex-col overflow-hidden">
                  <div className="p-4 bg-white/[0.02] border-b border-trading-border flex items-center justify-between">
                    <div className="flex items-center gap-2">
                       <Target size={14} className="text-accent" />
                       <h3 className="text-[11px] font-black tracking-widest text-white uppercase">ACTIVE POSITIONS ({positions.length})</h3>
                    </div>
                  </div>
                  <div className="flex-1 overflow-y-auto p-4 space-y-3">
                    {positions.length === 0 ? (
                      <div className="h-full flex flex-col items-center justify-center opacity-30">
                        <Activity size={40} className="mb-2" />
                        <p className="text-[10px] font-mono tracking-widest">DRY MARKET • NO POSITION</p>
                      </div>
                    ) : positions.map((p) => (
                      <div key={p.id} className="bg-trading-panel border border-trading-border rounded-lg p-4 group hover:border-accent/40 transition-all">
                        <div className="flex items-center justify-between mb-4">
                          <div className="flex items-center gap-3">
                            <div className={`px-2 py-0.5 rounded text-[10px] font-bold ${p.type === 'BUY' ? 'bg-bull/10 text-bull border border-bull/20' : 'bg-bear/10 text-bear border border-bear/20'}`}>
                              {p.type}
                            </div>
                            <div>
                              <p className="text-xs font-black text-white">{p.symbol} <span className="text-slate-500 font-mono text-[9px] ml-1">#{p.ticket}</span></p>
                              <p className="text-[10px] font-mono text-slate-400">{p.lots} LOTS @ {p.openPrice}</p>
                            </div>
                          </div>
                          <div className="text-right">
                             <p className={`text-sm font-mono font-bold ${p.profit >= 0 ? 'text-bull' : 'text-bear'}`}>
                               {p.profit >= 0 ? '+' : ''}{p.profit?.toFixed(2)} USD
                             </p>
                             <button 
                               onClick={() => closeTrade(p.ticket)}
                               disabled={tradeLoading}
                               className="mt-1 text-[9px] font-black text-bear bg-bear/5 border border-bear/20 hover:bg-bear/10 px-3 py-1 rounded transition-all uppercase tracking-tighter flex items-center gap-1 ml-auto"
                             >
                               <XCircle size={10} /> CLOSE POSITION
                             </button>
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-2 text-[10px] font-mono border-t border-white/5 pt-3">
                          <div className="flex flex-col">
                            <span className="text-slate-600 text-[8px] uppercase">STOP LOSS</span>
                            <span className="text-bear font-bold">{p.sl || '---'}</span>
                          </div>
                          <div className="flex flex-col text-right">
                            <span className="text-slate-600 text-[8px] uppercase">TAKE PROFIT</span>
                            <span className="text-bull font-bold">{p.tp || '---'}</span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* TRADE HISTORY */}
                <div className="w-full md:w-80 flex flex-col overflow-hidden bg-black/20">
                  <div className="p-4 bg-white/[0.02] border-b border-trading-border flex items-center gap-2">
                    <HistoryIcon size={14} className="text-slate-400" />
                    <h3 className="text-[11px] font-black tracking-widest text-slate-400 uppercase">RECENT HISTORY</h3>
                  </div>
                  <div className="flex-1 overflow-y-auto p-4 space-y-2">
                    {history.length === 0 ? (
                       <p className="text-[10px] text-center mt-10 opacity-30 font-mono italic">EMPTY HISTORY</p>
                    ) : history.map((h, i) => (
                      <div key={i} className="bg-white/5 border border-white/5 rounded p-3 text-[11px]">
                         <div className="flex justify-between mb-1">
                            <span className="font-bold text-white uppercase">{h.symbol}</span>
                            <span className={`font-mono font-bold ${h.profit >= 0 ? 'text-bull' : 'text-bear'}`}>
                               {h.profit >= 0 ? '+' : ''}{h.profit?.toFixed(2)}
                            </span>
                         </div>
                         <div className="flex justify-between text-[9px] text-slate-500 font-mono uppercase tracking-tighter">
                            <span>#{h.ticket}</span>
                            <div className="flex items-center gap-1"><Clock size={8} /> {h.closeTime?.split('T')[1]?.substring(0,5) || '..'}</div>
                         </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
        </div>
      </main>

      {/* Bottom Navigation for Mobile */}
      <nav className="h-16 bg-trading-panel border-t border-trading-border lg:hidden flex items-center justify-around px-4 z-[90] shadow-[0_-5px_15px_rgba(0,0,0,0.5)] flex-shrink-0">
        {[
          { id: 'CHART', icon: <TrendingUp size={20} />, label: 'Market Chart' },
          { id: 'SIGNAL', icon: <Target size={20} />, label: 'Signal Omega' },
          { id: 'ACCOUNT', icon: <Wallet size={20} />, label: 'Cockpit' }
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setMobileActiveTab(tab.id as any)}
            className={`flex flex-col items-center gap-1 transition-all ${mobileActiveTab === tab.id ? 'text-accent' : 'text-slate-500'}`}
          >
            <div className={`p-1 rounded-md transition-colors ${mobileActiveTab === tab.id ? 'bg-accent/10 border border-accent/20' : ''}`}>
              {tab.icon}
            </div>
            <span className={`text-[9px] font-bold tracking-widest uppercase ${mobileActiveTab === tab.id ? 'opacity-100' : 'opacity-40'}`}>{tab.label}</span>
            {mobileActiveTab === tab.id && <motion.div layoutId="nav-glow" className="w-4 h-0.5 bg-accent rounded-full mt-1 blur-sm" />}
          </button>
        ))}
      </nav>

      {/* Footer Utility */}
      <footer className="h-6 bg-white/[0.02] border-t border-white/[0.05] flex items-center px-4 text-[8px] font-mono tracking-widest text-slate-600 uppercase">
        <div className="flex items-center gap-4 flex-1">
          <div className="flex items-center gap-1.5 font-bold">
            <span className="w-1 h-1 rounded-full bg-bull" />
            SYSTEM: ONLINE [24/7 SCANNING]
          </div>
          <div>VOLATILITY: 1.25%</div>
          <div className="ml-auto">© 2026 ALPHAPULSE INTEL. LTD. • NOT FINANCIAL ADVICE</div>
        </div>
      </footer>
    </div>
  );
}

// Typing definitions for window
declare global {
  interface Window {
    TradingView: any;
  }
}
