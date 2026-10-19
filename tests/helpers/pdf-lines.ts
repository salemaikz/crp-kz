// Строки текста готового PDF без внешних утилит: имя шрифта, кегль, текст и ширина в pt.
// Разбор рассчитан на PDF от pdfkit (react-pdf): каждая строка — свой BT … ET с одним TJ,
// шрифт — Type0/Identity-H с таблицей ToUnicode.
import path from 'node:path';
import { inflateSync } from 'node:zlib';
import * as fontkit from 'fontkit';

/** x, y — верх строки от верхнего края листа в pt (сумма сдвигов cm в стеке q/Q на момент BT). */
export type PdfLine = { font: string; size: number; text: string; width: number; x: number; y: number };

type Obj = { dict: string; stream: string | null };

function readObjects(bytes: Uint8Array): Map<number, Obj> {
  const raw = Buffer.from(bytes).toString('latin1');
  const out = new Map<number, Obj>();
  for (const m of raw.matchAll(/(\d+) 0 obj([\s\S]*?)endobj/g)) {
    const body = m[2]!;
    const at = body.indexOf('stream');
    if (at < 0) {
      out.set(Number(m[1]), { dict: body, stream: null });
      continue;
    }
    const data = body.slice(at + 6).replace(/^\r?\n/, '');
    let stream: string | null = null;
    try {
      stream = inflateSync(Buffer.from(data, 'latin1')).toString('latin1');
    } catch {
      /* не сжатый поток (картинка) */
    }
    out.set(Number(m[1]), { dict: body.slice(0, at), stream });
  }
  return out;
}

/** Код глифа → символ из ToUnicode (bfrange с массивом). */
function toUnicode(cmap: string): Map<number, string> {
  const map = new Map<number, string>();
  for (const block of cmap.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const r of block[1]!.matchAll(/<([0-9a-f]{4})>\s*<[0-9a-f]{4}>\s*\[([^\]]*)\]/gi)) {
      let code = parseInt(r[1]!, 16);
      for (const h of r[2]!.matchAll(/<([0-9a-f]{4})>/gi)) map.set(code++, String.fromCharCode(parseInt(h[1]!, 16)));
    }
  }
  return map;
}

const fonts = new Map<string, fontkit.Font>();
function openFont(file: string): fontkit.Font {
  let f = fonts.get(file);
  if (!f) fonts.set(file, (f = fontkit.openSync(path.join(process.cwd(), 'assets/fonts/pdf', file))));
  return f;
}

/** Файл среза по PostScript-имени из PDF (Geologica-SharpBold, Onest-Regular, Onest-SemiBold). */
function fileOf(baseFont: string): string {
  if (baseFont.includes('Geologica')) return 'Geologica-Bold-SHRP100.ttf';
  return baseFont.includes('SemiBold') ? 'Onest-SemiBold.ttf' : 'Onest-Regular.ttf';
}

/**
 * Все строки текста первой страницы по порядку. Ширина = сумма номинальных advance глифов шрифта
 * минус поправки TJ (в них уже трекинг и кернинг), то есть ровно то, что нарисовано.
 */
export function pdfLines(bytes: Uint8Array): PdfLine[] {
  const objs = readObjects(bytes);
  const page = [...objs.values()].find((o) => /\/Type \/Page\b(?!s)/.test(o.dict))!;
  const resRef = Number(/\/Resources (\d+) 0 R/.exec(page.dict)![1]);
  const contentRef = Number(/\/Contents (\d+) 0 R/.exec(page.dict)![1]);
  const fontRes = /\/Font <<([\s\S]*?)>>/.exec(objs.get(resRef)!.dict)![1]!;

  const byName = new Map<string, { baseFont: string; uni: Map<number, string> }>();
  for (const m of fontRes.matchAll(/\/(\w+) (\d+) 0 R/g)) {
    const dict = objs.get(Number(m[2]))!.dict;
    const baseFont = /\/BaseFont \/([^\s/]+)/.exec(dict)![1]!;
    const uni = toUnicode(objs.get(Number(/\/ToUnicode (\d+) 0 R/.exec(dict)![1]))!.stream!);
    byName.set(m[1]!, { baseFont, uni });
  }

  const content = objs.get(contentRef)!.stream!;
  const lines: PdfLine[] = [];
  // положение строки: страница перевёрнута один раз в начале, дальше вёрстка двигает системой координат
  // только сдвигами «1 0 0 1 x y cm»; масштабы и отражения (логотип, переворот перед BT) значения не меняют
  const stack: [number, number][] = [[0, 0]];
  for (const m of content.matchAll(/^(q|Q|1 0 0 1 (-?[\d.]+) (-?[\d.]+) cm|BT[\s\S]*?\nET)$/gm)) {
    const op = m[1]!;
    if (op === 'q') stack.push([...stack[stack.length - 1]!] as [number, number]);
    else if (op === 'Q') stack.pop();
    else if (m[2] !== undefined) {
      const top = stack[stack.length - 1]!;
      top[0] += Number(m[2]);
      top[1] += Number(m[3]);
    }
    if (!op.startsWith('BT')) continue;
    const [bx, by] = stack[stack.length - 1]!;
    const tf = /\/(\w+) ([\d.]+) Tf/.exec(op);
    const tj = /\[([^\]]*)\] TJ/.exec(op);
    if (!tf || !tj) continue;
    const f = byName.get(tf[1]!)!;
    const size = Number(tf[2]);
    const font = openFont(fileOf(f.baseFont));
    // номинальный advance символа берём у шрифта; код глифа → символ через ToUnicode
    let text = '';
    let adv = 0;
    let adjust = 0;
    for (const t of tj[1]!.matchAll(/<([0-9a-f]+)>|(-?[\d.]+)/gi)) {
      if (t[2] !== undefined) {
        adjust += Number(t[2]);
        continue;
      }
      for (let i = 0; i < t[1]!.length; i += 4) {
        const ch = f.uni.get(parseInt(t[1]!.slice(i, i + 4), 16)) ?? '';
        text += ch;
        if (ch) adv += font.glyphForCodePoint(ch.codePointAt(0)!).advanceWidth;
      }
    }
    lines.push({ font: f.baseFont, size, text, width: (adv / font.unitsPerEm) * size - (adjust / 1000) * size, x: bx, y: by });
  }
  return lines;
}
