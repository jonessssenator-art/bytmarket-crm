// Набор элементов Print 360 — простая таблица.
// Сортировка по клику на заголовок, липкая шапка, ховер строк, числа вправо и ровными цифрами,
// пустое состояние, загрузка бегущим бликом. Прокрутка без видимых полос.
import { isValidElement, useMemo } from 'react';
import { KitIcon } from './KitIcon.jsx';
import { EmptyState, Skeleton } from './Feedback.jsx';
import { useControllable } from './hooks.js';
import './kit.css';

const cx = (...a) => a.filter(Boolean).join(' ');
const collator = typeof Intl !== 'undefined' ? new Intl.Collator('ru', { numeric: true, sensitivity: 'base' }) : null;

function compare(a, b) {
  const an = a == null || a === '';
  const bn = b == null || b === '';
  if (an || bn) return an && bn ? 0 : an ? 1 : -1; // пустые — в конец
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (a instanceof Date && b instanceof Date) return a - b;
  return collator ? collator.compare(String(a), String(b)) : String(a).localeCompare(String(b), 'ru');
}

/**
 * Table
 * columns: [{ key, title, width, align ('left'|'right'|'center'), numeric, sortable, sortValue(row), render(row, i),
 *             ellipsis, hint, className }]
 * rows; getRowKey(row, i); onRowClick(row); selectedKey;
 * sort/defaultSort/onSortChange — { key, dir: 'asc'|'desc' } | null; stickyHeader; maxHeight (прокрутка внутри);
 * empty — узел или { icon, title, text, action } для EmptyState; loading; dense; footer — узел или { [key]: узел }.
 */
export function Table({
  columns = [], rows = [], getRowKey = (r, i) => r?.id ?? i, onRowClick, selectedKey,
  sort, defaultSort = null, onSortChange, stickyHeader = true, maxHeight, empty, loading = false, loadingRows = 5,
  dense = false, footer, rowClassName, ariaLabel, caption, className, style,
}) {
  const [sortState, setSort] = useControllable(sort, defaultSort, onSortChange);

  const sorted = useMemo(() => {
    if (!sortState || !sortState.key) return rows;
    const col = columns.find((c) => c.key === sortState.key);
    if (!col) return rows;
    const get = col.sortValue || ((r) => r?.[col.key]);
    const dir = sortState.dir === 'desc' ? -1 : 1;
    return rows.map((r, i) => ({ r, i })).sort((x, y) => compare(get(x.r), get(y.r)) * dir || x.i - y.i).map((x) => x.r);
  }, [rows, columns, sortState]);

  const cycle = (key) => {
    if (!sortState || sortState.key !== key) setSort({ key, dir: 'asc' });
    else if (sortState.dir === 'asc') setSort({ key, dir: 'desc' });
    else setSort(null);
  };

  const alignOf = (c) => c.align || (c.numeric ? 'right' : 'left');
  let emptyNode = null;
  if (!loading && rows.length === 0) {
    if (isValidElement(empty)) emptyNode = empty;
    else if (empty && typeof empty === 'object') emptyNode = <EmptyState layout="center" size="sm" {...empty} />;
    else emptyNode = <EmptyState layout="center" size="sm" icon="inbox" title={typeof empty === 'string' ? empty : 'Пока пусто'} />;
  }

  const rowClick = (row) => (e) => {
    if (!onRowClick) return;
    const hit = e.target instanceof Element ? e.target.closest('button, a[href], input, textarea, select, label, [data-no-open]') : null;
    if (hit && e.currentTarget.contains(hit)) return;
    onRowClick(row);
  };

  return (
    <div className={cx('p-kit-table-wrap', stickyHeader && 'is-sticky', className)} style={{ maxHeight, ...style }}>
      <table className={cx('p-kit-table', dense && 'is-dense')} aria-label={ariaLabel}>
        {caption && <caption className="p-kit-sr">{caption}</caption>}
        <colgroup>{columns.map((c) => <col key={c.key} style={c.width ? { width: c.width } : undefined} />)}</colgroup>
        <thead>
          <tr>
            {columns.map((c) => {
              const on = sortState && sortState.key === c.key;
              const al = alignOf(c);
              return (
                <th
                  key={c.key}
                  scope="col"
                  className={cx(`is-${al}`, c.sortable && 'is-sortable', on && 'is-sorted', c.headerClassName)}
                  aria-sort={on ? (sortState.dir === 'desc' ? 'descending' : 'ascending') : undefined}
                  title={c.hint}
                >
                  {c.sortable ? (
                    <button type="button" className="p-kit-th-btn" onClick={() => cycle(c.key)}>
                      <span>{c.title}</span>
                      <KitIcon name={on ? (sortState.dir === 'desc' ? 'arrowDown' : 'arrowUp') : 'sort'} size={13} strokeWidth={2.2} className="p-kit-th-ic" />
                    </button>
                  ) : c.title}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {loading && (
            <tr className="p-kit-tr-static"><td colSpan={columns.length}><Skeleton variant="row" count={loadingRows} gap={6} /></td></tr>
          )}
          {emptyNode && <tr className="p-kit-tr-static"><td colSpan={columns.length} className="p-kit-td-empty">{emptyNode}</td></tr>}
          {!loading && sorted.map((row, i) => {
            const key = getRowKey(row, i);
            return (
              <tr
                key={key}
                className={cx(onRowClick && 'is-click', selectedKey != null && key === selectedKey && 'is-selected', rowClassName?.(row, i))}
                tabIndex={onRowClick ? 0 : undefined}
                onClick={onRowClick ? rowClick(row) : undefined}
                onKeyDown={onRowClick ? (e) => { if (e.key === 'Enter' && e.target === e.currentTarget) onRowClick(row); } : undefined}
              >
                {columns.map((c) => (
                  <td key={c.key} className={cx(`is-${alignOf(c)}`, c.numeric && 'is-num', c.ellipsis && 'is-ellipsis', c.className)}>
                    {c.render ? c.render(row, i) : row?.[c.key]}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
        {footer && !loading && rows.length > 0 && (
          <tfoot>
            <tr>
              {isValidElement(footer) || typeof footer !== 'object'
                ? <td colSpan={columns.length}>{footer}</td>
                : columns.map((c) => <td key={c.key} className={cx(`is-${alignOf(c)}`, c.numeric && 'is-num')}>{footer[c.key] ?? ''}</td>)}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}
