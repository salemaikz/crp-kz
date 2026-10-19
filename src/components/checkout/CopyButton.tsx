'use client';

import { useEffect, useState } from 'react';
import { Check, Copy } from 'lucide-react';

type Props = {
  value: string;
  label: string;
  copiedLabel: string;
  /** Подпись для скринридера: «Скопировать: CRP-…». */
  ariaLabel: string;
};

/** Копирование реквизита в буфер; без Clipboard API — через временное поле. */
export function CopyButton({ value, label, copiedLabel, ariaLabel }: Props) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const id = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(id);
  }, [copied]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      const area = document.createElement('textarea');
      area.value = value;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      document.execCommand('copy');
      area.remove();
    }
    setCopied(true);
  };

  return (
    <button type="button" className="co-copy" onClick={copy} data-copied={copied} aria-label={ariaLabel}>
      {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
      <span className="co-copy__text">{copied ? copiedLabel : label}</span>
      <span className="visually-hidden" aria-live="polite">
        {copied ? copiedLabel : ''}
      </span>
    </button>
  );
}
