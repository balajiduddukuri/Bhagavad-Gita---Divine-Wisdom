
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { GITA_DATA } from './data';
import { UI_TEXT, TOOLTIPS, TTS_PROMPTS, VOICE_CONFIG } from './constants';
import { ViewMode, Chapter, Sloka } from './types';
import { 
  Heart, ChevronLeft, ChevronRight, Pause, 
  BookOpen, Sun, Moon, Type, Volume2, 
  Loader2, Grid3X3, X, Clock, Sparkles, Eye, EyeOff,
  PlayCircle, Search, Hash, FastForward, Palette, Command
} from 'lucide-react';
import { GoogleGenAI, Modality } from "@google/genai";

type ThemeMode = 'neon' | 'devotional' | 'klimt';

// Audio Decoding Utilities
function decodeBase64(base64: string) {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

async function decodeAudioData(
  data: Uint8Array,
  ctx: AudioContext,
  sampleRate: number,
  numChannels: number,
): Promise<AudioBuffer> {
  const dataInt16 = new Int16Array(data.buffer);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);

  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
}

const App: React.FC = () => {
  // Navigation State
  const [viewMode, setViewMode] = useState<ViewMode>('title');
  const [currentChapterIdx, setCurrentChapterIdx] = useState(0);
  const [currentSlokaIdx, setCurrentSlokaIdx] = useState(-1);
  const [theme, setTheme] = useState<ThemeMode>('neon');
  
  // Audio & Auto-Play State
  const [isAutoPlaying, setIsAutoPlaying] = useState(false);
  const [autoStep, setAutoStep] = useState<number>(0); 
  const [loadingAudioKey, setLoadingAudioKey] = useState<string | null>(null);
  const isInternalProcessingRef = useRef(false);

  // Settings & UI State
  const [isGridOpen, setIsGridOpen] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [isFocusMode, setIsFocusMode] = useState(false);
  const [favorites, setFavorites] = useState<string[]>(() => {
    const saved = localStorage.getItem('gita_favorites');
    return saved ? JSON.parse(saved) : [];
  });

  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceNodeRef = useRef<AudioBufferSourceNode | null>(null);

  const currentChapter = GITA_DATA[currentChapterIdx];
  const currentSloka = currentSlokaIdx >= 0 ? currentChapter.slokas[currentSlokaIdx] : null;

  useEffect(() => {
    document.body.setAttribute('data-theme', theme);
  }, [theme]);

  const stopAudio = useCallback(() => {
    if (sourceNodeRef.current) {
      try { sourceNodeRef.current.stop(); } catch (e) {}
      sourceNodeRef.current = null;
    }
    setLoadingAudioKey(null);
  }, []);

  const handleNext = useCallback(() => {
    stopAudio();
    setAutoStep(0);
    isInternalProcessingRef.current = false;
    
    if (viewMode === 'title') {
      setViewMode('overview');
      setCurrentChapterIdx(0);
      setCurrentSlokaIdx(-1);
    } else if (viewMode === 'overview') {
      setViewMode('sloka');
      setCurrentSlokaIdx(0);
    } else if (viewMode === 'sloka') {
      if (currentSlokaIdx < currentChapter.slokas.length - 1) {
        setCurrentSlokaIdx(prev => prev + 1);
      } else {
        if (currentChapterIdx < GITA_DATA.length - 1) {
          setCurrentChapterIdx(prev => prev + 1);
          setCurrentSlokaIdx(-1);
          setViewMode('overview');
        } else {
          setViewMode('conclusion');
          setIsAutoPlaying(false);
        }
      }
    } else if (viewMode === 'conclusion') {
      setViewMode('title');
    }
  }, [viewMode, currentChapterIdx, currentSlokaIdx, currentChapter?.slokas.length, stopAudio]);

  const handlePrev = useCallback(() => {
    stopAudio();
    setAutoStep(0);
    isInternalProcessingRef.current = false;

    if (viewMode === 'overview') {
      if (currentChapterIdx > 0) {
        setCurrentChapterIdx(prev => prev - 1);
        setCurrentSlokaIdx(GITA_DATA[currentChapterIdx - 1].slokas.length - 1);
        setViewMode('sloka');
      } else {
        setViewMode('title');
      }
    } else if (viewMode === 'sloka') {
      if (currentSlokaIdx > 0) {
        setCurrentSlokaIdx(prev => prev - 1);
      } else {
        setViewMode('overview');
        setCurrentSlokaIdx(-1);
      }
    } else if (viewMode === 'conclusion') {
      setCurrentChapterIdx(GITA_DATA.length - 1);
      setCurrentSlokaIdx(GITA_DATA[GITA_DATA.length - 1].slokas.length - 1);
      setViewMode('sloka');
    }
  }, [viewMode, currentChapterIdx, currentSlokaIdx, stopAudio]);

  const speak = useCallback(async (id: string, promptText: string, voiceType: keyof typeof VOICE_CONFIG, onEnded?: () => void) => {
    const key = `speech_${id}`;
    if (loadingAudioKey === key) { stopAudio(); return; }
    stopAudio();
    setLoadingAudioKey(key);

    const voiceName = VOICE_CONFIG[voiceType] || VOICE_CONFIG.ui;

    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash-preview-tts",
        contents: [{ parts: [{ text: promptText }] }],
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName } },
          },
        },
      });

      const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (base64Audio) {
        if (!audioContextRef.current) {
          audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
        }
        const ctx = audioContextRef.current;
        if (ctx.state === 'suspended') await ctx.resume();
        const audioBuffer = await decodeAudioData(decodeBase64(base64Audio), ctx, 24000, 1);
        const source = ctx.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(ctx.destination);
        sourceNodeRef.current = source;
        source.start();
        source.onended = () => { 
          if (sourceNodeRef.current === source) {
            setLoadingAudioKey(null);
            if (onEnded) setTimeout(onEnded, 1500); 
          }
        };
      } else {
        setLoadingAudioKey(null);
        if (onEnded) onEnded();
      }
    } catch (error) {
      console.error("Divine voice error:", error);
      setLoadingAudioKey(null);
      if (onEnded) onEnded();
    }
  }, [loadingAudioKey, stopAudio]);

  const playPronunciation = useCallback(async (sloka: Sloka, type: 'sanskrit' | 'meaning' | 'lesson', onEnded?: () => void) => {
    const promptText = TTS_PROMPTS[type](
      type === 'sanskrit' ? sloka.sanskrit : 
      type === 'meaning' ? sloka.meaning : sloka.lesson
    );
    speak(`${sloka.verse}_${type}`, promptText, type, onEnded);
  }, [speak]);

  useEffect(() => {
    if (!isAutoPlaying) return;
    let timer: any;
    if (viewMode === 'sloka' && currentSloka) {
      if (loadingAudioKey === null && !isInternalProcessingRef.current) {
        isInternalProcessingRef.current = true;
        const parts: ('sanskrit' | 'meaning' | 'lesson')[] = ['sanskrit', 'meaning', 'lesson'];
        playPronunciation(currentSloka, parts[autoStep], () => {
          isInternalProcessingRef.current = false;
          if (autoStep < 2) setAutoStep(prev => prev + 1);
          else handleNext();
        });
      }
    } else if (['overview', 'title', 'conclusion'].includes(viewMode)) {
      timer = setTimeout(() => handleNext(), 7000);
    }
    return () => clearTimeout(timer);
  }, [isAutoPlaying, autoStep, viewMode, currentSloka, loadingAudioKey, playPronunciation, handleNext]);

  useEffect(() => {
    localStorage.setItem('gita_favorites', JSON.stringify(favorites));
  }, [favorites]);

  const toggleFavorite = (verse: string) => {
    setFavorites(prev => 
      prev.includes(verse) ? prev.filter(v => v !== verse) : [...prev, verse]
    );
  };

  const selectSloka = (chIdx: number, sIdx: number) => {
    setCurrentChapterIdx(chIdx);
    setCurrentSlokaIdx(sIdx);
    setViewMode('sloka');
    setIsGridOpen(false);
    setIsSearchOpen(false);
    setIsAutoPlaying(false);
    stopAudio();
  };

  const searchResults = useMemo(() => {
    if (!searchQuery.trim()) return [];
    const results: { chIdx: number, sIdx: number, sloka: Sloka, chapterName: string }[] = [];
    GITA_DATA.forEach((ch, chIdx) => {
      ch.slokas.forEach((s, sIdx) => {
        if (
          s.verse.includes(searchQuery) ||
          s.meaning.toLowerCase().includes(searchQuery.toLowerCase()) ||
          s.lesson.toLowerCase().includes(searchQuery.toLowerCase()) ||
          s.transliteration.toLowerCase().includes(searchQuery.toLowerCase())
        ) {
          results.push({ chIdx, sIdx, sloka: s, chapterName: ch.name });
        }
      });
    });
    return results.slice(0, 50);
  }, [searchQuery]);

  const Ornament = () => (
    <div className="flex items-center justify-center gap-4 my-6 opacity-40" aria-hidden="true">
      <div className="h-[1px] w-24 bg-gradient-to-r from-transparent to-[var(--gold)]"></div>
      <div className="text-[var(--gold)] text-xl">ॐ</div>
      <div className="h-[1px] w-24 bg-gradient-to-l from-transparent to-[var(--gold)]"></div>
    </div>
  );

  const renderTitleSlide = () => {
    const titleKey = "title_speech";
    const isLoading = loadingAudioKey === `speech_${titleKey}`;
    return (
      <section id="main-content" className="min-h-screen flex flex-col items-center justify-center p-6 relative overflow-hidden">
        <div className="absolute opacity-10 mandala-rotate pointer-events-none" aria-hidden="true">
          <svg width="800" height="800" viewBox="0 0 100 100" stroke="var(--gold)">
            <circle cx="50" cy="50" r="45" fill="none" strokeWidth="0.5" strokeDasharray="1 2" />
            <path d="M50 5 L55 45 L95 50 L55 55 L50 95 L45 55 L5 50 L45 45 Z" fill="none" strokeWidth="0.5" />
          </svg>
        </div>
        <div className="z-10 text-center animate-darshan flex flex-col items-center">
          <div className="text-7xl md:text-9xl mb-6 text-[var(--gold)]" aria-hidden="true">ॐ</div>
          <h2 className="font-wisdom text-xl md:text-2xl tracking-[0.3em] text-[var(--gold)] mb-4 uppercase">{UI_TEXT.SUBTITLE}</h2>
          <div className="relative group">
            <h1 className="font-display text-6xl md:text-8xl font-black tracking-tighter mb-6">{UI_TEXT.MAIN_HEADING}</h1>
            <button 
              aria-label="Listen to title"
              onClick={() => speak(titleKey, TTS_PROMPTS.general(`${UI_TEXT.MAIN_HEADING}. ${UI_TEXT.MAIN_DESCRIPTION}`), 'ui')}
              className={`absolute -right-16 top-1/2 -translate-y-1/2 p-2 rounded-full transition-all ${isLoading ? 'bg-[var(--accent)] text-white animate-pulse' : 'text-[var(--accent)] opacity-50 group-hover:opacity-100'}`}
            >
              {isLoading ? <Loader2 className="animate-spin" size={24} /> : <Volume2 size={24} />}
            </button>
          </div>
          <p className="font-wisdom text-lg md:text-2xl opacity-70 max-w-3xl mx-auto italic leading-relaxed">
            {UI_TEXT.MAIN_DESCRIPTION}
          </p>
          <button 
            onClick={handleNext}
            className="mt-16 px-12 py-5 bg-[var(--accent)] text-black font-display font-bold text-xl rounded-full hover:scale-110 transition-transform shadow-xl"
          >
            {UI_TEXT.BEGIN_BUTTON}
          </button>
        </div>
      </section>
    );
  };

  const renderChapterOverview = () => {
    const overviewSloka = currentChapter.slokas[0];
    const isSanskritLoading = loadingAudioKey === `speech_${overviewSloka.verse}_sanskrit`;
    const overviewKey = `chapter_${currentChapter.id}_overview`;
    const isOverviewLoading = loadingAudioKey === `speech_${overviewKey}`;
    
    return (
      <section id="main-content" className="min-h-[90vh] w-full max-w-6xl mx-auto p-6 md:p-12 animate-darshan flex flex-col md:flex-row items-center gap-16">
        <div className="flex-1 space-y-8">
          <nav aria-label="Breadcrumb" className="inline-flex items-center gap-4 px-4 py-2 bg-[var(--accent)] bg-opacity-10 rounded-full border border-[var(--border)]">
              <Sparkles size={16} className="text-[var(--accent)]" />
              <span className="font-display text-sm tracking-widest uppercase">
                {UI_TEXT.CHAPTER_LABEL} {currentChapter.id} {UI_TEXT.TOTAL_CHAPTERS}
              </span>
          </nav>
          <div className="flex items-center gap-6">
            <h2 className="font-display text-5xl md:text-7xl font-bold leading-tight">{currentChapter.name}</h2>
            <button 
              aria-label="Listen to chapter summary"
              onClick={() => speak(overviewKey, TTS_PROMPTS.overview(currentChapter.name, currentChapter.meaning, currentChapter.summary), 'ui')}
              className={`p-3 rounded-full transition-all ${isOverviewLoading ? 'bg-[var(--accent)] text-white' : 'text-[var(--accent)] hover:bg-white/10'}`}
            >
              {isOverviewLoading ? <Loader2 size={24} className="animate-spin" /> : <Volume2 size={24} />}
            </button>
          </div>
          <h3 className="font-wisdom text-2xl md:text-3xl italic opacity-80">{currentChapter.meaning}</h3>
          <Ornament />
          <p className="font-wisdom text-xl leading-relaxed opacity-70 border-l-2 border-[var(--accent)] pl-8 py-2">{currentChapter.summary}</p>
          <div className="grid grid-cols-2 gap-6" role="list">
             {currentChapter.themes.map((theme, idx) => (
               <div key={idx} className="flex items-center gap-3 group" role="listitem">
                  <div className="w-2 h-2 bg-[var(--accent)] rounded-full group-hover:scale-150 transition-transform"></div>
                  <span className="font-display text-sm uppercase tracking-wider opacity-60 underlined-link">{theme}</span>
               </div>
             ))}
          </div>
        </div>
        <div className="flex-1 w-full max-w-md">
          <article className="relative p-10 sacred-glass rounded-[2rem] text-center">
               <div className="text-xs font-display tracking-[0.4em] text-[var(--gold)] uppercase mb-8">{UI_TEXT.OPENING_WISDOM}</div>
               <p 
                role="button"
                aria-label="Recite first verse"
                onClick={() => playPronunciation(overviewSloka, 'sanskrit')} 
                className={`font-devanagari text-2xl md:text-3xl font-bold leading-[2] cursor-pointer transition-colors mb-4 ${isSanskritLoading ? 'text-[var(--accent)]' : 'hover:text-[var(--gold)]'}`}
               >
                  {overviewSloka.sanskrit}
               </p>
               <button 
                onClick={() => playPronunciation(overviewSloka, 'sanskrit')}
                className={`flex items-center justify-center gap-2 mx-auto mb-8 px-4 py-2 rounded-full border border-[var(--border)] font-display text-[10px] tracking-[0.2em] transition-all hover:bg-[var(--accent)] hover:text-black`}
               >
                 {isSanskritLoading ? <Loader2 size={12} className="animate-spin" /> : <Volume2 size={12} />}
                 {UI_TEXT.PRONOUNCE}
               </button>
               <button onClick={() => selectSloka(currentChapterIdx, 0)} className="w-full py-5 bg-[var(--accent)] text-black font-display font-bold tracking-widest rounded-xl hover:opacity-90 transition-all">
                 {UI_TEXT.READ_VERSES} {currentChapter.slokas_count} {UI_TEXT.VERSES_SUFFIX}
               </button>
          </article>
        </div>
      </section>
    );
  };

  const renderSlokaSlide = () => {
    if (!currentSloka) return null;
    const isMeaningLoading = loadingAudioKey === `speech_${currentSloka.verse}_meaning`;
    const isLessonLoading = loadingAudioKey === `speech_${currentSloka.verse}_lesson`;
    const isSanskritLoading = loadingAudioKey === `speech_${currentSloka.verse}_sanskrit`;

    return (
      <section id="main-content" className="flex-1 w-full max-w-5xl mx-auto px-6 py-12 md:py-20 animate-darshan">
        <article className="relative p-8 md:p-16 rounded-[3rem] sacred-glass">
          <header className={`flex justify-between items-center mb-12 no-print transition-opacity duration-500 ${isFocusMode ? 'opacity-0' : 'opacity-100'}`}>
            <div className="flex items-center gap-4">
               <span className="font-display text-sm tracking-widest text-[var(--gold)]">
                  {UI_TEXT.VERSE_LABEL} {currentSloka.verse} • {currentChapter.name}
               </span>
               {isAutoPlaying && (
                 <span className="px-3 py-1 bg-[var(--accent)] text-black rounded-full text-[10px] font-bold tracking-tighter animate-pulse">
                    AUTO-FLOW: {autoStep === 0 ? 'RECITATION' : autoStep === 1 ? 'MEANING' : 'INSIGHT'}
                 </span>
               )}
            </div>
            <div className="flex gap-4">
               <button 
                aria-label={favorites.includes(currentSloka.verse) ? "Remove from favorites" : "Add to favorites"}
                onClick={() => toggleFavorite(currentSloka.verse)} 
                className={`p-3 rounded-full sacred-glass transition-all ${favorites.includes(currentSloka.verse) ? 'text-red-500' : 'text-[var(--gold)]'}`}
               >
                 <Heart fill={favorites.includes(currentSloka.verse) ? 'currentColor' : 'none'} size={20} />
               </button>
               <button 
                aria-label="Toggle focus mode"
                onClick={() => setIsFocusMode(!isFocusMode)} 
                className="p-3 rounded-full sacred-glass text-[var(--gold)]"
               >
                 {isFocusMode ? <EyeOff size={20} /> : <Eye size={20} />}
               </button>
            </div>
          </header>
          <div className="text-center space-y-12">
            <div className={`space-y-6 relative transition-all duration-500`}>
               <div className="text-5xl text-[var(--gold)] opacity-20 font-display" aria-hidden="true">ॐ</div>
               <p 
                role="button"
                onClick={() => playPronunciation(currentSloka, 'sanskrit')} 
                className={`font-devanagari text-3xl md:text-5xl font-bold leading-[1.8] tracking-tight cursor-pointer transition-colors ${isSanskritLoading ? 'text-[var(--accent)]' : 'hover:text-[var(--gold)]'}`}
               >
                  {currentSloka.sanskrit}
               </p>
               <button 
                  onClick={() => playPronunciation(currentSloka, 'sanskrit')}
                  className={`flex items-center gap-2 mx-auto px-6 py-2 rounded-full border border-[var(--border)] font-display text-[10px] tracking-[0.2em] hover:bg-[var(--accent)] hover:text-black transition-all`}
                >
                  {isSanskritLoading ? <Loader2 size={12} className="animate-spin" /> : <Volume2 size={12} />}
                  {UI_TEXT.PRONOUNCE}
                </button>
               <Ornament />
            </div>
            <p className="text-lg md:text-xl text-[var(--accent)] opacity-80 italic font-wisdom max-w-3xl mx-auto px-8">
              {currentSloka.transliteration}
            </p>
            <div className="grid md:grid-cols-2 gap-12 text-left pt-8">
              <div className={`space-y-4 p-8 rounded-3xl transition-all duration-700 ${isMeaningLoading ? 'ring-2 ring-[var(--accent)] bg-opacity-20' : 'bg-black bg-opacity-20'}`}>
                <div className="flex justify-between items-center">
                  <h4 className="font-display text-xs tracking-widest text-[var(--gold)] uppercase">{UI_TEXT.DIVINE_MEANING}</h4>
                  <button aria-label="Play meaning audio" onClick={() => playPronunciation(currentSloka, 'meaning')} className="text-[var(--accent)]">
                    {isMeaningLoading ? <Loader2 className="animate-spin" size={16} /> : <Volume2 size={16} />}
                  </button>
                </div>
                <p className="font-wisdom text-xl opacity-90 leading-relaxed italic">"{currentSloka.meaning}"</p>
              </div>

              <div className={`space-y-4 p-8 rounded-3xl transition-all duration-700 ${isLessonLoading ? 'ring-2 ring-[var(--accent)] bg-opacity-20' : 'bg-black bg-opacity-20'}`}>
                <div className="flex justify-between items-center">
                  <h4 className="font-display text-xs tracking-widest text-[var(--accent)] uppercase">{UI_TEXT.SACRED_INSIGHT}</h4>
                  <button aria-label="Play insight audio" onClick={() => playPronunciation(currentSloka, 'lesson')} className="text-[var(--accent)]">
                    {isLessonLoading ? <Loader2 className="animate-spin" size={16} /> : <Volume2 size={16} />}
                  </button>
                </div>
                <p className="font-wisdom text-lg opacity-80 leading-relaxed">{currentSloka.lesson}</p>
              </div>
            </div>
          </div>
        </article>
      </section>
    );
  };

  const renderConclusion = () => {
    const conclusionKey = "conclusion_speech";
    const isLoading = loadingAudioKey === `speech_${conclusionKey}`;
    return (
      <section id="main-content" className="min-h-screen flex flex-col items-center justify-center text-center p-12 animate-darshan">
        <div className="text-9xl mb-12 text-[var(--gold)]" aria-hidden="true">ॐ</div>
        <h1 className="font-display text-7xl font-bold text-[var(--gold)] mb-8">{UI_TEXT.CONCLUSION_HEADING}</h1>
        <button 
            aria-label="Play conclusion speech"
            onClick={() => speak(conclusionKey, TTS_PROMPTS.general(`${UI_TEXT.CONCLUSION_HEADING}. ${UI_TEXT.CONCLUSION_TEXT}`), 'ui')}
            className={`p-4 rounded-full transition-all mb-8 ${isLoading ? 'bg-[var(--accent)] text-black animate-pulse' : 'text-[var(--accent)]'}`}
          >
            {isLoading ? <Loader2 className="animate-spin" size={32} /> : <Volume2 size={32} />}
        </button>
        <p className="font-wisdom text-2xl italic mb-16 opacity-70 max-w-2xl">{UI_TEXT.CONCLUSION_TEXT}</p>
        <button onClick={() => setViewMode('title')} className="px-12 py-5 border-2 border-[var(--accent)] text-[var(--accent)] rounded-full font-display tracking-widest hover:bg-[var(--accent)] hover:text-black transition-all">RETURN TO SILENCE</button>
      </section>
    );
  };

  return (
    <div className="min-h-screen flex flex-col transition-colors duration-1000">
      {/* Theme Picker */}
      <div className="fixed top-20 right-8 z-[60] flex flex-col gap-4 no-print">
        <button aria-label="Neon Theme" onClick={() => setTheme('neon')} className={`w-8 h-8 rounded-full border-2 border-white bg-black ${theme === 'neon' ? 'scale-125' : 'opacity-50'}`} style={{backgroundColor: '#00ffcc'}}></button>
        <button aria-label="Devotional Theme" onClick={() => setTheme('devotional')} className={`w-8 h-8 rounded-full border-2 border-white bg-white ${theme === 'devotional' ? 'scale-125' : 'opacity-50'}`} style={{backgroundColor: '#ff6b35'}}></button>
        <button aria-label="Klimt Theme" onClick={() => setTheme('klimt')} className={`w-8 h-8 rounded-full border-2 border-white bg-amber-600 ${theme === 'klimt' ? 'scale-125' : 'opacity-50'}`} style={{backgroundColor: '#d4af37'}}></button>
      </div>

      {isGridOpen && (
        <div role="dialog" aria-modal="true" aria-label="Chapter Selection Grid" className="fixed inset-0 z-[100] bg-black bg-opacity-95 backdrop-blur-3xl flex flex-col items-center justify-center p-6 animate-darshan">
          <button aria-label="Close grid" onClick={() => setIsGridOpen(false)} className="absolute top-10 right-10 text-white/50 hover:text-[var(--accent)] transition-all"><X size={48} /></button>
          <h2 className="font-display text-4xl text-[var(--gold)] mb-12 tracking-[0.2em]">{UI_TEXT.LOTUS_SELECTION}</h2>
          <div className="grid grid-cols-3 md:grid-cols-6 gap-4 w-full max-w-5xl">
            {GITA_DATA.map((ch, idx) => (
              <button 
                key={idx} 
                aria-label={`Chapter ${idx + 1}: ${ch.name}`}
                onClick={() => { setCurrentChapterIdx(idx); setCurrentSlokaIdx(-1); setViewMode('overview'); setIsGridOpen(false); }} 
                className={`p-6 rounded-[1.5rem] border-2 transition-all ${currentChapterIdx === idx ? 'bg-[var(--accent)] border-[var(--accent)] text-black' : 'border-[var(--border)] text-[var(--gold)] hover:bg-white/10'}`}
              >
                <span className="font-display text-2xl">{idx + 1}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {isSearchOpen && (
        <div role="dialog" aria-modal="true" aria-label="Search Wisdom" className="fixed inset-0 z-[100] bg-black bg-opacity-98 backdrop-blur-3xl p-6 md:p-12 animate-darshan overflow-y-auto">
          <div className="max-w-4xl mx-auto space-y-12">
            <div className="flex justify-between items-center">
              <h2 className="font-display text-4xl text-[var(--gold)] tracking-[0.1em]">SEARCH WISDOM</h2>
              <button aria-label="Close search" onClick={() => setIsSearchOpen(false)} className="text-white/50 hover:text-white"><X size={32} /></button>
            </div>
            <div className="relative">
              <Search className="absolute left-6 top-1/2 -translate-y-1/2 text-[var(--accent)]" size={24} aria-hidden="true" />
              <input 
                type="text" 
                placeholder="Search by verse (e.g. 2.47) or keyword..." 
                className="w-full bg-white/10 border-2 border-[var(--border)] rounded-2xl py-6 pl-16 pr-6 text-2xl text-white font-wisdom focus:outline-none focus:border-[var(--accent)]"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                autoFocus
              />
            </div>
            <div className="grid gap-4">
              {searchResults.map((res, i) => (
                <button key={i} onClick={() => selectSloka(res.chIdx, res.sIdx)} className="text-left p-6 bg-white/5 hover:bg-white/10 rounded-2xl border border-white/10 transition-all group">
                  <div className="flex justify-between items-center mb-2">
                    <span className="text-[var(--gold)] font-display text-sm tracking-widest underlined-link">{res.sloka.verse} • {res.chapterName}</span>
                    <ChevronRight size={16} className="text-white/20 group-hover:translate-x-1 transition-transform" />
                  </div>
                  <p className="text-white/80 font-wisdom italic line-clamp-2">"{res.sloka.meaning}"</p>
                </button>
              ))}
              {searchQuery && searchResults.length === 0 && <p className="text-center opacity-50 font-wisdom text-xl">No slokas found for this query...</p>}
            </div>
          </div>
        </div>
      )}

      {/* Header Landmark */}
      {viewMode !== 'title' && !isFocusMode && (
        <header className="sticky top-0 z-50 sacred-glass border-b border-[var(--border)] px-8 py-4 flex items-center justify-between no-print" role="banner">
          <div className="flex items-center gap-6">
             <button onClick={() => setViewMode('title')} className="font-display font-black text-2xl tracking-tighter text-[var(--accent)]">GITA</button>
             <div className="h-6 w-[1px] bg-[var(--border)]"></div>
             <button onClick={() => setIsSearchOpen(true)} className="flex items-center gap-2 opacity-60 hover:opacity-100 transition-colors">
                <Search size={18} />
                <span className="font-display text-xs tracking-widest underlined-link">SEARCH</span>
             </button>
          </div>
          <div className="flex items-center gap-6">
             <button onClick={() => setIsGridOpen(true)} className="px-6 py-2 bg-[var(--accent)] text-black rounded-full font-display text-xs font-bold tracking-widest flex items-center gap-2">
               <Grid3X3 size={14} /> CHAPTERS
             </button>
          </div>
        </header>
      )}

      {/* Main Content Landmark */}
      <main className="flex-1 flex items-center justify-center relative overflow-hidden" role="main">
        {viewMode === 'title' && renderTitleSlide()}
        {viewMode === 'overview' && renderChapterOverview()}
        {viewMode === 'sloka' && renderSlokaSlide()}
        {viewMode === 'conclusion' && renderConclusion()}
      </main>

      {/* Footer Controls Landmark */}
      {viewMode !== 'title' && viewMode !== 'conclusion' && !isFocusMode && (
        <footer className="sticky bottom-0 z-50 sacred-glass p-6 no-print" role="contentinfo">
          <div className="max-w-6xl mx-auto flex items-center justify-between gap-6">
            <button aria-label="Previous verse" onClick={handlePrev} className="p-4 bg-white/10 rounded-full hover:bg-[var(--accent)] hover:text-black transition-all"><ChevronLeft size={28} /></button>
            <div className="flex-1 flex flex-col items-center gap-4">
               <div className="flex items-center gap-8">
                  <button 
                    aria-label={isAutoPlaying ? "Pause auto-play" : "Start auto-play"}
                    onClick={() => setIsAutoPlaying(!isAutoPlaying)} 
                    className={`p-6 rounded-full transition-all transform hover:scale-110 ${isAutoPlaying ? 'bg-[var(--accent)] text-black' : 'bg-white/10 text-[var(--accent)]'}`}
                  >
                    {isAutoPlaying ? <Pause size={32} /> : <PlayCircle size={32} />}
                  </button>
                  <div className="text-center min-w-[100px]">
                    <div className="text-[10px] font-display font-bold tracking-[0.2em] text-[var(--gold)] uppercase opacity-60">VERSE</div>
                    <div className="font-wisdom font-bold text-xl">
                      {currentSlokaIdx >= 0 ? `${currentSlokaIdx + 1} / ${currentChapter.slokas.length}` : 'INTRO'}
                    </div>
                  </div>
               </div>
            </div>
            <button aria-label="Next verse" onClick={handleNext} className="p-4 bg-[var(--accent)] text-black rounded-full hover:scale-110 transition-all shadow-xl"><ChevronRight size={28} /></button>
          </div>
          <div className="text-center pt-4 opacity-40 text-[10px] tracking-widest font-display">
            CREATED BY BALAJIDUDDUKURI
          </div>
        </footer>
      )}

      {isFocusMode && <button aria-label="Exit focus mode" onClick={() => setIsFocusMode(false)} className="fixed bottom-10 right-10 p-4 sacred-glass rounded-full text-[var(--accent)] opacity-20 hover:opacity-100 transition-opacity"><EyeOff size={24} /></button>}
    </div>
  );
};

export default App;
