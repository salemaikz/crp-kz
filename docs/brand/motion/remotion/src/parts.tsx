// Общие части роликов: счётчик, смена текста на месте, финальная карточка.
import React from 'react';
import { AbsoluteFill, Img, interpolate, staticFile } from 'remotion';
import { body, C, IN_OUT, OUT } from './brand';

export const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;

// Цифры у шрифтов без табличных цифр: каждая — в ячейке одной ширины, чтобы счётчик не дрожал.
export const Counter: React.FC<{ value: number }> = ({ value }) => (
  <>
    {value
      .toString()
      .replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
      .split('')
      .map((ch, i) => (
        <span key={i} style={{ display: 'inline-block', width: ch === ' ' ? '0.24em' : '0.64em', textAlign: 'center' }}>
          {ch}
        </span>
      ))}
  </>
);

// Смена текста на месте: старый уходит вверх из-под маски, новый приходит снизу.
export const Roll: React.FC<{ t: number; at: number; from: string; to: string }> = ({ t, at, from, to }) => (
  <span style={{ display: 'inline-grid', overflow: 'hidden', verticalAlign: 'top' }}>
    <span style={{ gridArea: '1 / 1', translate: interpolate(t, [at, at + 0.6], ['0px 0%', '0px -110%'], { ...clamp, easing: IN_OUT }) }}>{from}</span>
    <span style={{ gridArea: '1 / 1', translate: interpolate(t, [at, at + 0.6], ['0px 110%', '0px 0%'], { ...clamp, easing: IN_OUT }) }}>{to}</span>
  </span>
);

// Финал: тёмная панель поднимается снизу; белый логотип, запись на разбор (кнопка с crp.kz), адрес.
export const EndCard: React.FC<{ t: number; at: number }> = ({ t, at }) => {
  const appear = (delay: number) => ({
    opacity: interpolate(t, [at + delay, at + delay + 0.7], [0, 1], clamp),
    translate: interpolate(t, [at + delay, at + delay + 0.7], ['0px 16px', '0px 0px'], { ...clamp, easing: OUT }),
  });
  return (
    <AbsoluteFill
      style={{
        background: C.deep,
        alignItems: 'center',
        justifyContent: 'center',
        translate: interpolate(t, [at, at + 0.9], ['0px 1080px', '0px 0px'], { ...clamp, easing: IN_OUT }),
      }}
    >
      <Img src={staticFile('crp-logo-white.svg')} style={{ width: 600, ...appear(0.7) }} />
      <div
        style={{
          ...body,
          marginTop: 96,
          height: 84,
          padding: '0 48px',
          borderRadius: 999,
          background: C.red,
          color: C.paper,
          fontSize: 30,
          fontWeight: 600,
          display: 'flex',
          alignItems: 'center',
          ...appear(1.1),
        }}
      >
        Записаться на бесплатный разбор
      </div>
      <div style={{ ...body, marginTop: 36, fontSize: 28, color: C.onNight2, ...appear(1.3) }}>crp.kz</div>
    </AbsoluteFill>
  );
};
