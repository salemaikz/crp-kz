import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from 'react';
import type { Locale } from '@/lib/content/types';
import { Link } from '@/lib/i18n/navigation';
import { cn } from './cn';
import { isExternalHref } from './href';

export type ButtonVariant = 'primary' | 'ghost' | 'light' | 'dark';
export type ButtonSize = 'sm' | 'md' | 'lg';

type BaseProps = {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** На всю ширину контейнера. */
  block?: boolean;
  /** Только иконка (тогда обязателен aria-label). */
  iconOnly?: boolean;
  className?: string;
  children?: ReactNode;
};

export type ButtonAsButton = BaseProps &
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className' | 'children'> & { href?: undefined };

export type ButtonAsLink = BaseProps &
  Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'className' | 'children' | 'href'> & {
    /** Путь без локали ('/courses') — префикс добавится сам; http/mailto/tel — обычная ссылка. */
    href: string;
    /** Сменить локаль (для внутренних ссылок). */
    locale?: Locale;
    /** Принудительно обычный <a> без локализации. */
    external?: boolean;
    prefetch?: boolean;
  };

export type ButtonProps = ButtonAsButton | ButtonAsLink;

/** Классы кнопки — для своих элементов (например, <summary> или чужого Link). */
export function buttonClass({
  variant = 'primary',
  size = 'md',
  block,
  iconOnly,
  className,
}: Pick<BaseProps, 'variant' | 'size' | 'block' | 'iconOnly' | 'className'> = {}): string {
  return cn(
    'btn',
    `btn--${variant}`,
    size !== 'md' && `btn--${size}`,
    block && 'btn--block',
    iconOnly && 'btn--icon',
    className,
  );
}

function isLink(props: ButtonProps): props is ButtonAsLink {
  return typeof props.href === 'string';
}

/**
 * Кнопка-«пилюля» ЦРП. С href рендерит локализованную ссылку.
 * primary — одна главная красная на экран; ghost — обводка; light — белая на тёмном; dark — графит.
 */
export function Button(props: ButtonProps) {
  if (isLink(props)) {
    const { variant, size, block, iconOnly, className, children, href, locale, external, prefetch, ...rest } = props;
    const cls = buttonClass({ variant, size, block, iconOnly, className });
    if (external || isExternalHref(href)) {
      return (
        <a href={href} className={cls} {...rest}>
          {children}
        </a>
      );
    }
    return (
      <Link href={href} locale={locale} prefetch={prefetch} className={cls} {...rest}>
        {children}
      </Link>
    );
  }
  const { variant, size, block, iconOnly, className, children, type = 'button', ...rest } = props;
  return (
    <button type={type} className={buttonClass({ variant, size, block, iconOnly, className })} {...rest}>
      {children}
    </button>
  );
}
