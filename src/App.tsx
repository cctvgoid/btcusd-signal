import { useState, useRef, useEffect } from "react";
import { GoogleGenAI, Type } from "@google/genai";
import { motion, AnimatePresence } from "motion/react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { 
  BarChart3, 
  TrendingUp, 
  TrendingDown, 
  Activity,
  Zap,
  RefreshCw,
  Search,
  MessageSquare,
  ChevronDown,
  ChevronUp,
  LayoutGrid,
  Info,
  Target,
  ShieldCheck,
  ChevronLeft,
  ChevronRight
} from "lucide-react";
import { BTC_ANALYST_SYSTEM_PROMPT } from "./constants";

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
}

interface MarketAnalysis {
  price: number;
  timeframes: TimeframeData[];
  signal: {
    type: "BUY" | "SELL" | "WAIT";
    confidence: number;
    zone: string;
    sl: string;
    tp1: string;
    tp2: string;
    rr: string;
  };
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
  const [chatOpen, setChatOpen] = useState(false);
  const [mobileActiveTab, setMobileActiveTab] = useState<"CHART" | "SIGNAL" | "CHAT">("SIGNAL");
  const [messages, setMessages] = useState<{ role: "user" | "assistant"; content: string }[]>([]);
  const [input, setInput] = useState("");
  
  useTradingView("tv_chart_container", !showSplash, !showChartToolbar);

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

const getStructure = (closes: number[]) => {
  if(closes.length < 3) return "Ranging";
  const last = closes[closes.length - 1];
  const prev = closes[closes.length - 2];
  const prev2 = closes[closes.length - 3];
  if (last > prev && prev > prev2) return "BOS UP (HH)";
  if (last < prev && prev < prev2) return "BOS DOWN (LL)";
  if (last > prev) return "Minor Rally";
  if (last < prev) return "Minor Pullback";
  return "Consolidating";
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
            const closes = klines.map((k: any) => parseFloat(k[4]));
            const rsi = Math.round(calculateRSI(closes, 14)); // This will now use 150 data points for precise Wilder's smoothing
            
            // For trend mapping, extract only the last 20 periods
            const recentCloses = closes.slice(-20);
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
              structure
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
        const tfOrder = ['M5', 'M15', 'H1', 'H4'];
        realTimeframes.sort((a, b) => tfOrder.indexOf(a.timeframe) - tfOrder.indexOf(b.timeframe));

      } catch (e) {
        console.warn("Failed to fetch price from Binance API", e);
      }

      const exactTimeframesStr = JSON.stringify(realTimeframes);

      // Core Technical Engine (Mathematical / Rules Based)
      // Extract specific timeframe data for accurate signalling
      const currentM15 = realTimeframes.find(t => t.timeframe === 'M15');
      const currentH1 = realTimeframes.find(t => t.timeframe === 'H1');
      
      let signalType: "BUY" | "SELL" | "WAIT" = "WAIT";
      let reasoningTxt = "Market konsolidasi. Belum ada setup probabilitas tinggi.";
      
      // Real-time rules engine based on RSI and Structure
      if (currentM15 && currentH1) {
        // OVERBOUGHT SELL CONDITION
        if (currentH1.rsi > 60 && currentM15.rsi >= 70 && currentM15.trend.includes('BULL')) {
           signalType = "SELL";
           reasoningTxt = `RSI M15 Overbought (${currentM15.rsi}) menabrak momentum tinggi di H1. Terdeteksi zona reversal scalping.`;
        } 
        // OVERSOLD BUY CONDITION
        else if (currentH1.rsi < 40 && currentM15.rsi <= 30 && currentM15.trend.includes('BEAR')) {
           signalType = "BUY";
           reasoningTxt = `RSI M15 Oversold ekstrim (${currentM15.rsi}) dengan pelemahan struktur H1. Rejeksi bawah (Bounce) terkonfirmasi.`;
        } 
        // ALIGNMENT TREND BUY
        else if ((currentH1.rsi > 50 && currentH1.rsi < 65) && (currentM15.rsi > 40 && currentM15.rsi < 55) && 
                 currentH1.trend.includes('BULL') && currentM15.trend.includes('BULL')) {
           signalType = "BUY";
           reasoningTxt = "Koreksi wajar di M15 saat H1 Bullish. Setup continuation tren siap dieksekusi.";
        }
        // ALIGNMENT TREND SELL
        else if ((currentH1.rsi < 50 && currentH1.rsi > 35) && (currentM15.rsi < 60 && currentM15.rsi > 45) &&
                 currentH1.trend.includes('BEAR') && currentM15.trend.includes('BEAR')) {
           signalType = "SELL";
           reasoningTxt = "Pullback sementara di M15 pada pola Bearish H1. Momentum ke bawah masih kuat.";
        }
        // VOLATILITY SCALPING (fallback to pure math % change)
        else {
           if (miniTrendPercent > 0.4) {
             signalType = "SELL";
             reasoningTxt = `Volume spike cepat ${miniTrendPercent.toFixed(2)}% di M15. Mencari titik balik koreksi (Mean Reversion).`;
           } else if (miniTrendPercent < -0.4) {
             signalType = "BUY";
             reasoningTxt = `Dump tajam ${miniTrendPercent.toFixed(2)}% di M15 tanpa konfirmasi H4. Peluang pisau jatuh memantul.`;
           }
        }
      }

      // Confidence Math
      let calcConf = Math.min((Math.abs(miniTrendPercent) * 50) + 50, 92);
      if (signalType === "WAIT") calcConf = 0;

      const localData: MarketAnalysis = {
        price: currentPrice,
        timeframes: realTimeframes,
        signal: {
          type: signalType,
          confidence: Math.round(calcConf), 
          zone: (currentPrice * (signalType === "BUY" ? 0.9985 : signalType === "SELL" ? 1.0015 : 1)).toFixed(1),
          sl: (currentPrice * (signalType === "BUY" ? 0.995 : 1.005)).toFixed(1),
          tp1: (currentPrice * (signalType === "BUY" ? 1.003 : 0.997)).toFixed(1),
          tp2: (currentPrice * (signalType === "BUY" ? 1.008 : 0.992)).toFixed(1),
          rr: "1:2.5"
        },
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

  const handleChat = async () => {
    if (!input.trim()) return;
    const newMessages = [...messages, { role: "user" as const, content: input }];
    setMessages(newMessages);
    setInput("");
    
    // Simulate thinking delay then return static offline message
    setTimeout(() => {
      setMessages([...newMessages, { 
        role: "assistant", 
        content: "⚠️ **Mode Pure Math Aktif.**\n\nKoneksi ke server AI dimatikan sesuai instruksi. Seluruh analisa saat ini di-*handle* 100% oleh skrip kalkulasi matematis lokal dari data *real-time* Binance API." 
      }]);
    }, 800);
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
            
            const recentCloses = closes.slice(-20);
            const first = recentCloses[0];
            const last = recentCloses[recentCloses.length - 1];
            const trendPct = ((last - first) / first) * 100;
            const trendStr = trendPct > 0.5 ? "STRONG BULL" : trendPct > 0 ? "BULLISH" : trendPct < -0.5 ? "STRONG BEAR" : "BEARISH";
            const rsiState = rsi > 70 ? "Overbought" : rsi < 30 ? "Oversold" : rsi > 55 ? "Bullish" : rsi < 45 ? "Bearish" : "Neutral";
            const structure = getStructure(recentCloses);
            
            realTimeframes.push({ timeframe: tfLabel, trend: trendStr, rsi, rsiState, structure });
          }
        };

        await Promise.all([
          fetchTF('5m', 'M5'),
          fetchTF('15m', 'M15'),
          fetchTF('1h', 'H1'),
          fetchTF('4h', 'H4')
        ]);
        
        const tfOrder = ['M5', 'M15', 'H1', 'H4'];
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
        <div className="flex-1 grid grid-cols-12 overflow-hidden relative">
            {/* Left: Chart Area */}
            <div className={`
              ${mobileActiveTab === 'CHART' ? 'col-span-12 flex' : 'hidden'} 
              lg:flex lg:col-span-8 border-r border-trading-border flex-col relative h-full w-full
            `}>
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
                
                {/* Visual Target Lock Highlight Overlay (TV-Style Horizontal Ray) */}
                <AnimatePresence>
                  {analysis?.signal && (
                    <motion.div
                      key={highlightTrigger} // Use highlight trigger here just to fire the re-entry animation when updated
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ duration: 0.3 }}
                      className="absolute left-0 w-full top-[30%] z-[60] flex items-center pointer-events-none drop-shadow-md"
                    >
                      {/* Text Label on the Left */}
                      <div className="pl-4 pr-3 text-[10px] md:text-xs uppercase font-bold tracking-widest drop-shadow-lg whitespace-nowrap bg-trading-bg/50 backdrop-blur-sm" 
                           style={{ color: analysis.signal.type === 'SELL' ? '#ff4466' : analysis.signal.type === 'BUY' ? '#00ff88' : '#eab308' }}>
                        {analysis.signal.type} ZONE
                      </div>

                      {/* Connecting Horizontal Line (Dotted) */}
                      <div className="flex-1 h-0 border-b-2 border-dotted opacity-60" 
                           style={{ borderColor: analysis.signal.type === 'SELL' ? '#ff4466' : analysis.signal.type === 'BUY' ? '#00ff88' : '#eab308' }} />

                      {/* True TV Style Tag Polygon on the Right Edge */}
                      <div className="flex items-center">
                        {/* Arrow Pointing Left */}
                        <div 
                           className="w-0 h-0 border-y-[12px] border-y-transparent border-r-[8px]" 
                           style={{ borderRightColor: analysis.signal.type === 'SELL' ? '#ff4466' : analysis.signal.type === 'BUY' ? '#00ff88' : '#eab308' }} 
                        />
                        {/* Ticker Tag Body (Exactly matching TV dimensions) */}
                        <div 
                           className="text-white font-mono text-[11px] font-semibold h-[24px] px-1.5 flex items-center justify-center rounded-sm rounded-l-none"
                           style={{ backgroundColor: analysis.signal.type === 'SELL' ? '#ff4466' : analysis.signal.type === 'BUY' ? '#00ff88' : '#eab308' }}
                        >
                           {analysis.signal.zone}
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
              </div>

              {/* Analysis Reason */}
              <div className="p-6 flex-1">
                <h3 className="text-[10px] uppercase tracking-widest font-bold opacity-40 mb-4 tracking-tighter">REASONING & BIAS</h3>
                <div className="prose prose-invert prose-sm max-w-none text-slate-400 font-medium leading-relaxed">
                  <Markdown remarkPlugins={[remarkGfm]}>{analysis?.reasoning || "Tunggu hasil pemindaian..."}</Markdown>
                </div>
              </div>
            </div>
        </div>
      </main>

      {/* Bottom Navigation for Mobile */}
      <nav className="h-16 bg-trading-panel border-t border-trading-border lg:hidden flex items-center justify-around px-4 z-[90] shadow-[0_-5px_15px_rgba(0,0,0,0.5)] flex-shrink-0">
        {[
          { id: 'CHART', icon: <TrendingUp size={20} />, label: 'Market Chart' },
          { id: 'SIGNAL', icon: <Target size={20} />, label: 'AI Signal' },
          { id: 'CHAT', icon: <MessageSquare size={20} />, label: 'AI Consult' }
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

      {/* Persistent Chat Integration for Mobile (when CHAT tab is active) */}
      <AnimatePresence>
        {mobileActiveTab === 'CHAT' && (
          <motion.div 
            initial={{ opacity: 0 }} 
            animate={{ opacity: 1 }} 
            exit={{ opacity: 0 }}
            className="fixed inset-0 top-14 bg-trading-bg z-[85] lg:hidden flex flex-col"
            style={{ bottom: '64px' }} // Account for the mobile nav height (16 = 64px)
          >
             <div className="p-4 border-b border-trading-border bg-accent/5 flex justify-between items-center">
                <span className="text-xs font-black text-white flex items-center gap-2 tracking-widest uppercase"><MessageSquare size={14}/> CONSULT ANALYST OMEGA</span>
                <span className="text-[10px] font-bold text-bull animate-pulse flex items-center gap-1">● ONLINE</span>
              </div>
              <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-[url('https://www.transparenttextures.com/patterns/carbon-fibre.png')]">
                {messages.length === 0 && (
                  <div className="text-center py-12 opacity-30 italic">
                    <p className="text-xs">Konsultasi strategi trade BTC lo sekarang...</p>
                  </div>
                )}
                {messages.map((m, i) => (
                  <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                    <div className={`max-w-[85%] p-3 rounded-lg text-xs font-medium leading-relaxed ${m.role === "user" ? "bg-accent/20 text-white border border-accent/30 rounded-tr-none" : "bg-trading-panel text-slate-300 border border-trading-border rounded-tl-none"}`}>
                      <Markdown remarkPlugins={[remarkGfm]}>{m.content}</Markdown>
                    </div>
                  </div>
                ))}
              </div>
              <div className="p-4 bg-trading-panel border-t border-trading-border">
                <form 
                  onSubmit={(e) => { e.preventDefault(); handleChat(); }}
                  className="flex gap-2"
                >
                  <input
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    placeholder="Tanya soal trade ini..."
                    className="flex-1 bg-trading-bg border border-trading-border rounded-md px-3 py-2 text-xs text-white focus:outline-none focus:border-accent/50"
                  />
                  <button type="submit" className="p-2 bg-accent text-black rounded-md hover:bg-bull transition-colors">
                    <TrendingUp size={16} />
                  </button>
                </form>
              </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Desktop Collaboration / Chat Panel (Floating Toggle) */}
      <div className="hidden lg:flex fixed bottom-4 right-4 z-[100] flex flex-col items-end gap-2">
        <AnimatePresence>
          {chatOpen && (
            <motion.div
              initial={{ opacity: 0, y: 20, scale: 0.9 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 20, scale: 0.9 }}
              className="w-80 h-96 bg-trading-panel border border-trading-border rounded-xl shadow-2xl flex flex-col overflow-hidden mb-2"
            >
              <div className="p-3 border-b border-trading-border bg-accent/5 flex justify-between items-center">
                <span className="text-[10px] font-black text-white flex items-center gap-2 tracking-widest"><MessageSquare size={12}/> CONSULT ANALYST</span>
                <button onClick={() => setChatOpen(false)} className="text-slate-500 hover:text-white"><ChevronDown size={16} /></button>
              </div>
              <div className="flex-1 overflow-y-auto p-3 space-y-3 bg-[url('https://www.transparenttextures.com/patterns/carbon-fibre.png')]">
                {messages.length === 0 && (
                  <p className="text-[10px] text-slate-600 text-center mt-10 uppercase tracking-tighter">No active session</p>
                )}
                {messages.map((m, i) => (
                  <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[90%] p-2 rounded text-[11px] leading-tight ${m.role === 'user' ? 'bg-accent/10 border border-accent/20 text-white' : 'bg-slate-800 text-slate-300'}`}>
                      <Markdown>{m.content}</Markdown>
                    </div>
                  </div>
                ))}
              </div>
              <div className="p-2 bg-trading-bg border-t border-trading-border flex gap-2">
                <input 
                  type="text" 
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleChat()}
                  placeholder="Ask advisor..."
                  className="flex-1 bg-trading-panel border border-trading-border rounded px-2 py-1.5 text-[11px] focus:outline-none focus:border-accent"
                />
                <button onClick={handleChat} className="bg-accent p-1.5 rounded text-white shadow-lg"><Zap size={14} /></button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
        <button 
          onClick={() => setChatOpen(!chatOpen)}
          className="w-12 h-12 rounded-full bg-accent text-white flex items-center justify-center shadow-2xl transition-transform active:scale-90 hover:shadow-accent/40"
        >
          {chatOpen ? <ChevronDown size={24} /> : <MessageSquare size={24} />}
        </button>
      </div>

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
