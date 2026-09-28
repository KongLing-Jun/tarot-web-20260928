export const INTENT_VERSION = 1;
export const INTENT_TASKS = [
  'compare',
  'understand',
  'prepare',
  'emotional-support',
  'explain-cards',
  'general-guidance',
  'unknown',
] as const;
export const TURN_ACTIONS = ['new', 'follow-up', 'correct', 'switch-topic'] as const;
export interface IntentMessage {
  id: string;
  text: string;
}
export interface SupportedValue {
  value: string;
  source: { messageId: string; quote: string };
}
export interface IntentCandidate {
  task: (typeof INTENT_TASKS)[number];
  turnAction: (typeof TURN_ACTIONS)[number];
  subject: SupportedValue | null;
  goal: SupportedValue | null;
  facts: SupportedValue[];
  constraints: SupportedValue[];
  wantsAdvice: boolean;
  missingInformation: { field: string; effectOnAnswer: string; question: string }[];
}
export interface ResponsePlan {
  mode: 'clarify' | 'reading' | 'support' | 'explanation';
  includeAction: boolean;
  reuseExistingCards: boolean;
  clarification: string | null;
}
export interface IntentSnapshot {
  id: string;
  version: number;
  revision: number;
  question: string;
  sceneId?: string;
  readingId?: string;
  messages: IntentMessage[];
  candidate: IntentCandidate;
  plan: ResponsePlan;
}
export interface IntentRequest {
  question: string;
  sceneId?: string;
  readingId?: string;
  previousIntentId?: string;
}
export interface IntentReference {
  intentId?: string;
  sceneId?: string;
}
