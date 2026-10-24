export function Pagination({ page, count, size, name, onPage }: {
  page: number; count: number; size: number; name: string; onPage: (page: number) => void;
}) {
  const last = Math.max(0, Math.ceil(count / size) - 1);
  return <nav className="pagination" aria-label={`${name} pagination`}>
    <span aria-live="polite">{name} {count ? page * size + 1 : 0}–{Math.min((page + 1) * size, count)} of {count}</span>
    <button type="button" disabled={page === 0} onClick={() => onPage(page - 1)} aria-label={`Previous ${name.toLowerCase()}`}>Previous</button>
    <button type="button" disabled={page >= last} onClick={() => onPage(page + 1)} aria-label={`Next ${name.toLowerCase()}`}>Next</button>
  </nav>;
}
