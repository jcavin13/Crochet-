import type { ReactNode } from 'react';

/** Page wrapper: consistent max-width and padding. `wide` for tool pages (editor, chart, 3D). */
export function Page({ children, wide, className }: { children: ReactNode; wide?: boolean; className?: string }) {
  return <div className={['ui-page', wide && 'ui-page--wide', className].filter(Boolean).join(' ')}>{children}</div>;
}

/** Page title row: title, optional kicker/description, and right-aligned actions. */
export function PageHeader({ title, kicker, description, actions }: { title: ReactNode; kicker?: ReactNode; description?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="ui-pagehead">
      <div className="ui-pagehead__text">
        {kicker && <div className="ui-pagehead__kicker">{kicker}</div>}
        <h1 className="ui-pagehead__title">{title}</h1>
        {description && <p className="ui-pagehead__desc">{description}</p>}
      </div>
      {actions && <div className="ui-pagehead__actions">{actions}</div>}
    </header>
  );
}

export function Section({ title, actions, children, id }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; id?: string }) {
  return (
    <section className="ui-section" id={id}>
      {(title || actions) && (
        <div className="ui-section__head">
          {title && <h2 className="ui-section__title">{title}</h2>}
          {actions && <div className="row">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}
