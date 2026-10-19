import type { ReactNode } from 'react';
import { buttonClass } from '@/components/ui';

type Props = {
  /** Полный путь с локалью: /{locale}/learn/{slug}/certificate/pdf. */
  href: string;
  children: ReactNode;
  /** Кнопка на странице сертификата или ссылка в списке «Моё обучение». */
  variant?: 'button' | 'text';
  testId?: string;
};

/**
 * Ссылка на PDF сертификата. Обычный <a>, а не next/link: у Link был бы prefetch,
 * и страница в фоне запускала бы генерацию файла. Без атрибута download: файл скачивается по
 * Content-Disposition маршрута, а редирект на вход, 404 и 429 открываются обычной навигацией
 * (с download браузер сохранил бы страницу входа как файл).
 */
export function CertificatePdfLink({ href, children, variant = 'button', testId }: Props) {
  return (
    <a href={href} className={variant === 'button' ? buttonClass({ variant: 'primary' }) : 'text-link'} data-testid={testId}>
      {children}
    </a>
  );
}
