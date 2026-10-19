// Путь к срезам шрифтов отдельным лёгким модулем: маршрут проверяет глифы, не подгружая react-pdf.
import path from 'node:path';

export const PDF_FONT_DIR = path.join(process.cwd(), 'assets/fonts/pdf');
