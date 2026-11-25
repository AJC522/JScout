/** The onboarding steps, in order. The index is remembered on this device so a reload resumes where the user was. */

export const STEPS = [
  { id: 'welcome', label: 'Welcome' },
  { id: 'resume', label: 'Résumé' },
  { id: 'preferences', label: 'What you want' },
  { id: 'companies', label: 'Companies' },
  { id: 'done', label: 'Done' },
] as const;

export type StepId = (typeof STEPS)[number]['id'];

export const STEP_STORAGE_KEY = 'jscout.onboarding.step';

/** A stored step index made safe to use (old or hand-edited values fall back to the first step). */
export function clampStep(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < STEPS.length ? value : 0;
}
