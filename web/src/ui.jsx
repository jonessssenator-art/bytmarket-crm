import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { lockPageScroll } from "./scroll-lock.mjs";
import { X, Search, LoaderCircle } from "lucide-react";
import { Button as PrintButton } from "./print360/ui/index.jsx";
import { Table as PrintTable } from "./print360/ui/kit/Table.jsx";
import { EmptyState } from "./print360/ui/kit/Feedback.jsx";
import GlassPanel from "./print360/ui/fx/GlassPanel.jsx";
import { useCRM } from "./App.jsx";
import { HeaderSlot } from "./print360/crm/HeaderSlot.jsx";
export function Button({
  children,
  primary,
  danger,
  busy,
  className = "",
  ...props
}) {
  return (
    <PrintButton
      variant={danger ? "danger" : primary ? "primary" : "white"}
      className={className}
      {...props}
      disabled={props.disabled || busy}
    >
      {busy && <LoaderCircle size={16} className="spin" />}
      {children}
    </PrintButton>
  );
}
export function PageHeading({ children }) {
  const parts = React.Children.toArray(children);
  const heading = parts[0];
  const description = React.isValidElement(heading)
    ? React.Children.toArray(heading.props.children).filter(
        (x) => React.isValidElement(x) && x.type !== "h1",
      )
    : null;
  return (
    <>
      <HeaderSlot>{parts.slice(1)}</HeaderSlot>
      <div className="bm-section-description">{description}</div>
    </>
  );
}
export function Empty({ title = "Пока нет записей", children, action }) {
  return (
    <EmptyState
      title={title}
      text={children}
      action={action}
      layout="center"
      className="bm-empty"
    />
  );
}
export function Panel({ title, action, children, className = "" }) {
  return (
    <GlassPanel pad={0} className={"panel " + className}>
      {(title || action) && (
        <div className="panel-head">
          <h2>{title}</h2>
          {action}
        </div>
      )}
      {children}
    </GlassPanel>
  );
}
export function Badge({ children, status }) {
  return (
    <span
      className={`badge ${["cancelled", "failed"].includes(status) ? "bad" : ["confirmed", "received", "delivered", "done"].includes(status) ? "good" : ""}`}
    >
      {children}
    </span>
  );
}
export function SearchBox({
  value,
  onChange,
  placeholder = "Поиск по названию",
}) {
  return (
    <label className="search">
      <Search size={18} />
      <input
        aria-label={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
    </label>
  );
}
export function Table({
  columns,
  rows = [],
  empty,
  onRow,
  viewKey,
  paginate: allowPagination = true,
}) {
  const c = useCRM();
  const identity =
    "bytmarket:table:" +
    c?.auth?.id +
    ":" +
    (viewKey || columns.map((x) => x.key).join(","));
  const [sort, setSort] = useState(null),
    [page, setPage] = useState(0),
    [size, setSize] = useState(50),
    [saved, setSaved] = useState(false);
  useEffect(() => {
    try {
      const view = JSON.parse(localStorage.getItem(identity) || "null");
      if (view) {
        setSort(view.sort);
        setSize(view.size || 50);
        setSaved(true);
      } else {
        setSort(null);
        setSize(50);
        setSaved(false);
      }
    } catch {}
    setPage(0);
  }, [identity]);
  const sorted = React.useMemo(() => {
    if (!sort) return rows;
    const column = columns.find((c) => c.key === sort.key),
      get = column?.sortValue || ((r) => r[sort.key]);
    return [...rows].sort((a, b) => {
      const x = get(a),
        y = get(b);
      if (x == null || y == null)
        return x == null && y == null ? 0 : x == null ? 1 : -1;
      return (
        (sort.dir === "desc" ? -1 : 1) *
        (typeof x === "number" && typeof y === "number"
          ? x - y
          : String(x).localeCompare(String(y), "ru", { numeric: true }))
      );
    });
  }, [rows, sort, columns]);
  const current = Math.min(
    page,
    Math.max(0, Math.ceil(rows.length / size) - 1),
  );
  const paginate = allowPagination && rows.length > 50;
  return (
    <>
      <PrintTable
        columns={columns.map((c) => ({
          ...c,
          title: c.label,
          sortable: !!c.label && c.key !== "action",
          render: c.render || ((r) => r[c.key] ?? "-"),
        }))}
        rows={
          paginate ? sorted.slice(current * size, (current + 1) * size) : sorted
        }
        sort={sort}
        onSortChange={(v) => {
          setSort(v);
          setPage(0);
          setSaved(false);
        }}
        getRowKey={(r, i) =>
          r.id ||
          (r.product_id
            ? [r.entity_id, r.warehouse_id, r.client_id, r.product_id]
                .filter(Boolean)
                .join(":")
            : i)
        }
        onRowClick={onRow}
        empty={{
          icon: "inbox",
          title: "Пока нет записей",
          text: empty || "Записи появятся после первой операции.",
        }}
      />
      {(paginate || viewKey) && (
        <div className="bm-table-controls no-print">
          <span>Всего записей: {rows.length}</span>
          {paginate && (
            <>
              <Button
                disabled={current === 0}
                onClick={() => setPage(current - 1)}
              >
                Назад
              </Button>
              <span>
                {current + 1} / {Math.ceil(rows.length / size)}
              </span>
              <Button
                disabled={(current + 1) * size >= rows.length}
                onClick={() => setPage(current + 1)}
              >
                Далее
              </Button>
              <select
                aria-label="Строк на странице"
                value={size}
                onChange={(e) => {
                  setSize(Number(e.target.value));
                  setPage(0);
                  setSaved(false);
                }}
              >
                {[50, 100, 250].map((n) => (
                  <option key={n}>{n}</option>
                ))}
              </select>
            </>
          )}
          <Button
            onClick={() => {
              try {
                localStorage.setItem(identity, JSON.stringify({ sort, size }));
                setSaved(true);
              } catch {
                c?.setToast("Не удалось сохранить вид на устройстве");
              }
            }}
          >
            {saved ? "Вид сохранён" : "Сохранить вид"}
          </Button>
        </div>
      )}
    </>
  );
}

export function Field({ label, error, ...props }) {
  return (
    <label className="field">
      <span>
        {label}
        {props.required ? " *" : ""}
      </span>
      <input {...props} />
      {error && <small className="error">{error}</small>}
    </label>
  );
}
export function Select({ label, options = [], ...props }) {
  return (
    <label className="field">
      <span>
        {label}
        {props.required ? " *" : ""}
      </span>
      <select {...props}>
        <option value="">Выберите</option>
        {options.map((o) => (
          <option key={o.value ?? o.id} value={o.value ?? o.id}>
            {o.label ?? o.name}
          </option>
        ))}
      </select>
    </label>
  );
}
export function Drawer({ title, onClose, children, wide = false }) {
  const ref = useRef();
  useEffect(() => {
    const previous = document.activeElement;
    ref.current?.focus();
    const key = (e) => {
      const dialogs = document.querySelectorAll('[role="dialog"]');
      if (dialogs[dialogs.length - 1] !== ref.current) return;
      if (e.key === "Escape") onClose();
      if (e.key === "Tab") {
        const els = ref.current?.querySelectorAll(
          'button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]',
        );
        if (!els?.length) return;
        if (e.shiftKey && document.activeElement === els[0]) {
          e.preventDefault();
          els[els.length - 1].focus();
        } else if (
          !e.shiftKey &&
          document.activeElement === els[els.length - 1]
        ) {
          e.preventDefault();
          els[0].focus();
        }
      }
    };
    document.addEventListener("keydown", key);
    const releaseScroll = lockPageScroll(document.body);
    return () => {
      document.removeEventListener("keydown", key);
      releaseScroll();
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);
  return createPortal(
    <div className="ui-overlay bm-overlay">
      <section
        className={`ui-modal bm-modal ${wide ? "wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        ref={ref}
      >
        <div className="ui-modal__head bm-modal-head">
          <h2>{title}</h2>
          <button
            type="button"
            className="icon-button"
            onClick={onClose}
            aria-label="Закрыть"
          >
            <X />
          </button>
        </div>
        {children}
      </section>
    </div>,
    document.body,
  );
}
export function RecordForm({
  title,
  fields,
  initial = {},
  submit,
  onClose,
  hint,
  submitLabel = "Сохранить",
}) {
  const [values, setValues] = useState(initial);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await submit(values);
      onClose();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Drawer title={title} onClose={onClose}>
      <form onSubmit={save} className="drawer-body">
        {hint && <p className="notice">{hint}</p>}
        <div className="form-grid">
          {fields
            .filter((f) => !f.when || f.when(values))
            .map((f) => (
              <label className={`field ${f.full ? "full" : ""}`} key={f.key}>
                <span>
                  {f.label}
                  {f.required ? " *" : ""}
                </span>
                {f.type === "select" ? (
                  <select
                    required={f.required}
                    value={values[f.key] ?? ""}
                    onChange={(e) =>
                      setValues({ ...values, [f.key]: e.target.value })
                    }
                  >
                    <option value="">Выберите</option>
                    {(typeof f.options === "function"
                      ? f.options(values)
                      : f.options || []
                    ).map((o) => (
                      <option key={o.value ?? o.id} value={o.value ?? o.id}>
                        {o.label ?? o.name}
                      </option>
                    ))}
                  </select>
                ) : f.type === "checkbox" ? (
                  <input
                    type="checkbox"
                    checked={!!values[f.key]}
                    onChange={(e) =>
                      setValues({ ...values, [f.key]: e.target.checked })
                    }
                  />
                ) : f.type === "textarea" ? (
                  <textarea
                    rows={3}
                    value={values[f.key] ?? ""}
                    onChange={(e) =>
                      setValues({ ...values, [f.key]: e.target.value })
                    }
                  />
                ) : (
                  <input
                    type={f.type || "text"}
                    required={f.required}
                    min={f.min}
                    max={f.max}
                    step={f.step}
                    minLength={f.minLength}
                    autoComplete={f.autoComplete}
                    value={values[f.key] ?? ""}
                    onChange={(e) =>
                      setValues({ ...values, [f.key]: e.target.value })
                    }
                  />
                )}{" "}
                {f.hint && <small>{f.hint}</small>}
              </label>
            ))}
        </div>
        {error && (
          <div role="alert" className="error-box">
            {error}
          </div>
        )}
        <footer className="form-actions">
          <Button onClick={onClose} type="button">
            Отмена
          </Button>
          <Button primary busy={busy} type="submit">
            {submitLabel}
          </Button>
        </footer>
      </form>
    </Drawer>
  );
}
