/** Tracker data: queries and mutations with optimistic updates and rollback. */
import { keepPreviousData, useMutation, useQuery, useQueryClient, type QueryClient, type QueryKey } from '@tanstack/react-query';
import type { ApplicationCreate, ApplicationEventCreate, ApplicationPatch, DocumentCreate } from '../../../shared/api';
import type { Application, ApplicationDetail, ApplicationDocument, ApplicationStatus } from '../../../shared/types';
import { api, errorMessage } from '../../api/client';
import { useToast } from '../../components/ui';
import { qk } from '../../lib/query';
import { applyMove, renumber } from './board';

const LIST_PREFIX = ['applications', 'list'] as const;

export function useApplicationList(q: string) {
  return useQuery({
    queryKey: qk.applications({ q: q.trim() }),
    queryFn: ({ signal }) => api('GET /api/applications', { query: { q: q.trim() || undefined }, signal }),
    placeholderData: keepPreviousData,
  });
}

export function useApplicationStats() {
  return useQuery({
    queryKey: qk.applicationStats(),
    queryFn: ({ signal }) => api('GET /api/applications/stats', { signal }),
  });
}

export function useApplication(id: string) {
  return useQuery({
    queryKey: qk.application(id),
    queryFn: ({ signal }) => api('GET /api/applications/:id', { params: { id }, signal }),
  });
}

/** Lists, stats and the sidebar badges all depend on tracker writes. */
function refreshTracker(queryClient: QueryClient, options: { exceptDetail?: string } = {}): void {
  void queryClient.invalidateQueries({
    queryKey: qk.applications(),
    predicate: (query) => !options.exceptDetail || query.queryKey.join('/') !== qk.application(options.exceptDetail).join('/'),
  });
  void queryClient.invalidateQueries({ queryKey: qk.bootstrap() });
}

type ListSnapshot = Array<[QueryKey, Application[] | undefined]>;

async function updateLists(queryClient: QueryClient, update: (apps: Application[]) => Application[]): Promise<ListSnapshot> {
  await queryClient.cancelQueries({ queryKey: LIST_PREFIX });
  const snapshot = queryClient.getQueriesData<Application[]>({ queryKey: LIST_PREFIX });
  queryClient.setQueriesData<Application[]>({ queryKey: LIST_PREFIX }, (apps) => (apps ? update(apps) : apps));
  return snapshot;
}

function restoreLists(queryClient: QueryClient, snapshot: ListSnapshot | undefined): void {
  for (const [key, data] of snapshot ?? []) queryClient.setQueryData(key, data);
}

export interface MoveInput {
  id: string;
  status: ApplicationStatus;
  /** Null means "renumber the target column in `columnOrder`". */
  sortOrder: number | null;
  /** The target column's final id order, needed only when renumbering. */
  columnOrder?: string[];
}

/** Status changes and reordering from the board and list, applied instantly and rolled back on failure. */
export function useMoveApplication() {
  const queryClient = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: async ({ id, status, sortOrder, columnOrder }: MoveInput) => {
      if (sortOrder !== null) {
        await api('PATCH /api/applications/:id', { params: { id }, body: { status, sortOrder } });
        return;
      }
      // Neighbouring positions got too close for a fraction between them: spread the column out again.
      const positions = renumber(columnOrder ?? [id]);
      for (const p of positions) {
        await api('PATCH /api/applications/:id', {
          params: { id: p.id },
          body: p.id === id ? { status, sortOrder: p.sortOrder } : { sortOrder: p.sortOrder },
        });
      }
    },
    onMutate: async ({ id, status, sortOrder, columnOrder }) => {
      const nowIso = new Date().toISOString();
      return updateLists(queryClient, (apps) => {
        if (sortOrder !== null) return applyMove(apps, id, status, sortOrder, nowIso);
        const positions = new Map(renumber(columnOrder ?? [id]).map((p) => [p.id, p.sortOrder]));
        return applyMove(apps, id, status, positions.get(id) ?? 0, nowIso).map((a) =>
          positions.has(a.id) ? { ...a, sortOrder: positions.get(a.id) ?? a.sortOrder } : a,
        );
      });
    },
    onError: (err, _input, snapshot) => {
      restoreLists(queryClient, snapshot);
      toast.error('Could not move the application', { description: errorMessage(err) });
    },
    onSettled: () => refreshTracker(queryClient),
  });
}

export function useCreateApplication() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: ApplicationCreate) => api('POST /api/applications', { body }),
    onSuccess: (created) => {
      queryClient.setQueryData(qk.application(created.id), created);
      refreshTracker(queryClient, { exceptDetail: created.id });
    },
  });
}

export function useDeleteApplication() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api('DELETE /api/applications/:id', { params: { id } }),
    onSuccess: (_ok, id) => {
      queryClient.removeQueries({ queryKey: qk.application(id) });
      queryClient.setQueriesData<Application[]>({ queryKey: LIST_PREFIX }, (apps) => apps?.filter((a) => a.id !== id));
      refreshTracker(queryClient, { exceptDetail: id });
    },
  });
}

/** Fields of a patch that can be shown before the server answers. */
function mergePatch(detail: ApplicationDetail, patch: ApplicationPatch): ApplicationDetail {
  const next: ApplicationDetail = { ...detail, updatedAt: new Date().toISOString() };
  if (patch.status !== undefined && patch.status !== detail.status) {
    next.status = patch.status;
    next.statusChangedAt = next.updatedAt;
  }
  if (patch.notes !== undefined) next.notes = patch.notes;
  if (patch.priority !== undefined) next.priority = patch.priority;
  if (patch.contacts !== undefined) next.contacts = patch.contacts;
  if (patch.checklist !== undefined) next.checklist = patch.checklist;
  if (patch.followUpAt !== undefined) {
    if (patch.followUpAt === null) delete next.followUpAt;
    else next.followUpAt = patch.followUpAt;
  }
  if (patch.appliedAt !== undefined) {
    if (patch.appliedAt === null) delete next.appliedAt;
    else next.appliedAt = patch.appliedAt;
  }
  if (patch.job !== undefined) next.job = { ...detail.job, ...patch.job };
  return next;
}

/**
 * Edits to one application, applied to the cached detail at once. Rapid edits (ticking several
 * checklist items) each build on the optimistic state; only the last answer replaces the cache,
 * so an earlier response cannot briefly undo a later tick.
 */
export function usePatchApplication(id: string) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const mutationKey = ['patch-application', id];
  return useMutation({
    mutationKey,
    mutationFn: (patch: ApplicationPatch) => api('PATCH /api/applications/:id', { params: { id }, body: patch }),
    onMutate: async (patch) => {
      await queryClient.cancelQueries({ queryKey: qk.application(id) });
      const previous = queryClient.getQueryData<ApplicationDetail>(qk.application(id));
      if (previous) queryClient.setQueryData(qk.application(id), mergePatch(previous, patch));
      return previous;
    },
    onSuccess: (saved) => {
      if (queryClient.isMutating({ mutationKey }) <= 1) queryClient.setQueryData(qk.application(id), saved);
    },
    onError: (err, _patch, previous) => {
      if (previous) queryClient.setQueryData(qk.application(id), previous);
      toast.error('Could not save your change', { description: errorMessage(err) });
    },
    onSettled: () => refreshTracker(queryClient, { exceptDetail: id }),
  });
}

export function useAddEvent(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: ApplicationEventCreate) => api('POST /api/applications/:id/events', { params: { id }, body }),
    onSuccess: (event) => {
      queryClient.setQueryData<ApplicationDetail>(qk.application(id), (old) =>
        old ? { ...old, events: [event, ...old.events].sort((a, b) => b.at.localeCompare(a.at)) } : old,
      );
      refreshTracker(queryClient, { exceptDetail: id });
    },
  });
}

export function useRemoveEvent(id: string) {
  const queryClient = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: (eventId: string) => api('DELETE /api/applications/:id/events/:eventId', { params: { id, eventId } }),
    onMutate: async (eventId) => {
      await queryClient.cancelQueries({ queryKey: qk.application(id) });
      const previous = queryClient.getQueryData<ApplicationDetail>(qk.application(id));
      if (previous) queryClient.setQueryData(qk.application(id), { ...previous, events: previous.events.filter((e) => e.id !== eventId) });
      return previous;
    },
    onError: (err, _eventId, previous) => {
      if (previous) queryClient.setQueryData(qk.application(id), previous);
      toast.error('Could not remove the event', { description: errorMessage(err) });
    },
  });
}

function upsertDocument(queryClient: QueryClient, id: string, doc: ApplicationDocument): void {
  queryClient.setQueryData<ApplicationDetail>(qk.application(id), (old) => {
    if (!old) return old;
    const exists = old.documents.some((d) => d.id === doc.id);
    return { ...old, documents: exists ? old.documents.map((d) => (d.id === doc.id ? doc : d)) : [doc, ...old.documents] };
  });
}

/** Save a draft (cover letter, answer…) to an application. Used by the apply kit too. */
export function useAddDocument(applicationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: DocumentCreate) => api('POST /api/applications/:id/documents', { params: { id: applicationId }, body }),
    onSuccess: (doc) => {
      upsertDocument(queryClient, applicationId, doc);
      // The server records a timeline event for new documents.
      void queryClient.invalidateQueries({ queryKey: qk.application(applicationId) });
    },
  });
}

export function useUpdateDocument(applicationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ docId, ...body }: { docId: string; title?: string; content?: string }) =>
      api('PATCH /api/applications/:id/documents/:docId', { params: { id: applicationId, docId }, body }),
    onSuccess: (doc) => upsertDocument(queryClient, applicationId, doc),
  });
}

export function useDeleteDocument(applicationId: string) {
  const queryClient = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: (docId: string) => api('DELETE /api/applications/:id/documents/:docId', { params: { id: applicationId, docId } }),
    onMutate: async (docId) => {
      await queryClient.cancelQueries({ queryKey: qk.application(applicationId) });
      const previous = queryClient.getQueryData<ApplicationDetail>(qk.application(applicationId));
      if (previous) {
        queryClient.setQueryData(qk.application(applicationId), { ...previous, documents: previous.documents.filter((d) => d.id !== docId) });
      }
      return previous;
    },
    onError: (err, _docId, previous) => {
      if (previous) queryClient.setQueryData(qk.application(applicationId), previous);
      toast.error('Could not delete the document', { description: errorMessage(err) });
    },
  });
}
