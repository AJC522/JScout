/**
 * The search the user last looked at, so a job's full page can link back to the results instead
 * of the empty start page. Kept in memory: a job page opened on its own falls back to "/".
 */

let lastSearch: string | undefined;

/** Remember a search page URL (pathname plus its "?…" query string). A blank search is not worth returning to. */
export function rememberSearch(pathname: string, search: string): void {
  if (search.replace(/^\?/, '')) lastSearch = `${pathname}${search.startsWith('?') ? search : `?${search}`}`;
}

/** Where "← Search" on a job page leads: the last search, or the start page. */
export function searchBackLink(): string {
  return lastSearch ?? '/';
}

/** Forget the remembered search (for tests). */
export function forgetSearch(): void {
  lastSearch = undefined;
}
