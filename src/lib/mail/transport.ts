// Внешний транспорт почты. Адаптера нет и зависимостей не добавляем: письма остаются в очереди
// и видны на странице «Письма» (D-030). Интерфейс готов под SMTP-адаптер отдельной задачей,
// когда владелец выберет провайдера (D-009).
import { mailTransportName } from './config';

export interface MailTransport {
  readonly name: 'smtp';
  send(m: {
    id: string;
    from: string;
    replyTo?: string;
    to: string;
    subject: string;
    text: string;
    html: string;
  }): Promise<{ providerId?: string }>;
}

/** null — транспорт outbox: письма никуда не отправляются. Пока так и для любого другого значения. */
export async function resolveTransport(): Promise<MailTransport | null> {
  if (mailTransportName() === 'outbox') return null;
  // сюда не попасть, пока mailTransportName() не умеет ничего, кроме outbox
  return null;
}
