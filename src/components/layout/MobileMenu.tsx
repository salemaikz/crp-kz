'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import { Link, usePathname } from '@/lib/i18n/navigation';
import { isActivePath, type NavItem } from './nav';

type Props = {
  items: NavItem[];
  navLabel: string;
  openLabel: string;
  closeLabel: string;
  /** Низ панели: пользователь и выход или «Войти» + «Выбрать курс» (рендерится на сервере). */
  footer: ReactNode;
};

/** Кнопка-бургер и выпадающая панель меню для экранов уже 1024 px. */
export function MobileMenu({ items, navLabel, openLabel, closeLabel, footer }: Props) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const panelId = useId();
  const toggleRef = useRef<HTMLButtonElement>(null);

  // Escape закрывает меню и возвращает фокус на кнопку
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        toggleRef.current?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  const close = () => setOpen(false);

  return (
    <>
      <button
        ref={toggleRef}
        type="button"
        className="menu-toggle"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={open ? closeLabel : openLabel}
        onClick={() => setOpen((v) => !v)}
      >
        <span aria-hidden="true" />
      </button>
      <div id={panelId} className="mobile-panel" data-open={open} hidden={!open}>
        <nav aria-label={navLabel}>
          <ul>
            {items.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className="mobile-panel__link"
                  aria-current={isActivePath(pathname, item.href) ? 'page' : undefined}
                  onClick={close}
                >
                  {item.label}
                  <ChevronRight aria-hidden="true" size={20} />
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        {/* клик по ссылке/кнопке внизу панели тоже закрывает меню */}
        <div className="mobile-panel__foot" onClick={close}>
          {footer}
        </div>
      </div>
    </>
  );
}
