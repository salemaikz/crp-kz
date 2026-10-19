import type { InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';
import { cn } from './cn';

type Invalid = { invalid?: boolean };

/** Текстовое поле: белое, рамка, радиус 12 px, фокус — графит + кольцо. */
export function Input({ className, invalid, ...rest }: InputHTMLAttributes<HTMLInputElement> & Invalid) {
  return <input className={cn('input', className)} aria-invalid={invalid || undefined} {...rest} />;
}

/** Выпадающий список (нативный select со своей стрелкой). */
export function Select({ className, invalid, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement> & Invalid) {
  return (
    <select className={cn('select', className)} aria-invalid={invalid || undefined} {...rest}>
      {children}
    </select>
  );
}

/** Многострочное поле. */
export function Textarea({ className, invalid, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement> & Invalid) {
  return <textarea className={cn('textarea', className)} aria-invalid={invalid || undefined} {...rest} />;
}
