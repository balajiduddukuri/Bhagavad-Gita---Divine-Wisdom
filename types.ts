
export interface Sloka {
  verse: string;
  sanskrit: string;
  transliteration: string;
  meaning: string;
  lesson: string;
  isFavorite?: boolean;
}

export interface Chapter {
  id: number;
  name: string;
  meaning: string;
  slokas_count: number;
  summary: string;
  themes: string[];
  featured_verse: string;
  slokas: Sloka[];
}

export type ViewMode = 'title' | 'overview' | 'sloka' | 'conclusion';
