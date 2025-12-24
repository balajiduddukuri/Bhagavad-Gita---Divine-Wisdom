
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { GITA_DATA } from './data';
import { UI_TEXT, TOOLTIPS, TTS_PROMPTS, VOICE_CONFIG } from './constants';
import { ViewMode, Chapter, Sloka } from './types';
import { 
  Heart, ChevronLeft, ChevronRight, Pause, 
  BookOpen, Sun, Moon, Type, Volume2, 
  Loader2, Grid3X3, X, Clock, Sparkles, Eye, EyeOff,
  PlayCircle, Search, Hash, FastForward
} from 'lucide-react';
import { GoogleGenAI, Modality } from "@google/genai";

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
  
  // Audio & Auto-Play State
  const [isAutoPlaying, setIsAutoPlaying] = useState(false);
  const [autoStep, setAutoStep] = useState<number>(0); 
  const [loadingAudioKey, setLoadingAudioKey] = useState<string | null>(null);
  const isInternalProcessingRef = useRef(false);

  // Settings & UI State
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [fontSize, setFontSize] = useState(1);
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
            if (onEnded) setTimeout(onEnded, 1500); // Sacred pause for contemplation
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

  // Robust Auto-Play Engine
  useEffect(() => {
    if (!isAutoPlaying) return;

    let timer: any;

    if (viewMode === 'sloka' && currentSloka) {
      if (loadingAudioKey === null && !isInternalProcessingRef.current) {
        isInternalProcessingRef.current = true;
        const parts: ('sanskrit' | 'meaning' | 'lesson')[] = ['sanskrit', 'meaning', 'lesson'];
        playPronunciation(currentSloka, parts[autoStep], () => {
          isInternalProcessingRef.current = false;
          if (autoStep < 2) {
            setAutoStep(prev => prev + 1);
          } else {
            handleNext();
          }
        });
      }
    } else if (viewMode === 'overview' || viewMode === 'title' || viewMode === 'conclusion') {
      // For non-sloka slides, simply wait and advance
      timer = setTimeout(() => {
        handleNext();
      }, 7000);
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
    <div className="flex items-center justify-center gap-4 my-6 opacity-40">
      <div className="h-[1px] w-24 bg-gradient-to-r from-transparent to-[#D4AF37]"></div>
      <div className="text-[#D4AF37] text-xl">ॐ</div>
      <div className="h-[1px] w-24 bg-gradient-to-l from-transparent to-[#D4AF37]"></div>
    </div>
  );

  const renderTitleSlide = () => {
    const titleKey = "title_speech";
    const isLoading = loadingAudioKey === `speech_${titleKey}`;
    return (
      <div className="min-h-screen flex flex-col items-center justify-center text-white p-6 relative overflow-hidden bg-[#1A3A52]">
        <div className="absolute opacity-10 mandala-rotate pointer-events-none">
          <svg width="800" height="800" viewBox="0 0 100 100" className="text-[#D4AF37]">
            <circle cx="50" cy="50" r="45" fill="none" stroke="currentColor" strokeWidth="0.5" strokeDasharray="1 2" />
            <path d="M50 5 L55 45 L95 50 L55 55 L50 95 L45 55 L5 50 L45 45 Z" fill="none" stroke="currentColor" strokeWidth="0.5" />
          </svg>
        </div>
        <div className="z-10 text-center animate-darshan flex flex-col items-center">
          <div className="text-7xl md:text-9xl mb-6 text-[#D4AF37] filter drop-shadow-[0_0_15px_rgba(212,175,55,0.5)]">ॐ</div>
          <h2 className="font-wisdom text-xl md:text-2xl tracking-[0.3em] text-[#D4AF37] mb-4 uppercase">{UI_TEXT.SUBTITLE}</h2>
          <div className="relative group">
            <h1 className="font-display text-6xl md:text-8xl font-black tracking-tighter mb-6 text-white">{UI_TEXT.MAIN_HEADING}</h1>
            <button 
              onClick={() => speak(titleKey, TTS_PROMPTS.general(`${UI_TEXT.MAIN_HEADING}. ${UI_TEXT.MAIN_DESCRIPTION}`), 'ui')}
              className={`absolute -right-12 top-1/2 -translate-y-1/2 p-2 rounded-full transition-all ${isLoading ? 'bg-[#D4AF37] text-white animate-pulse' : 'text-[#D4AF37] opacity-0 group-hover:opacity-100'}`}
            >
              {isLoading ? <Loader2 className="animate-spin" size={24} /> : <Volume2 size={24} />}
            </button>
          </div>
          <p className="font-wisdom text-lg md:text-2xl text-white/70 max-w-3xl mx-auto italic leading-relaxed">
            {UI_TEXT.MAIN_DESCRIPTION}
          </p>
          <button 
            onClick={handleNext}
            className="mt-16 px-12 py-5 bg-[#D4AF37] text-[#1A3A52] font-display font-bold text-xl rounded-full hover:bg-[#FF6B35] transition-all transform hover:scale-110 glow-gold"
          >
            {UI_TEXT.BEGIN_BUTTON}
          </button>
        </div>
      </div>
    );
  };

  const renderChapterOverview = () => {
    const overviewSloka = currentChapter.slokas[0];
    const isSanskritLoading = loadingAudioKey === `speech_${overviewSloka.verse}_sanskrit`;
    const overviewKey = `chapter_${currentChapter.id}_overview`;
    const isOverviewLoading = loadingAudioKey === `speech_${overviewKey}`;
    
    return (
      <div className={`min-h-[90vh] w-full max-w-6xl mx-auto p-6 md:p-12 animate-darshan flex flex-col md:flex-row items-center gap-16 ${isDarkMode ? 'text-white' : 'text-[#1A3A52]'}`}>
        <div className="flex-1 space-y-8">
          <div className="flex items-center justify-between">
            <div className="inline-flex items-center gap-4 px-4 py-2 bg-[#D4AF37]/10 rounded-full border border-[#D4AF37]/30">
                <Sparkles size={16} className="text-[#D4AF37]" />
                <span className="font-display text-sm tracking-widest text-[#D4AF37]">
                  {UI_TEXT.CHAPTER_LABEL} {currentChapter.id} {UI_TEXT.TOTAL_CHAPTERS}
                </span>
            </div>
            <button 
              onClick={() => speak(overviewKey, TTS_PROMPTS.overview(currentChapter.name, currentChapter.meaning, currentChapter.summary), 'ui')}
              className={`p-3 rounded-full transition-all ${isOverviewLoading ? 'bg-[#D4AF37] text-white' : 'text-[#D4AF37] hover:bg-[#D4AF37]/10'}`}
              title={TOOLTIPS.LISTEN}
            >
              {isOverviewLoading ? <Loader2 size={20} className="animate-spin" /> : <Volume2 size={20} />}
            </button>
          </div>
          <h2 className="font-display text-5xl md:text-7xl font-bold leading-tight">{currentChapter.name}</h2>
          <h3 className="font-wisdom text-2xl md:text-3xl italic text-[#4A7C99]">{currentChapter.meaning}</h3>
          <Ornament />
          <p className="font-wisdom text-xl leading-relaxed text-opacity-80 border-l-2 border-[#D4AF37] pl-8 py-2">{currentChapter.summary}</p>
          <div className="grid grid-cols-2 gap-6">
             {currentChapter.themes.map((theme, idx) => (
               <div key={idx} className="flex items-center gap-3 group">
                  <div className="w-2 h-2 bg-[#D4AF37] rounded-full group-hover:scale-150 transition-transform"></div>
                  <span className="font-display text-sm uppercase tracking-wider opacity-70">{theme}</span>
               </div>
             ))}
          </div>
        </div>
        <div className="flex-1 w-full max-w-md">
          <div className="relative p-10 sacred-glass rounded-[2rem] glow-gold overflow-hidden text-center">
               <div className="text-xs font-display tracking-[0.4em] text-[#D4AF37] uppercase mb-8">{UI_TEXT.OPENING_WISDOM}</div>
               <p onClick={() => playPronunciation(overviewSloka, 'sanskrit')} className={`font-devanagari text-2xl md:text-3xl font-bold leading-[2] cursor-pointer transition-colors mb-4 ${isSanskritLoading ? 'text-[#FF6B35]' : 'hover:text-[#D4AF37]'}`}>
                  {overviewSloka.sanskrit}
               </p>
               <button 
                onClick={() => playPronunciation(overviewSloka, 'sanskrit')}
                className={`flex items-center justify-center gap-2 mx-auto mb-8 px-4 py-2 rounded-full border border-[#D4AF37]/30 font-display text-[10px] tracking-[0.2em] transition-all ${isSanskritLoading ? 'bg-[#D4AF37] text-white' : 'text-[#D4AF37] hover:bg-[#D4AF37]/10'}`}
               >
                 {isSanskritLoading ? <Loader2 size={12} className="animate-spin" /> : <Volume2 size={12} />}
                 {UI_TEXT.PRONOUNCE}
               </button>
               <button onClick={() => selectSloka(currentChapterIdx, 0)} className="w-full py-5 bg-[#1A3A52] text-white font-display tracking-widest rounded-xl hover:bg-[#D4AF37] transition-all">
                 {UI_TEXT.READ_VERSES} {currentChapter.slokas_count} {UI_TEXT.VERSES_SUFFIX}
               </button>
          </div>
        </div>
      </div>
    );
  };

  const renderSlokaSlide = () => {
    if (!currentSloka) return null;
    const isMeaningLoading = loadingAudioKey === `speech_${currentSloka.verse}_meaning`;
    const isLessonLoading = loadingAudioKey === `speech_${currentSloka.verse}_lesson`;
    const isSanskritLoading = loadingAudioKey === `speech_${currentSloka.verse}_sanskrit`;

    // Highlight active sections during auto-play
    const isSanskritActive = isAutoPlaying ? autoStep === 0 : true;
    const isMeaningActive = isAutoPlaying ? autoStep === 1 : true;
    const isLessonActive = isAutoPlaying ? autoStep === 2 : true;

    return (
      <div className={`flex-1 w-full max-w-5xl mx-auto px-6 py-12 md:py-24 animate-darshan transition-all duration-700 ${isFocusMode ? 'scale-105' : 'scale-100'}`}>
        <div className={`relative p-8 md:p-16 rounded-[3rem] transition-all duration-1000 ${isDarkMode ? 'bg-zinc-900/50' : 'bg-white/70'} sacred-glass glow-gold`}>
          {isAutoPlaying && (
            <div className="absolute top-0 left-0 w-full h-1 bg-[#D4AF37]/10 rounded-full overflow-hidden no-print">
               <div 
                className="h-full bg-[#D4AF37] transition-all duration-1000 ease-linear" 
                style={{ width: `${((autoStep + 1) / 3) * 100}%` }}
               ></div>
            </div>
          )}
          
          <div className={`flex justify-between items-center mb-12 no-print transition-opacity duration-500 ${isFocusMode ? 'opacity-0' : 'opacity-100'}`}>
            <div className="flex items-center gap-4">
               <div className="font-display text-sm tracking-widest text-[#D4AF37]">
                  {UI_TEXT.VERSE_LABEL} {currentSloka.verse} • {currentChapter.name}
               </div>
               {isAutoPlaying && (
                 <div className="flex items-center gap-2 px-3 py-1 bg-[#FF6B35]/10 text-[#FF6B35] rounded-full text-[10px] font-bold tracking-tighter animate-pulse">
                    <Clock size={10} /> AUTO-FLOW: {autoStep === 0 ? 'RECITATION' : autoStep === 1 ? 'MEANING' : 'INSIGHT'}
                 </div>
               )}
            </div>
            <div className="flex gap-4">
               <button onClick={() => toggleFavorite(currentSloka.verse)} className={`p-3 rounded-full sacred-glass transition-all ${favorites.includes(currentSloka.verse) ? 'text-red-500 bg-red-50' : 'text-[#D4AF37]'}`}>
                 <Heart fill={favorites.includes(currentSloka.verse) ? 'currentColor' : 'none'} size={20} />
               </button>
               <button onClick={() => setIsFocusMode(!isFocusMode)} className="p-3 rounded-full sacred-glass text-[#D4AF37]" title={TOOLTIPS.FOCUS_MODE}>
                 {isFocusMode ? <EyeOff size={20} /> : <Eye size={20} />}
               </button>
            </div>
          </div>
          <div className="text-center space-y-12" style={{ transform: `scale(${fontSize})` }}>
            <div className={`space-y-6 relative transition-all duration-500 ${!isSanskritActive ? 'opacity-20 scale-95 grayscale' : 'opacity-100 scale-100'}`}>
               <div className="text-5xl text-[#D4AF37] opacity-20 font-display">ॐ</div>
               <p 
                onClick={() => playPronunciation(currentSloka, 'sanskrit')} 
                className={`font-devanagari text-3xl md:text-5xl font-bold leading-[1.8] tracking-tight cursor-pointer transition-colors ${isSanskritLoading ? 'text-[#FF6B35]' : 'text-[#1A3A52] dark:text-white hover:text-[#D4AF37]'}`}
               >
                  {currentSloka.sanskrit}
               </p>
               <div className="flex justify-center">
                  <button 
                    onClick={() => playPronunciation(currentSloka, 'sanskrit')}
                    className={`flex items-center gap-2 px-6 py-2 rounded-full border transition-all font-display text-[10px] tracking-[0.2em] ${isSanskritLoading ? 'bg-[#D4AF37] border-[#D4AF37] text-white shadow-lg' : 'border-[#D4AF37]/30 text-[#D4AF37] hover:bg-[#D4AF37]/10'}`}
                  >
                    {isSanskritLoading ? <Loader2 size={12} className="animate-spin" /> : <Volume2 size={12} />}
                    {UI_TEXT.PRONOUNCE}
                  </button>
               </div>
               <Ornament />
            </div>
            <p className={`text-lg md:text-xl text-[#4A7C99] italic font-wisdom max-w-3xl mx-auto px-8 transition-all duration-500 ${!isSanskritActive ? 'opacity-10 blur-sm' : 'opacity-100'}`}>
              {currentSloka.transliteration}
            </p>
            <div className={`grid md:grid-cols-2 gap-12 text-left pt-8 transition-opacity duration-1000 ${isFocusMode ? 'opacity-40 hover:opacity-100' : 'opacity-100'}`}>
              
              {/* Meaning Card */}
              <div className={`group/card space-y-4 p-8 rounded-3xl transition-all duration-700 ${!isMeaningActive ? 'opacity-30 grayscale scale-95' : 'opacity-100 scale-100 shadow-xl'} ${isMeaningLoading ? 'ring-4 ring-[#D4AF37] bg-[#D4AF37]/10' : 'bg-[#1A3A52]/5 dark:bg-white/5'}`}>
                <div className="flex justify-between items-center">
                  <h4 className="font-display text-xs tracking-widest text-[#8B4513] dark:text-[#D4AF37] uppercase">{UI_TEXT.DIVINE_MEANING}</h4>
                  <button 
                    onClick={() => playPronunciation(currentSloka, 'meaning')}
                    className={`p-2 rounded-full transition-all ${isMeaningLoading ? 'bg-[#D4AF37] text-white shadow-md' : 'text-[#D4AF37] hover:bg-[#D4AF37]/20 opacity-0 group-hover/card:opacity-100'}`}
                  >
                    {isMeaningLoading ? <Loader2 className="animate-spin" size={16} /> : <Volume2 size={16} />}
                  </button>
                </div>
                <p className="font-wisdom text-xl text-[#1A3A52] dark:text-white/90 leading-relaxed italic">"{currentSloka.meaning}"</p>
              </div>

              {/* Insight Card */}
              <div className={`group/card space-y-4 p-8 rounded-3xl transition-all duration-700 ${!isLessonActive ? 'opacity-30 grayscale scale-95' : 'opacity-100 scale-100 shadow-xl'} ${isLessonLoading ? 'ring-4 ring-[#FF6B35] bg-[#FF6B35]/10' : 'bg-[#FF6B35]/5'}`}>
                <div className="flex justify-between items-center">
                  <h4 className="font-display text-xs tracking-widest text-[#FF6B35] uppercase">{UI_TEXT.SACRED_INSIGHT}</h4>
                  <button 
                    onClick={() => playPronunciation(currentSloka, 'lesson')}
                    className={`p-2 rounded-full transition-all ${isLessonLoading ? 'bg-[#FF6B35] text-white shadow-md' : 'text-[#FF6B35] hover:bg-[#FF6B35]/20 opacity-0 group-hover/card:opacity-100'}`}
                  >
                    {isLessonLoading ? <Loader2 className="animate-spin" size={16} /> : <Volume2 size={16} />}
                  </button>
                </div>
                <p className="font-wisdom text-lg text-gray-700 dark:text-gray-300 leading-relaxed">{currentSloka.lesson}</p>
              </div>

            </div>
          </div>
        </div>
      </div>
    );
  };

  const renderConclusion = () => {
    const conclusionKey = "conclusion_speech";
    const isLoading = loadingAudioKey === `speech_${conclusionKey}`;
    return (
      <div className="min-h-screen flex flex-col items-center justify-center text-center p-12 animate-darshan">
        <div className="text-9xl mb-12 text-[#D4AF37]">ॐ</div>
        <div className="relative group">
          <h1 className="font-display text-7xl font-bold text-[#D4AF37] mb-8">{UI_TEXT.CONCLUSION_HEADING}</h1>
          <button 
            onClick={() => speak(conclusionKey, TTS_PROMPTS.general(`${UI_TEXT.CONCLUSION_HEADING}. ${UI_TEXT.CONCLUSION_TEXT}`), 'ui')}
            className={`absolute -right-16 top-1/2 -translate-y-1/2 p-3 rounded-full transition-all ${isLoading ? 'bg-[#D4AF37] text-white animate-pulse' : 'text-[#D4AF37] opacity-0 group-hover:opacity-100'}`}
          >
            {isLoading ? <Loader2 className="animate-spin" size={32} /> : <Volume2 size={32} />}
          </button>
        </div>
        <p className="font-wisdom text-2xl italic mb-16 opacity-70 max-w-2xl">{UI_TEXT.CONCLUSION_TEXT}</p>
        <button onClick={() => setViewMode('title')} className="px-12 py-5 border-2 border-[#D4AF37] text-[#D4AF37] rounded-full font-display tracking-widest hover:bg-[#D4AF37] hover:text-white transition-all">RETURN TO SILENCE</button>
      </div>
    );
  };

  return (
    <div className={`min-h-screen flex flex-col transition-colors duration-1000 ${isDarkMode ? 'bg-black text-white' : 'bg-[#F5F5F0] text-[#1A3A52]'}`}>
      {/* Navigation Modals */}
      {isGridOpen && (
        <div className="fixed inset-0 z-[100] bg-[#1A3A52]/95 backdrop-blur-3xl flex flex-col items-center justify-center p-6 animate-darshan">
          <button onClick={() => setIsGridOpen(false)} className="absolute top-10 right-10 text-white/50 hover:text-[#D4AF37] transition-all"><X size={48} /></button>
          <h2 className="font-display text-4xl text-[#D4AF37] mb-12 tracking-[0.2em]">{UI_TEXT.LOTUS_SELECTION}</h2>
          <div className="grid grid-cols-3 md:grid-cols-6 gap-4 w-full max-w-5xl">
            {GITA_DATA.map((ch, idx) => (
              <button key={idx} onClick={() => { setCurrentChapterIdx(idx); setCurrentSlokaIdx(-1); setViewMode('overview'); setIsGridOpen(false); }} className={`p-6 rounded-[1.5rem] border-2 transition-all ${currentChapterIdx === idx ? 'bg-[#D4AF37] border-[#D4AF37] text-[#1A3A52]' : 'border-[#D4AF37]/20 text-[#D4AF37] hover:bg-white/5'}`}>
                <span className="font-display text-2xl">{idx + 1}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {isSearchOpen && (
        <div className="fixed inset-0 z-[100] bg-[#1A3A52]/98 backdrop-blur-3xl p-6 md:p-12 animate-darshan overflow-y-auto">
          <div className="max-w-4xl mx-auto space-y-12">
            <div className="flex justify-between items-center">
              <h2 className="font-display text-4xl text-[#D4AF37] tracking-[0.1em]">SEARCH WISDOM</h2>
              <button onClick={() => setIsSearchOpen(false)} className="text-white/50 hover:text-white"><X size={32} /></button>
            </div>
            <div className="relative">
              <Search className="absolute left-6 top-1/2 -translate-y-1/2 text-[#D4AF37]" size={24} />
              <input 
                type="text" 
                placeholder="Search by verse (e.g. 2.47) or keyword (e.g. duty, soul)..." 
                className="w-full bg-white/10 border-2 border-[#D4AF37]/30 rounded-2xl py-6 pl-16 pr-6 text-2xl text-white font-wisdom focus:outline-none focus:border-[#D4AF37]"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                autoFocus
              />
            </div>
            <div className="grid gap-4">
              {searchResults.map((res, i) => (
                <button key={i} onClick={() => selectSloka(res.chIdx, res.sIdx)} className="text-left p-6 bg-white/5 hover:bg-white/10 rounded-2xl border border-white/10 transition-all group">
                  <div className="flex justify-between items-center mb-2">
                    <span className="text-[#D4AF37] font-display text-sm tracking-widest">{res.sloka.verse} • {res.chapterName}</span>
                    <ChevronRight size={16} className="text-white/20 group-hover:translate-x-1 transition-transform" />
                  </div>
                  <p className="text-white/80 font-wisdom italic line-clamp-2">"{res.sloka.meaning}"</p>
                </button>
              ))}
              {searchQuery && searchResults.length === 0 && <p className="text-center text-[#D4AF37]/50 font-wisdom text-xl">No slokas found for this query...</p>}
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      {viewMode !== 'title' && !isFocusMode && (
        <header className="sticky top-0 z-50 sacred-glass border-b border-[#D4AF37]/10 px-8 py-4 flex items-center justify-between no-print">
          <div className="flex items-center gap-6">
             <button onClick={() => setViewMode('title')} className="text-[#D4AF37] font-display font-black text-2xl tracking-tighter">GITA</button>
             <div className="h-6 w-[1px] bg-[#D4AF37]/20"></div>
             <button onClick={() => setIsSearchOpen(true)} className="flex items-center gap-2 text-[#D4AF37]/60 hover:text-[#D4AF37] transition-colors">
                <Search size={18} />
                <span className="font-display text-xs tracking-widest">SEARCH</span>
             </button>
          </div>
          <div className="flex items-center gap-4">
             {isAutoPlaying && (
               <div className="hidden md:flex items-center gap-2 px-4 py-1.5 bg-[#FF6B35] text-white rounded-full text-[10px] font-bold tracking-[0.2em]">
                 <FastForward size={14} className="animate-pulse" /> AUTO-PLAY ACTIVE
               </div>
             )}
             <button onClick={() => setIsDarkMode(!isDarkMode)} className="p-2 text-[#D4AF37]">{isDarkMode ? <Sun size={20} /> : <Moon size={20} />}</button>
             <button onClick={() => setIsGridOpen(true)} className="px-6 py-2 bg-[#D4AF37] text-[#1A3A52] rounded-full font-display text-xs font-bold tracking-widest">CHAPTERS</button>
          </div>
        </header>
      )}

      {/* Main Content */}
      <main className="flex-1 flex items-center justify-center relative overflow-hidden">
        {viewMode === 'title' && renderTitleSlide()}
        {viewMode === 'overview' && renderChapterOverview()}
        {viewMode === 'sloka' && renderSlokaSlide()}
        {viewMode === 'conclusion' && renderConclusion()}
      </main>

      {/* Footer Controls */}
      {viewMode !== 'title' && viewMode !== 'conclusion' && !isFocusMode && (
        <footer className="sticky bottom-0 z-50 sacred-glass p-6 no-print">
          <div className="max-w-6xl mx-auto flex items-center justify-between gap-6">
            <div className="flex items-center gap-2">
              <button 
                onClick={handlePrev} 
                className="p-4 bg-[#D4AF37]/10 rounded-full text-[#D4AF37] hover:bg-[#D4AF37] hover:text-white transition-all shadow-sm"
                title={TOOLTIPS.PREV_VERSE}
              >
                <ChevronLeft size={28} />
              </button>
              {isAutoPlaying && (
                <button 
                  onClick={() => { setIsAutoPlaying(false); stopAudio(); }} 
                  className="px-4 py-2 text-[10px] font-display font-bold text-[#FF6B35] hover:underline"
                >
                  EXIT AUTO
                </button>
              )}
            </div>
            
            <div className="flex-1 flex flex-col items-center gap-4">
               <div className="flex items-center gap-6">
                  <button 
                    onClick={() => {
                      if (isAutoPlaying) {
                        setIsAutoPlaying(false);
                        stopAudio();
                      } else {
                        setIsAutoPlaying(true);
                      }
                    }} 
                    className={`p-5 rounded-full transition-all transform hover:scale-110 active:scale-95 ${isAutoPlaying ? 'bg-[#FF6B35] text-white shadow-[0_0_20px_rgba(255,107,53,0.4)]' : 'bg-[#D4AF37]/10 text-[#D4AF37]'}`}
                    title={isAutoPlaying ? TOOLTIPS.PAUSE_FLOW : TOOLTIPS.START_FLOW}
                  >
                    {isAutoPlaying ? <Pause size={32} /> : <PlayCircle size={32} />}
                  </button>
                  <div className="text-center min-w-[80px]">
                    <div className="text-[10px] font-display font-bold tracking-[0.2em] text-[#D4AF37] opacity-60 uppercase">VERSE</div>
                    <div className="font-wisdom font-bold text-lg">
                      {currentSlokaIdx >= 0 ? `${currentSlokaIdx + 1} / ${currentChapter.slokas.length}` : 'INTRO'}
                    </div>
                  </div>
               </div>
            </div>

            <button 
              onClick={handleNext} 
              className="p-4 bg-[#D4AF37] text-[#1A3A52] rounded-full hover:bg-[#FF6B35] hover:text-white transition-all shadow-[0_10px_30px_rgba(212,175,55,0.3)]"
              title={TOOLTIPS.NEXT_VERSE}
            >
              <ChevronRight size={28} />
            </button>
          </div>
        </footer>
      )}

      {isFocusMode && <button onClick={() => setIsFocusMode(false)} className="fixed bottom-10 right-10 p-4 sacred-glass rounded-full text-[#D4AF37] opacity-20 hover:opacity-100 transition-opacity"><EyeOff size={24} /></button>}
    </div>
  );
};

export default App;
