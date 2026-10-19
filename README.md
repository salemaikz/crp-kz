<p>
  <img src="docs/brand/logo/crp-logo.svg" alt="Центр Развития Предпринимателей" width="320">
</p>

# Платформа обучения ЦРП

Платформа для **Центра Развития Предпринимателей** (crp.kz):

- **обучение сотрудников ЦРП** — курсы, назначения со сроками, тесты, отчёты руководителю;
- **платные курсы для клиентов ЦРП** — курс публикуется, клиент оплачивает, после подтверждения оплаты получает доступ;
- позже — **места для сотрудников компаний-клиентов** (B2B).

Разработка — SalemAI. Статус: **MVP собран** — витрина, курсы с тестами,
сертификаты с QR, покупка с подтверждением админом, назначения и отчёт
руководителя, конструктор курсов, ru/kz. Стиль — как редизайн сайта ЦРП.

## Посмотреть

Скриншоты основных экранов — [`docs/screens/mvp-overview.png`](docs/screens/mvp-overview.png).

**Локально** (Node 22):

```bash
npm install
npm run dev        # http://localhost:3000 — демо без базы, данные из сида
```

**Превью в Vercel** (один раз):
1. Vercel → Add New → Project → импортировать `salemaikz/crp-kz`.
2. Нажать Deploy — переменные не нужны: без `DATABASE_URL` на Vercel
   включается демо (D-019).

Пока нет ветки `main`, рабочая ветка — `claude/amazing-pascal-agse3o`.

**Демо-доступ** — кнопки на странице входа (пароль для всех `demo12345`):

| Кто | Что посмотреть |
|---|---|
| Предприниматель (`client@crp.demo`) | «Моё обучение», урок с тестом, сертификат |
| Сотрудник ЦРП (`operator@crp.demo`) | назначенный курс со сроком, уроки по порядку |
| Руководитель (`manager@crp.demo`) | «Команда»: назначить курс, отчёт, выгрузка CSV |
| Администратор (`admin@crp.demo`) | конструктор курсов, заказы («Оплачено»), пользователи |

Покупка: войти → курс → «Купить» → заказ → под администратором «Оплачено» →
доступ открыт. Тексты курсов — демо, цены — заглушки до материалов ЦРП.

## Проверки

`npm run typecheck` · `npm run lint` · `npm run test:unit` ·
`npm run test:integration` · `npm run build` · `npm run test:e2e`

## С чего начать

| Кто | Что читать |
|---|---|
| Любой агент или разработчик | [`AGENTS.md`](AGENTS.md) — правила работы |
| Claude Code | [`CLAUDE.md`](CLAUDE.md) — оркестратор и уровни моделей |
| Что строим | [`docs/lms/SPEC.md`](docs/lms/SPEC.md), [`docs/lms/ROADMAP.md`](docs/lms/ROADMAP.md) |
| Кто чем занят | [`docs/WORKSTREAMS.md`](docs/WORKSTREAMS.md) |
| Почему так решили | [`DECISIONS.md`](DECISIONS.md) |
| Как выглядит | [`docs/brand/BRAND.md`](docs/brand/BRAND.md) |
| Заказчик | [`docs/context/CRP.md`](docs/context/CRP.md) |

Задачи — в [Issues](https://github.com/salemaikz/crp-kz/issues). Метка
`tier:T0/T1/T2→T1/T2` показывает, какой модели отдавать задачу
([`docs/agents/ROUTING.md`](docs/agents/ROUTING.md)).
