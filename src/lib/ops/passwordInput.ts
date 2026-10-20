// Ввод пароля для CLI: одна строка из stdin или приглашение без эха. Пароль не попадает ни в argv, ни в вывод.

/** Одна строка из потока (без перевода строки). Пустой поток — пустая строка. */
export async function readLine(stream: AsyncIterable<string | Buffer>): Promise<string> {
  let buf = '';
  for await (const chunk of stream) {
    buf += chunk.toString();
    const i = buf.indexOf('\n');
    if (i >= 0) return buf.slice(0, i).replace(/\r$/, '');
  }
  return buf.replace(/\r$/, '');
}

/** Приглашение без эха (raw-режим TTY). Подсказка идёт в stderr, пароль не печатается. */
export function promptHidden(label: string): Promise<string> {
  const stdin = process.stdin;
  if (!stdin.isTTY) return Promise.reject(new Error('Нет терминала: используйте --password-stdin.'));
  return new Promise((resolve, reject) => {
    process.stderr.write(label);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    let chars: string[] = [];
    const finish = (fn: () => void) => {
      stdin.removeListener('data', onData);
      stdin.setRawMode(false);
      stdin.pause();
      process.stderr.write('\n');
      fn();
    };
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n' || ch === '\u0004') return finish(() => resolve(chars.join('')));
        if (ch === '\u0003') return finish(() => reject(new Error('Ввод отменён.')));
        if (ch === '\u007f' || ch === '\b') chars = chars.slice(0, -1);
        else chars.push(ch);
      }
    };
    stdin.on('data', onData);
  });
}
