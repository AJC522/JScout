/** Display vocabulary for application statuses and priorities, shared by the board, list and detail page. */
import { APPLICATION_STATUSES, STATUS_LABELS } from '../../../shared/constants';
import type { Application, ApplicationStatus } from '../../../shared/types';
import type { Tone } from '../../components/ui';

export type Priority = Application['priority'];

export const STATUS_TONES: Record<ApplicationStatus, Tone> = {
  saved: 'neutral',
  applied: 'primary',
  screening: 'info',
  interviewing: 'info',
  offer: 'success',
  accepted: 'success',
  rejected: 'danger',
  withdrawn: 'neutral',
};

export const STATUS_OPTIONS = APPLICATION_STATUSES.map((status) => ({ value: status, label: STATUS_LABELS[status] }));

export const PRIORITY_LABELS: Record<Priority, string> = { 0: 'None', 1: 'Low', 2: 'Medium', 3: 'High' };
export const PRIORITY_TONES: Record<Priority, Tone> = { 0: 'neutral', 1: 'neutral', 2: 'warning', 3: 'danger' };
export const PRIORITIES: Priority[] = [0, 1, 2, 3];

export function isPriority(value: number): value is Priority {
  return value === 0 || value === 1 || value === 2 || value === 3;
}

export function isStatus(value: string | null | undefined): value is ApplicationStatus {
  return (APPLICATION_STATUSES as string[]).includes(value ?? '');
}
