import { PREFERENCES_VERSION, type ContentType, type IndexPolicy, type Persona, type Preferences, type Priority, type ScoringWeights } from './types';

const ALL_NORMAL: Record<ContentType, Priority> = {
  docs: 'normal',
  article: 'normal',
  video: 'normal',
  code: 'normal',
  work: 'normal',
  news: 'normal',
  social: 'normal',
  shopping: 'normal',
  email: 'normal',
  finance: 'normal',
  health: 'normal',
  other: 'normal',
};

/** Starting priorities for each persona. The user can change any of them afterwards. */
export const PERSONA_PRIORITIES: Record<Persona, Record<ContentType, Priority>> = {
  student: { ...ALL_NORMAL, docs: 'high', article: 'high', social: 'low', shopping: 'low' },
  developer: {
    ...ALL_NORMAL,
    docs: 'high',
    code: 'high',
    work: 'high',
    social: 'low',
    shopping: 'low',
    news: 'low',
  },
  researcher: { ...ALL_NORMAL, article: 'high', docs: 'high', social: 'low', shopping: 'low' },
  creator: { ...ALL_NORMAL, video: 'high', article: 'high', social: 'normal', shopping: 'low' },
  general: { ...ALL_NORMAL },
};

export const PERSONA_LABELS: Record<Persona, string> = {
  student: 'Student',
  developer: 'Developer',
  researcher: 'Researcher',
  creator: 'Content creator',
  general: 'A bit of everything',
};

/** Sensitive types are never stored as text by default. */
export const DEFAULT_INDEX_POLICY: Record<ContentType, IndexPolicy> = {
  docs: 'full',
  article: 'full',
  video: 'title',
  code: 'full',
  work: 'title',
  news: 'full',
  social: 'title',
  shopping: 'title',
  email: 'never',
  finance: 'never',
  health: 'never',
  other: 'full',
};

export const DEFAULT_WEIGHTS: ScoringWeights = {
  recencyMax: 70,
  activityMax: 15,
  activityFullVisits: 10,
  activityFullMinutes: 30,
  priorityPoints: 20,
  topicPoints: 15,
  lowPrioritySitePoints: 25,
};

export function defaultPreferences(persona: Persona = 'general'): Preferences {
  return {
    version: PREFERENCES_VERSION,
    updatedAt: 0,
    onboarded: false,
    persona,
    contentPriority: { ...PERSONA_PRIORITIES[persona] },
    indexPolicy: { ...DEFAULT_INDEX_POLICY },
    topics: [],
    alwaysImportant: [],
    lowPriority: [],
    siteRules: [],
    useBuiltInSiteLists: true,
    weights: { ...DEFAULT_WEIGHTS },
    staleAfterDays: 3,
    archiveThreshold: 30,
    mode: 'suggest',
    trackActivity: true,
    idleAfterSeconds: 120,
    // Off until the user opts in and grants page access.
    captureText: false,
  };
}
