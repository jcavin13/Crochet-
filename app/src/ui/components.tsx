import {
  createContext,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
} from 'react';
import { create } from 'zustand';
import { Icon, type IconName } from './icons';

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

/* ---------------------------------------------------------------- Button */

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'default' | 'primary' | 'ghost' | 'danger';
  size?: 'md' | 'sm';
  icon?: IconName;
  block?: boolean;
};

export function Button({ variant = 'default', size = 'md', icon, block, className, children, type = 'button', ...rest }: ButtonProps) {
  return (
    <button
      type={type}
      className={cx('ui-btn', variant !== 'default' && `ui-btn--${variant}`, size === 'sm' && 'ui-btn--sm', block && 'ui-btn--block', className)}
      {...rest}
    >
      {icon && <Icon name={icon} size={18} />}
      {children}
    </button>
  );
}

/** Class names to style a router <Link> as a button: `<Link className={buttonClass('primary')}>`. */
export function buttonClass(variant: ButtonProps['variant'] = 'default', size: ButtonProps['size'] = 'md') {
  return cx('ui-btn', variant !== 'default' && `ui-btn--${variant}`, size === 'sm' && 'ui-btn--sm');
}

export function IconButton({ icon, label, className, type = 'button', size = 20, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { icon: IconName; label: string; size?: number }) {
  return (
    <button type={type} className={cx('ui-iconbtn', className)} aria-label={label} title={label} {...rest}>
      <Icon name={icon} size={size} />
    </button>
  );
}

/* ---------------------------------------------------------------- Card */

export function Card({ className, flush, interactive, ...rest }: HTMLAttributes<HTMLDivElement> & { flush?: boolean; interactive?: boolean }) {
  return <div className={cx('ui-card', flush && 'ui-card--flush', interactive && 'ui-card--interactive', className)} {...rest} />;
}

/* ---------------------------------------------------------------- Tabs */

export type TabItem<T extends string> = { id: T; label: ReactNode };

/** Controlled tab strip. Render the active panel yourself, or pass `children(active)`. */
export function Tabs<T extends string>({
  tabs, value, onChange, label, className,
}: { tabs: TabItem<T>[]; value: T; onChange: (id: T) => void; label: string; className?: string }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKey = (e: React.KeyboardEvent, i: number) => {
    const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const j = (i + d + tabs.length) % tabs.length;
    onChange(tabs[j].id);
    refs.current[j]?.focus();
  };
  return (
    <div className={cx('ui-tabs__list', className)} role="tablist" aria-label={label}>
      {tabs.map((t, i) => (
        <button
          key={t.id}
          ref={(el) => { refs.current[i] = el; }}
          role="tab"
          type="button"
          className="ui-tabs__tab"
          aria-selected={t.id === value}
          tabIndex={t.id === value ? 0 : -1}
          onClick={() => onChange(t.id)}
          onKeyDown={(e) => onKey(e, i)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

/* ---------------------------------------------------------------- SegmentedControl */

export function SegmentedControl<T extends string>({
  options, value, onChange, label, disabled, className,
}: { options: { value: T; label: ReactNode; title?: string }[]; value: T; onChange: (v: T) => void; label: string; disabled?: boolean; className?: string }) {
  return (
    <div className={cx('ui-seg', className)} role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          className="ui-seg__opt"
          aria-checked={o.value === value}
          title={o.title}
          disabled={disabled}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* ---------------------------------------------------------------- Field, Slider, Select, Toggle, Input */

export function Field({ label, value, hint, htmlFor, children }: { label: ReactNode; value?: ReactNode; hint?: ReactNode; htmlFor?: string; children: ReactNode }) {
  return (
    <div className="ui-field">
      <label className="ui-field__label" htmlFor={htmlFor}>
        <span>{label}</span>
        {value !== undefined && <span className="ui-field__value">{value}</span>}
      </label>
      {children}
      {hint && <span className="ui-field__hint">{hint}</span>}
    </div>
  );
}

export function Slider({
  label, value, min, max, step = 1, onChange, format, hint, ...rest
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value'> & {
  label: ReactNode; value: number; min: number; max: number; step?: number; onChange: (v: number) => void; format?: (v: number) => ReactNode; hint?: ReactNode;
}) {
  const id = useId();
  const pct = max > min ? ((value - min) / (max - min)) * 100 : 0;
  return (
    <Field label={label} value={format ? format(value) : value} hint={hint} htmlFor={id}>
      <input
        id={id}
        type="range"
        className="ui-slider"
        min={min}
        max={max}
        step={step}
        value={value}
        style={{ '--pct': `${pct}%` } as CSSProperties}
        onChange={(e) => onChange(Number(e.target.value))}
        {...rest}
      />
    </Field>
  );
}

export function Select({ label, hint, className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement> & { label?: ReactNode; hint?: ReactNode }) {
  const id = useId();
  const el = <select id={id} className={cx('ui-select', className)} {...rest}>{children}</select>;
  return label ? <Field label={label} hint={hint} htmlFor={id}>{el}</Field> : el;
}

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cx('ui-input', className)} {...rest} />;
}

export function Toggle({ label, checked, onChange, disabled }: { label: ReactNode; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className="ui-toggle">
      <input type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="ui-toggle__track" aria-hidden="true" />
      <span>{label}</span>
    </label>
  );
}

/* ---------------------------------------------------------------- Badge */

export type BadgeTone = 'neutral' | 'flat' | 'cup' | 'ruffle' | 'error' | 'warning' | 'info' | 'ok' | 'accent' | 'outline';

export function Badge({ tone = 'neutral', dot, className, children, ...rest }: HTMLAttributes<HTMLSpanElement> & { tone?: BadgeTone; dot?: boolean }) {
  return (
    <span className={cx('ui-badge', tone !== 'neutral' && `ui-badge--${tone}`, className)} {...rest}>
      {dot && <span className="ui-badge__dot" aria-hidden="true" />}
      {children}
    </span>
  );
}

export type ShapeClass = 'flat' | 'cup' | 'ruffle';
const shapeLabel: Record<ShapeClass, string> = { flat: 'Flat', cup: 'Cups', ruffle: 'Ruffles' };
/** Flat / cup / ruffle badge with the semantic shape colours (always labelled, never colour alone). */
export function ShapeBadge({ shape, children }: { shape: ShapeClass; children?: ReactNode }) {
  return <Badge tone={shape} dot>{children ?? shapeLabel[shape]}</Badge>;
}

/* ---------------------------------------------------------------- Toast */

type ToastItem = { id: number; message: ReactNode; tone: 'default' | 'error'; action?: { label: string; onClick: () => void } };
type ToastState = { items: ToastItem[]; push: (t: Omit<ToastItem, 'id'>, ms?: number) => void; dismiss: (id: number) => void };
let toastSeq = 0;
export const useToasts = create<ToastState>((set, get) => ({
  items: [],
  push: (t, ms = 3200) => {
    const id = ++toastSeq;
    set({ items: [...get().items.slice(-2), { ...t, id }] });
    setTimeout(() => get().dismiss(id), ms);
  },
  dismiss: (id) => set({ items: get().items.filter((i) => i.id !== id) }),
}));

/** Show a toast from anywhere: `toast('Saved')`, `toast('Import failed', { tone: 'error' })`. */
export function toast(message: ReactNode, opts: { tone?: 'default' | 'error'; action?: ToastItem['action']; ms?: number } = {}) {
  useToasts.getState().push({ message, tone: opts.tone ?? 'default', action: opts.action }, opts.ms);
}

export function Toaster() {
  const items = useToasts((s) => s.items);
  const dismiss = useToasts((s) => s.dismiss);
  return (
    <div className="ui-toaster" role="status" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className={cx('ui-toast', t.tone === 'error' && 'ui-toast--error')}>
          <span>{t.message}</span>
          {t.action && (
            <button type="button" onClick={() => { t.action!.onClick(); dismiss(t.id); }}>{t.action.label}</button>
          )}
        </div>
      ))}
    </div>
  );
}

/* ---------------------------------------------------------------- Dialog / Sheet */

/**
 * Modal built on native <dialog>. `sheet` makes it a bottom sheet on phones.
 * Closes on Esc and backdrop click.
 */
export function Dialog({
  open, onClose, title, children, footer, sheet, className,
}: { open: boolean; onClose: () => void; title: ReactNode; children?: ReactNode; footer?: ReactNode; sheet?: boolean; className?: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal?.();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      className={cx('ui-dialog', sheet && 'ui-dialog--sheet', className)}
      onCancel={(e) => { e.preventDefault(); onClose(); }}
      onClick={(e) => { if (e.target === ref.current) onClose(); }}
    >
      {open && (
        <>
          <div className="ui-dialog__head">
            <h2 className="ui-dialog__title">{title}</h2>
            <span className="spacer" />
            <IconButton icon="close" label="Close" onClick={onClose} />
          </div>
          {children && <div className="ui-dialog__body">{children}</div>}
          {footer && <div className="ui-dialog__foot">{footer}</div>}
        </>
      )}
    </dialog>
  );
}

/** Promise-free confirm dialog: render it and keep `open` in state. */
export function ConfirmDialog({
  open, title, body, confirmLabel = 'Confirm', danger, onConfirm, onClose,
}: { open: boolean; title: ReactNode; body?: ReactNode; confirmLabel?: string; danger?: boolean; onConfirm: () => void; onClose: () => void }) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant={danger ? 'danger' : 'primary'} onClick={() => { onConfirm(); onClose(); }} autoFocus>{confirmLabel}</Button>
        </>
      }
    >
      {body}
    </Dialog>
  );
}

/* ---------------------------------------------------------------- Menu */

export type MenuItem = { label: ReactNode; icon?: IconName; onSelect: () => void; danger?: boolean; disabled?: boolean } | 'separator';

export function Menu({ label, icon = 'more', items, trigger }: { label: string; icon?: IconName; items: MenuItem[]; trigger?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('pointerdown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);
  return (
    <div className="ui-menu" ref={root}>
      {trigger ? (
        <span onClick={() => setOpen((o) => !o)}>{trigger}</span>
      ) : (
        <IconButton icon={icon} label={label} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)} />
      )}
      {open && (
        <div className="ui-menu__list" role="menu">
          {items.map((it, i) =>
            it === 'separator' ? (
              <div key={i} className="ui-menu__sep" role="separator" />
            ) : (
              <button
                key={i}
                type="button"
                role="menuitem"
                className={cx('ui-menu__item', it.danger && 'ui-menu__item--danger')}
                disabled={it.disabled}
                onClick={() => { setOpen(false); it.onSelect(); }}
              >
                {it.icon && <Icon name={it.icon} size={18} />}
                {it.label}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- EmptyState */

export function EmptyState({ title, children, actions, art }: { title: ReactNode; children?: ReactNode; actions?: ReactNode; art?: ReactNode }) {
  return (
    <div className="ui-empty">
      <div className="ui-empty__art">{art ?? <YarnBall size={72} />}</div>
      <h2 className="ui-empty__title">{title}</h2>
      {children && <p className="ui-empty__body">{children}</p>}
      {actions && <div className="ui-empty__actions">{actions}</div>}
    </div>
  );
}

/** Decorative yarn-ball mark used by empty states and the brand. */
export function YarnBall({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
      <circle cx="30" cy="32" r="22" />
      <path d="M12 22c10 2 26 12 34 26M9 34c12-2 28 4 36 14M18 13c8 6 18 20 20 40M34 10c-2 10 2 30 12 38" />
      <path d="M50 46c4 2 6 6 6 10" />
    </svg>
  );
}

/* ---------------------------------------------------------------- SplitPane */

const SplitCtx = createContext<{ active: string } | null>(null);

/**
 * Two (or more) panes: side by side on desktop (≥ 900 px), a tab strip with one pane at a time on
 * phones. `columns` sets the desktop grid-template-columns.
 */
export function SplitPane({
  panes, columns, defaultPane, className, label = 'View', active: activeProp, onActiveChange,
}: {
  panes: { id: string; label: ReactNode; content: ReactNode }[];
  columns?: string; defaultPane?: string; className?: string; label?: string;
  /** Optional controlled active pane (phones), e.g. to jump to the editor from a diagnostic. */
  active?: string; onActiveChange?: (id: string) => void;
}) {
  const [own, setOwn] = useState(defaultPane ?? panes[0]?.id);
  const active = activeProp ?? own;
  const setActive = (id: string) => { setOwn(id); onActiveChange?.(id); };
  return (
    <SplitCtx.Provider value={{ active }}>
      <div className={cx('ui-split', className)} style={columns ? ({ '--split': columns } as CSSProperties) : undefined}>
        <div className="ui-split__tabs">
          <Tabs label={label} tabs={panes.map((p) => ({ id: p.id, label: p.label }))} value={active} onChange={setActive} />
        </div>
        {panes.map((p) => (
          <div key={p.id} className="ui-split__pane" data-active={p.id === active} data-pane={p.id}>
            {p.content}
          </div>
        ))}
      </div>
    </SplitCtx.Provider>
  );
}
/** Inside a SplitPane: which pane is active on phones (all panes are visible on desktop). */
export const useSplitPane = () => useContext(SplitCtx);

/** The app mark: the eight-loop rosette from the app icon (public/icon.svg). */
export function BrandMark({ size = 28 }: { size?: number }) {
  const loops = [0, 45, 90, 135, 180, 225, 270, 315];
  return (
    <svg width={size} height={size} viewBox="0 0 512 512" aria-hidden="true">
      <rect width="512" height="512" rx="120" fill="var(--accent)" />
      <g fill="none" stroke="var(--accent-ink)" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="256" cy="256" r="44" strokeWidth="30" />
        {loops.map((a) => (
          <path key={a} strokeWidth="28" transform={`rotate(${a} 256 256)`} d="M256 200 C206 150 210 96 256 78 C302 96 306 150 256 200" />
        ))}
      </g>
    </svg>
  );
}
