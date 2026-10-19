// Сумма прописью для счёта: «Сорок девять тысяч тенге 00 тиын» / «Қырық тоғыз мың теңге 00 тиын».
// Целые тенге (деньги в БД — BIGINT в целых тенге), до миллиардов.

type Forms = [one: string, few: string, many: string];

const RU = {
  unitsM: ['', 'один', 'два', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять'],
  unitsF: ['', 'одна', 'две', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять'],
  teens: [
    'десять',
    'одиннадцать',
    'двенадцать',
    'тринадцать',
    'четырнадцать',
    'пятнадцать',
    'шестнадцать',
    'семнадцать',
    'восемнадцать',
    'девятнадцать',
  ],
  tens: ['', '', 'двадцать', 'тридцать', 'сорок', 'пятьдесят', 'шестьдесят', 'семьдесят', 'восемьдесят', 'девяносто'],
  hundreds: ['', 'сто', 'двести', 'триста', 'четыреста', 'пятьсот', 'шестьсот', 'семьсот', 'восемьсот', 'девятьсот'],
};

const RU_SCALES: Array<{ forms: Forms; female: boolean } | null> = [
  null,
  { forms: ['тысяча', 'тысячи', 'тысяч'], female: true },
  { forms: ['миллион', 'миллиона', 'миллионов'], female: false },
  { forms: ['миллиард', 'миллиарда', 'миллиардов'], female: false },
];

function ruPlural(n: number, forms: Forms): string {
  const n100 = n % 100;
  const n10 = n % 10;
  if (n100 >= 11 && n100 <= 14) return forms[2];
  if (n10 === 1) return forms[0];
  if (n10 >= 2 && n10 <= 4) return forms[1];
  return forms[2];
}

function ruTriad(n: number, female: boolean): string[] {
  const out: string[] = [];
  const h = Math.floor(n / 100);
  const rest = n % 100;
  if (h) out.push(RU.hundreds[h] as string);
  if (rest >= 10 && rest < 20) {
    out.push(RU.teens[rest - 10] as string);
  } else {
    const t = Math.floor(rest / 10);
    const u = rest % 10;
    if (t) out.push(RU.tens[t] as string);
    if (u) out.push((female ? RU.unitsF : RU.unitsM)[u] as string);
  }
  return out;
}

const KZ = {
  units: ['', 'бір', 'екі', 'үш', 'төрт', 'бес', 'алты', 'жеті', 'сегіз', 'тоғыз'],
  tens: ['', 'он', 'жиырма', 'отыз', 'қырық', 'елу', 'алпыс', 'жетпіс', 'сексен', 'тоқсан'],
  scales: ['', 'мың', 'миллион', 'миллиард'],
};

function kzTriad(n: number): string[] {
  const out: string[] = [];
  const h = Math.floor(n / 100);
  const t = Math.floor((n % 100) / 10);
  const u = n % 10;
  if (h) out.push(KZ.units[h] as string, 'жүз');
  if (t) out.push(KZ.tens[t] as string);
  if (u) out.push(KZ.units[u] as string);
  return out;
}

function triads(n: number): number[] {
  const out: number[] = [];
  let rest = n;
  while (rest > 0) {
    out.push(rest % 1000);
    rest = Math.floor(rest / 1000);
  }
  return out; // младшие разряды первыми
}

/** Целое число прописью (без валюты), с маленькой буквы. */
export function numberInWords(value: number, locale: string): string {
  const n = Math.floor(Math.abs(value));
  if (n >= 1e12) throw new Error('numberInWords: too large');
  const kz = locale === 'kz';
  if (n === 0) return kz ? 'нөл' : 'ноль';
  const parts: string[] = [];
  const groups = triads(n);
  for (let i = groups.length - 1; i >= 0; i--) {
    const g = groups[i] as number;
    if (!g) continue;
    if (kz) {
      parts.push(...kzTriad(g));
      if (i > 0) parts.push(KZ.scales[i] as string);
    } else {
      const scale = RU_SCALES[i];
      parts.push(...ruTriad(g, scale?.female ?? false));
      if (scale) parts.push(ruPlural(g, scale.forms));
    }
  }
  return parts.join(' ');
}

/** Сумма в тенге прописью для документа: «Сорок девять тысяч тенге 00 тиын». */
export function amountInWords(kzt: number, locale: string): string {
  const words = numberInWords(kzt, locale);
  const currency = locale === 'kz' ? 'теңге' : 'тенге';
  const text = `${words} ${currency} 00 тиын`;
  return text.charAt(0).toUpperCase() + text.slice(1);
}
