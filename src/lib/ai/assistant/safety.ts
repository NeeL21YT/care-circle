/**
 * Deterministic guards that run BEFORE the model. They only ever make the
 * assistant more cautious; the model cannot override them.
 */
const EMERGENCY =
  /(chest (pain|pressure|tightness)|can'?t breathe|cannot breathe|trouble breathing|difficulty breathing|short(ness)? of breath|stroke|face (is )?droop|slurred speech|unconscious|not responding|passed out|fainted|seizure|severe bleeding|bleeding (a lot|heavily)|overdose|took too (many|much)|swallowed (too|a lot)|suicid|want to die|kill myself|heart attack|anaphyla|allergic reaction|(he|she|i|they) (can'?t|cannot) wake)/i;

export const EMERGENCY_REPLY =
  "This sounds like it could be urgent. Please call your local emergency number or a doctor right now, or ask someone nearby to help you. I cannot judge how serious this is, and I do not want you to wait on me.";

export function isEmergencyText(text: string): boolean {
  return EMERGENCY.test(text);
}

/** Message length limit for one user turn. */
export const MAX_MESSAGE_CHARS = 1000;
