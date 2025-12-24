
export const UI_TEXT = {
  APP_TITLE: "THE ETERNAL GITA",
  AUTHOR_NAME: "Balaji Duddukuri",
  SUBTITLE: "Srimad Bhagavad Gita",
  MAIN_HEADING: "THE ETERNAL SONG",
  MAIN_DESCRIPTION: '"The Divine discourse on duty, spiritual realization, and the nature of the Supreme."',
  BEGIN_BUTTON: "Begin Darshan",
  CHAPTER_LABEL: "CHAPTER",
  TOTAL_CHAPTERS: "OF 18",
  OPENING_WISDOM: "Opening Wisdom",
  PRONOUNCE: "PRONOUNCE",
  READ_VERSES: "READ",
  VERSES_SUFFIX: "VERSES",
  VERSE_LABEL: "VERSE",
  CLICK_TO_RECITE: "CLICK TO RECITE",
  DIVINE_MEANING: "Divine Meaning",
  SACRED_INSIGHT: "Sacred Insight",
  LOTUS_SELECTION: "LOTUS SELECTION",
  CHAPTERS_GRID_BUTTON: "CHAPTERS",
  CONCLUSION_HEADING: "HARI AUM",
  CONCLUSION_TEXT: '"The wisdom of the Lord is eternal. May your soul remain anchored in the Truth."',
  CONCLUSION_BUTTON: "RETURN TO SILENCE",
  PATH_LABEL: "Path",
  VERSE_NAV_LABEL: "Verse",
  MANTRA_FOOTER: "Tat Tvam Asi • That Thou Art",
  STEP: "Step"
};

export const TOOLTIPS = {
  PREV_VERSE: "Previous Verse",
  NEXT_VERSE: "Next Verse",
  FOCUS_MODE: "Focus Mode",
  PAUSE_FLOW: "Pause Divine Flow",
  START_FLOW: "Begin Divine Flow",
  SACRED_GRID: "Sacred Grid",
  LISTEN: "Listen to this section"
};

export const TTS_PROMPTS = {
  sanskrit: (text: string) => `Recite this sacred Sanskrit verse from the Bhagavad Gita with divine resonance, clarity, and precise traditional pronunciation. Slow enough for meditation: ${text}`,
  meaning: (text: string) => `Read this English meaning of a Bhagavad Gita verse in a serene, wise, and deeply devotional voice. Emphasize the profound spiritual truth: ${text}`,
  lesson: (text: string) => `Read this practical spiritual life lesson with a wise, encouraging, and deeply calm tone. Connect the ancient wisdom to modern life: ${text}`,
  general: (text: string) => `Read this text in a serene, wise, and deeply calm devotional tone: ${text}`,
  overview: (name: string, meaning: string, summary: string) => `Narrate the introduction to this chapter named ${name}, which means ${meaning}. Summary: ${summary}`
};

export const VOICE_CONFIG = {
  sanskrit: "Kore",
  meaning: "Zephyr",
  lesson: "Charon",
  ui: "Puck"
};
