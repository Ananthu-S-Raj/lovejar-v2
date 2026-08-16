import type { ReactNode } from "react";

type Props = {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
};

export default function AdminCard({ title, subtitle, actions, children, className }: Props) {
  return (
    <section className={"admin-card" + (className ? ` ${className}` : "")}>
      {(title || subtitle || actions) && (
        <header className="admin-card-head">
          <div>
            {title && <h3 className="admin-card-title">{title}</h3>}
            {subtitle && <p className="admin-card-subtitle">{subtitle}</p>}
          </div>
          {actions && <div className="admin-card-actions">{actions}</div>}
        </header>
      )}
      <div className="admin-card-body">{children}</div>
    </section>
  );
}
