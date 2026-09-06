# Shared -- Библиотека компонентов для прототипов

> Библиотека стилей и компонентов продукта АРКА. Покрытие: 100% токенов и общих компонентов продукта.

## Оглавление

1. [Файлы](#1-файлы)
2. [Подключение](#2-подключение)
3. [Токены](#3-токены)
4. [Типографика](#4-типографика)
5. [Компоненты](#5-компоненты)
6. [Layout](#6-layout)
7. [Утилиты](#7-утилиты)
8. [Иконки](#8-иконки)

---

## 1. Файлы

| Файл | Что содержит |
|---|---|
| `tokens.css` | Все CSS-переменные (400+ цветов, типографика, спейсинг, радиусы, тени, z-index, анимации, брейкпоинты, компонентные токены), reset, системный шрифтовой стек |
| `components.css` | 28 UI-компонентов (Badge, Button, FunctionButton, CloseButton, Input, Select, Checkbox, RadioGroup, Toggle, Tabs, Chip, Avatar, Table, Tooltip, Loader/Skeleton, Label, TextLink, EmptyState, FieldFeedback, Popover/Dropdown, BottomSheet, Accordion, Favorite, Shortcut, Markdown, ChatFAB, DataBlocked, DefinitionList) |
| `layout.css` | Sidebar (+ collapsed), Main Content, Page Header, Panel Card, Tile Grid, Mobile Header, Router Tabs, 150+ утилит-классов |
| `icons.svg` | SVG-спрайт со 107 иконками из продукта (все кроме сезонных и анимированных) |
| `sidebar.js` | Scroll border indicators для навигации |
| `templates/` | Готовые HTML-референсы для сборки прототипов: `components/` (каталоги примитивов), `patterns/` (композиции), `pages/` (скелеты страниц). |

---

## 2. Подключение

```html
<link rel="stylesheet" href="../shared/tokens.css">
<link rel="stylesheet" href="../shared/components.css">
<link rel="stylesheet" href="../shared/layout.css">
<script src="../shared/sidebar.js"></script>
```

Порядок важен: `tokens.css` первым (определяет CSS-переменные), затем `components.css` и `layout.css`.

**Иконки** подключаются через `<use>`:

```html
<svg width="24" height="24"><use href="../shared/icons.svg#check-circle"/></svg>
```

---

## 3. Токены

### 3.1. Цвета

**Палитры (12 штук):** accent, neutral, success, error, warning, info, status01-06

Каждая палитра содержит:
- 19 оттенков (0-1000)
- Семантические алиасы: default, soft, muted, hover, active, on-color, on-container
- Контейнеры: container-default/soft/muted/hover/active
- Непрозрачные контейнеры: opaque-container-default/soft/muted/hover/active

**Именование переменных:** `--{palette}-{alias}` или `--{palette}-{shade}`

| Палитра | Default (500) | Использование |
|---|---|---|
| accent | #f76707 | Бренд, основные действия |
| neutral | #495670 | Текст, нейтральные элементы |
| success | #0aa648 | Успех, здоровье |
| error | #de1b1b | Ошибки, удаление |
| warning | #f29100 | Предупреждения |
| info | #0987ed | Информация |
| status01 | #0b877f | Teal -- статус |
| status02 | #107eb5 | Steel blue -- статус |
| status03 | #6b6be8 | Purple -- статус |
| status04 | #9250d4 | Violet -- статус |
| status05 | #d4226c | Pink -- статус |
| status06 | #ab5f02 | Brown -- статус |

**Фон:** `--bg-page` (#f4f4f6), `--bg-surface-0` через `--bg-surface-5`

**Текст:** `--fg-default` (#0f1116), `--fg-soft` (#495670), `--fg-muted` (#8991a2), `--fg-disabled` (rgba(73,86,112,0.5))

**Границы:** `--border-default` (rgba(73,86,112,0.5)), `--border-soft` (rgba(73,86,112,0.25)), `--border-muted` (rgba(73,86,112,0.15))

**Фокус:** `--focus-default` (rgba(247,103,7,0.25))

### 3.2. Спейсинг

Base 4px. Значения: 1, 2, 4, 6, 8, 12, 16, 20, 24, 32, 40, 48, 64, 80, 96, 128, 192 (px)

Переменная: `--spacing-{value}`, например `var(--spacing-16)`

### 3.3. Размеры

`--size-{value}`: 4, 8, 12, 16, 20, 24, 28, 32, 36, 48, 56, 64 (px)

### 3.4. Радиусы

`--radius-{value}`: 2, 4, 6, 8, 10, 12, 16, 24, full (9999px)

Специальные: `--radius-inputs` (8px), `--radius-buttons` (8px), `--radius-controls` (4px)

### 3.5. Тени

| Токен | Значение |
|---|---|
| `--shadow-sm` | 0px 0px 6px rgba(73,86,112,0.02), 0px 2px 4px rgba(73,86,112,0.12) |
| `--shadow-md` | 0px 0px 4px rgba(73,86,112,0.04), 0px 4px 8px rgba(73,86,112,0.12) |
| `--shadow-lg` | 0px 0px 4px rgba(73,86,112,0.04), 0px 8px 16px rgba(73,86,112,0.12) |

### 3.6. Z-Index

| Токен | Значение |
|---|---|
| `--z-always-below` | -1 |
| `--z-base` | 1 |
| `--z-old-menu` | 10 |
| `--z-sticky-content` | 2000 |
| `--z-sticky-tabs` | 3000 |
| `--z-menu` | 5000 |
| `--z-modal` | 8000 |
| `--z-notifications` | 9000 |
| `--z-popover` | 11000 |
| `--z-tooltip` | 12000 |
| `--z-drag-overlay` | 13000 |

### 3.7. Анимации

| Токен | Значение |
|---|---|
| `--duration-fast` | 0.1s |
| `--duration-medium` | 0.2s |
| `--duration-slow` | 0.3s |
| `--duration-pulse` | 2s |
| `--easing-pulse` | cubic-bezier(0.4, 0, 0.6, 1) |

### 3.8. Брейкпоинты

| Имя | Диапазон | Колонки | Grid Gap | Grid Padding |
|---|---|---|---|---|
| SM | 320-767px | 4 | 16px | 16px |
| MD | 768-1279px | 6 | 24px | 24px |
| LG | 1280-1919px | 8 | 24px | 48px |
| XL | 1920px+ | 8 | 24px | 48px |

### 3.9. Компонентные токены

| Токен | Значение |
|---|---|
| `--nav-width` | 248px |
| `--nav-width-collapsed` | 72px |
| `--mobile-header-sm` | 64px |
| `--mobile-header-md` | 80px |
| `--btn-sm` / `--btn-md` / `--btn-lg` | 24px / 36px / 48px |
| `--btn-icon-sm` / `--btn-icon-md` / `--btn-icon-lg` | 16px / 20px / 24px |
| `--close-btn-lg` / `--close-btn-md` / `--close-btn-sm` / `--close-btn-xs` | 24px / 20px / 16px / 12px |
| `--input-width-default` | 240px |
| `--avatar-size` | 24px |
| `--popover-max-height` | 300px |
| `--scrollbar-size` | 8px |
| `--table-fn-cell-w` | 36px |
| `--table-border-r` | 8px |
| `--tabs-height` | 38px |
| `--tile-min-w-sm` / `--tile-min-w-md` / `--tile-min-w-lg` | 244px / 296px / 428px |

---

## 4. Типографика

Шрифт: **Graphik** (400 Regular, 500 Medium, 700 Bold)

| Класс | Размер | Вес | Высота строки | Доп. |
|---|---|---|---|---|
| `display-lg` | 48px | 500 | 52px | lining-nums tabular-nums |
| `display-lg-strong` | 48px | 700 | 52px | |
| `display-md` | 42px | 500 | 44px | |
| `display-md-strong` | 42px | 700 | 44px | |
| `display-sm` | 32px | 500 | 44px | |
| `display-sm-strong` | 32px | 700 | 44px | |
| `heading-1` | 28px | 700 | 32px | |
| `heading-2` | 22px | 700 | 24px | |
| `heading-3` | 18px | 700 | 20px | |
| `heading-4` | 16px | 700 | 20px | |
| `heading-5` | 14px | 700 | 20px | |
| `body-lg` | 18px | 400 | 24px | lining-nums tabular-nums |
| `body-lg-strong` | 18px | 500 | 24px | |
| `body-md` | 16px | 400 | 24px | |
| `body-md-strong` | 16px | 500 | 24px | |
| `body-sm` | 14px | 400 | 20px | |
| `body-sm-strong` | 14px | 500 | 20px | |
| `desc-lg` | 12px | 400 | 16px | lining-nums tabular-nums |
| `desc-lg-strong` | 12px | 500 | 16px | |
| `desc-md` | 11px | 400 | 16px | letter-spacing: 0.2px |
| `desc-md-strong` | 11px | 500 | 16px | letter-spacing: 0.2px |
| `desc-sm` | 10px | 400 | 12px | letter-spacing: 0.4px |
| `desc-sm-strong` | 10px | 500 | 12px | letter-spacing: 0.4px |

---

## 5. Компоненты

### 5.1. Badge

Статусные метки. Три размера, 12 цветов, 3 темы.

**Размеры:** `badge-lg` (24px), `badge-md` (20px), `badge-sm` (16px)

**Цвета:** `badge-neutral`, `badge-accent`, `badge-success`, `badge-error`, `badge-warning`, `badge-info`, `badge-status01` - `badge-status06`

**Темы:**
- По умолчанию (без суффикса) -- light: полупрозрачный фон 5%, цветной текст
- `-default` -- container: полупрозрачный фон 10-12%, цветной текст
- `-sat` -- saturated: залитый фон 500, белый текст

**Дополнительные элементы:** `.badge-text` (внутренний padding), `.badge-dot` (SVG-точка 16x16), `.badge-counter` (pill-форма)

```html
<span class="badge badge-lg badge-success">
  <span class="badge-text">Здорова</span>
</span>

<span class="badge badge-md badge-accent-sat">
  <span class="badge-text">Новая</span>
</span>

<span class="badge badge-sm badge-error-default">
  <svg class="badge-dot" viewBox="0 0 22 22" fill="none">
    <circle cx="11" cy="11" r="5.84" fill="currentColor"/>
  </svg>
  <span class="badge-text">Больна</span>
</span>
```

### 5.2. Button

Кнопки действий. Три размера, 9 вариантов (3 стиля x 3 цвета).

**Размеры:** `btn-lg` (48px, 16/500/24), `btn-md` (36px, 14/500/20), `btn-sm` (24px, 12/500/16)

**Варианты:**

| Стиль | Accent | Neutral | Destructive |
|---|---|---|---|
| Primary | `btn-primary-accent` | `btn-primary-neutral` | `btn-primary-destructive` |
| Secondary | `btn-secondary-accent` | `btn-secondary-neutral` | `btn-secondary-destructive` |
| Ghost | `btn-ghost-accent` | `btn-ghost-neutral` | `btn-ghost-destructive` |

**Состояния:** `:disabled` / `.disabled`, `.loading`

```html
<button class="btn btn-md btn-primary-accent">
  <span class="btn-text">Сохранить</span>
</button>

<button class="btn btn-sm btn-secondary-neutral">
  <svg width="16" height="16">...</svg>
  <span class="btn-text">Фильтры</span>
</button>

<button class="btn btn-lg btn-primary-destructive" disabled>
  <span class="btn-text">Удалить</span>
</button>
```

### 5.3. Function Button

Иконочная кнопка без текста. Прозрачный фон, только цвет иконки.

**Варианты:** `fn-btn-primary` (accent), `fn-btn-secondary` (fg-soft), `fn-btn-tertiary` (fg-muted), `fn-btn-failure` (error)

```html
<button class="fn-btn fn-btn-secondary">
  <svg width="20" height="20">...</svg>
</button>
```

### 5.4. Close Button

Кнопка закрытия. Четыре размера.

**Размеры:** `close-btn-lg` (24px), `close-btn-md` (20px), `close-btn-sm` (16px), `close-btn-xs` (12px)

```html
<button class="close-btn close-btn-md">
  <svg width="16" height="16">...</svg>
</button>
```

### 5.5. Input

Текстовое поле ввода.

**Размеры:** `input-lg` (48px, 16/400/24), `input-md` (36px, 14/400/20), `input-sm` (24px, 12/400/16)

**Темы:** `input-light` (белый фон, прозрачная граница), `input-dark` (серый фон, прозрачная граница)

**Состояния:** `input-error`, `:disabled`

**Дочерние элементы:** `.input-label`, `.input-label .required`, `.input-feedback` (`.input-feedback-error`, `.input-feedback-info`), `.textarea`

```html
<div class="input-wrap">
  <label class="input-label">Email <span class="required">*</span></label>
  <input class="input input-md input-light" placeholder="Введите email">
  <div class="input-feedback input-feedback-error">Обязательное поле</div>
</div>
```

### 5.6. Select

Выпадающий список. Использует те же размеры и темы, что и Input.

**Элементы:** `.select-trigger`, `.select-icon` (16x16), `.select-chevron` (16x16, авто-поворот), `.select-dropdown`, `.select-option`, `.select-option.selected`, `.select-search`

```html
<div class="select-trigger input-md input-light">
  <svg class="select-icon" width="16" height="16">...</svg>
  <span>Выберите...</span>
  <svg class="select-chevron" width="16" height="16">...</svg>
</div>

<div class="select-dropdown">
  <div class="select-option">Опция 1</div>
  <div class="select-option selected">Опция 2</div>
</div>
```

### 5.7. Checkbox

Чекбокс. Три размера бокса.

**Размеры бокса:** `checkbox-box-16`, `checkbox-box-20`, `checkbox-box-24`

**Состояния:** `.checked`, `.indeterminate`, `.disabled`

```html
<label class="checkbox checked">
  <div class="checkbox-box checkbox-box-20">&#10003;</div>
  <span class="checkbox-label">Активна</span>
</label>
```

### 5.8. Radio Group

Радио-кнопки. Два варианта отображения.

**Standard radio:**

```html
<div class="radio-group">
  <label class="radio checked">
    <div class="radio-circle"></div>
    <span>Опция 1</span>
  </label>
  <label class="radio">
    <div class="radio-circle"></div>
    <span>Опция 2</span>
  </label>
</div>
```

**Segmented control:**

```html
<div class="radio-segmented">
  <div class="radio-seg-item active">День</div>
  <div class="radio-seg-item">Неделя</div>
  <div class="radio-seg-item">Месяц</div>
</div>
```

**Варианты группировки:** `.radio-group` (gap 16px), `.radio-group-segmented` (gap 2px), `.radio-group-chip` (gap 6px)

### 5.9. Toggle

Переключатель вкл/выкл. Два размера.

**Размеры:** `toggle-track-md` / `toggle-thumb-md` (34x20 / 16x16), `toggle-track-sm` / `toggle-thumb-sm` (26x16 / 12x12)

**Состояния:** `.on`, `.disabled`

```html
<label class="toggle on">
  <div class="toggle-track toggle-track-md">
    <div class="toggle-thumb toggle-thumb-md"></div>
  </div>
  <span class="toggle-label">Включено</span>
</label>
```

### 5.10. Tabs

Вкладки с подчёркиванием. Sticky top.

**Классы:** `.tabs` (контейнер, 38px), `.tab`, `.tab.active`, `.tab-counter`

```html
<div class="tabs">
  <div class="tab active">
    Общее
    <span class="tab-counter">12</span>
  </div>
  <div class="tab">Здоровье</div>
  <div class="tab">Продуктивность</div>
</div>
```

### 5.11. Chip

Фильтр-чип. Два размера.

**Размеры:** `chip-md` (24px, 14/400/20), `chip-lg` (36px, 16/400/24)

**Состояния:** `.selected`, `.disabled`

**Дочерние:** `.chip-close` (иконка удаления 12x12)

```html
<div class="chip chip-md">Фильтр</div>
<div class="chip chip-md selected">Выбранный фильтр</div>
<div class="chip chip-lg">
  Значение
  <svg class="chip-close" width="12" height="12">...</svg>
</div>
```

### 5.12. Avatar

Аватар пользователя. Квадрат 24x24, radius-6.

**Цвета:** `avatar-accent`, `avatar-success`, `avatar-error`, `avatar-warning`, `avatar-info`, `avatar-status01` - `avatar-status06`

```html
<div class="avatar avatar-accent">АМ</div>
<div class="avatar avatar-info">
  <img src="photo.jpg" alt="User">
</div>
```

### 5.13. Table

CSS Grid таблица. Columns задаются через `grid-template-columns` на `.table`.

**Элементы:** `.table`, `.table-header`, `.table-header-cell`, `.table-body`, `.table-row`, `.table-cell`, `.table-cell-right`, `.table-fn-cell`

```html
<div class="table" style="grid-template-columns: 200px 1fr 120px;">
  <div class="table-header">
    <div class="table-header-cell">Кличка</div>
    <div class="table-header-cell">Группа</div>
    <div class="table-header-cell table-cell-right">Удой</div>
  </div>
  <div class="table-body">
    <div class="table-row">
      <div class="table-cell">Зорька</div>
      <div class="table-cell">Группа 1</div>
      <div class="table-cell table-cell-right">32.5 кг</div>
    </div>
  </div>
</div>
```

### 5.14. Tooltip

Всплывающая подсказка. Тёмный фон, max-width 240px.

**Элементы:** `.tooltip`, `.tooltip-icon` (16x16, иконка-триггер)

```html
<svg class="tooltip-icon" width="16" height="16">...</svg>
<div class="tooltip">Подсказка для поля</div>
```

### 5.15. Loader / Skeleton

Индикаторы загрузки.

**Loader** -- вращающийся спиннер:

```html
<div class="loader">
  <svg class="loader-spinner" width="20" height="20">...</svg>
</div>
```

**Skeleton** -- пульсирующий плейсхолдер:

```html
<div class="skeleton skeleton-text" style="width: 200px;"></div>
<div class="skeleton skeleton-block" style="width: 100%; height: 120px;"></div>
```

### 5.16. Label

Лейбл для полей формы. 14/400/20.

**Модификаторы:** `.required` (красная звёздочка), `.optional` (серый текст), `.disabled`

```html
<label class="label">Имя коровы <span class="required">*</span></label>
<label class="label">Комментарий <span class="optional">(необяз.)</span></label>
```

### 5.17. TextLink

Текстовая ссылка с подчёркиванием. Цвет accent.

**Состояния:** `:hover`, `:active`, `.disabled`

```html
<a class="text-link" href="#">Подробнее</a>
```

### 5.18. EmptyState

Пустое состояние -- иконка, заголовок, описание, ссылка.

**Элементы:** `.empty-state`, `.empty-icon` (64x64 круг), `.empty-title`, `.empty-sub`, `.empty-link`

```html
<div class="empty-state">
  <div class="empty-icon">
    <svg width="28" height="28">...</svg>
  </div>
  <div class="empty-title">Нет данных</div>
  <div class="empty-sub">Добавьте первую запись, чтобы начать работу</div>
  <a class="empty-link" href="#">
    <button class="btn btn-md btn-primary-accent">
      <span class="btn-text">Добавить</span>
    </button>
  </a>
</div>
```

### 5.19. FieldFeedback

Подсказка / ошибка под полем формы.

**Варианты:** `field-feedback-neutral`, `field-feedback-info`, `field-feedback-error`

**Дочерние:** `.field-feedback-icon` (16x16)

```html
<div class="field-feedback field-feedback-error">
  <svg class="field-feedback-icon" width="16" height="16">...</svg>
  Обязательное поле
</div>
```

### 5.20. Popover / Dropdown

Всплывающие панели и меню.

**Popover:** `.popover`, `.popover-content`

**Dropdown:** `.dropdown-menu`, `.dropdown-item`, `.dropdown-item.selected`, `.dropdown-item-icon`, `.dropdown-divider`

```html
<div class="popover">
  <div class="popover-content">
    Произвольное содержимое
  </div>
</div>

<div class="dropdown-menu">
  <div class="dropdown-item">
    <svg class="dropdown-item-icon" width="16" height="16">...</svg>
    Редактировать
  </div>
  <div class="dropdown-divider"></div>
  <div class="dropdown-item" style="color: var(--error-default);">Удалить</div>
</div>
```

### 5.21. BottomSheet

Мобильная нижняя панель. 1:1 с product-src `BottomSheet` (2026-04-21). Фиксируется снизу экрана, центрована по `left:50%` с `max-width: min(560px, 100%)`, `max-height: calc(100dvh - mobile-header)`.

**Элементы (полная иерархия):** `.bottom-sheet-overlay`, `.bottom-sheet` (root) → `.bottom-sheet-drag-area` (touch-grab) → `.bottom-sheet-handle` + `.bottom-sheet-header` (→ `.bottom-sheet-title-section` → `.bottom-sheet-title` + опциональный `.bottom-sheet-subtitle`; `.bottom-sheet-close-button`) → `.bottom-sheet-content` (scrollable, safe-area-aware).

**Bottom-spacer (`::after`)** защищает от видимого page-bg при overscroll.

```html
<div class="bottom-sheet-overlay"></div>
<div class="bottom-sheet">
  <div class="bottom-sheet-drag-area">
    <div class="bottom-sheet-handle"></div>
    <div class="bottom-sheet-header">
      <div class="bottom-sheet-title-section">
        <div class="bottom-sheet-title bodyLargeStrong">Фильтры стада</div>
        <div class="bottom-sheet-subtitle descriptionLarge">Выберите критерии</div>
      </div>
      <button class="close-btn close-btn-md bottom-sheet-close-button">...</button>
    </div>
  </div>
  <div class="bottom-sheet-content">
    ...scrollable...
  </div>
</div>
```

**Без subtitle** — просто уберите `.bottom-sheet-subtitle` div; `.bottom-sheet-header:has(.bottom-sheet-subtitle)` не сработает, header вернётся к `align-items: center`.

### 5.22. Accordion

Раскрывающийся блок.

**Элементы:** `.accordion`, `.accordion-trigger`, `.accordion-chevron` (авто-поворот при `aria-expanded="true"`), `.accordion-content`

**Альтернатива:** `.expandable-title` + `.chevron`

```html
<div class="accordion">
  <button class="accordion-trigger" aria-expanded="false">
    <span>Дополнительные параметры</span>
    <svg class="accordion-chevron" width="16" height="16">...</svg>
  </button>
  <div class="accordion-content">
    Скрытое содержимое
  </div>
</div>
```

### 5.23. Favorite

Кнопка избранного (звёздочка). 1:1 с product-src `Favorite` (2026-04-21).

**Состояния через CSS-vars:** default (stroke neutral-default), `.selected` (fill accent-default), `:hover` (fill neutral-default; если .selected — accent-hover), `.focused` (outline focus-default), `.pressed` (fill accent-active).

**⚠ Icon inline, не sprite:** для корректного stroke/fill через CSS-vars нужен inline SVG c `stroke="var(--star-icon-stroke-color)"` и `fill="var(--star-icon-fill-color)"`. Sprite (`<use href="#star"/>`) не поддерживает раздельные stroke/fill через vars.

```html
<button class="favorite" aria-pressed="false">
  <svg width="20" height="20" viewBox="0 0 20 20">
    <path d="M10 1l2.6 5.3 5.9.9-4.3 4.2 1 5.8L10 14.5 4.8 17.2l1-5.8L1.5 7.2l5.9-.9z"
          stroke="var(--star-icon-stroke-color)"
          stroke-width="1.5"
          fill="var(--star-icon-fill-color)"/>
  </svg>
</button>

<!-- selected state -->
<button class="favorite selected" aria-pressed="true">
  <svg width="20" height="20" viewBox="0 0 20 20">
    <path d="M10 1l2.6 5.3 ..." stroke="var(--star-icon-stroke-color)" fill="var(--star-icon-fill-color)"/>
  </svg>
</button>
```

### 5.24. Shortcut

Отображение клавиатурных сочетаний. 1:1 с product-src `Shortcut` (2026-04-21).

**Элементы:** `.shortcut-root` (контейнер) → `.shortcut` (клавиша) → `.shortcut-text` (inner). Модификатор `.special-key` для Ctrl/Cmd/Shift/Enter.

**Состояния через CSS-vars:** default (border soft / fg-disabled), `.special-key` (fg-muted), parent `[aria-selected='true']` или `[data-is-focus-visible='true']` (accent-soft).

```html
<div class="shortcut-root">
  <span class="shortcut special-key"><span class="shortcut-text">Ctrl</span></span>
  <span class="shortcut"><span class="shortcut-text">K</span></span>
</div>

<!-- в selected-строке меню (aria-selected на parent) -->
<div aria-selected="true">
  <div class="shortcut-root">
    <span class="shortcut special-key"><span class="shortcut-text">⌘</span></span>
    <span class="shortcut"><span class="shortcut-text">K</span></span>
  </div>
</div>
```

### 5.25. Markdown

Контейнер для рендеренного Markdown-контента. 1:1 с product-src `Markdown` (2026-04-21). Hybrid approach: **tag-selectors** для простых случаев (h1-h3, p, ul, ol, li, code) + **wrapper-classes** когда нужно 1:1 product-src для blockquote/pre/table.

**Vertical-rhythm:** `.markdown > * + * { margin-top: spacing-16 }` — между блоками.

**Pre (code block):** light-тема (`neutral-opaque-container-muted` bg) — НЕ dark как раньше.

**Wrappers (для 1:1 с product-src):**
- `.markdown-blockquote-wrapper` — bg-box вокруг `<blockquote>` (call-out look)
- `.markdown-table-wrapper` — horizontal-scroll для wide tables
- `.markdown-pre` — alias для `<pre>` (опционально)

```html
<!-- простой случай (tag-selectors работают) -->
<div class="markdown">
  <h2>Заголовок</h2>
  <p>Текст с <code>inline</code>.</p>
  <ul>
    <li>Пункт списка</li>
  </ul>
</div>

<!-- blockquote с bg-box (1:1 product-src) -->
<div class="markdown">
  <div class="markdown-blockquote-wrapper">
    <blockquote>Цитата в контейнере</blockquote>
  </div>
</div>

<!-- wide table с horizontal scroll -->
<div class="markdown">
  <div class="markdown-table-wrapper">
    <table>
      <thead><tr><th>Кличка</th><th>Удой, кг</th></tr></thead>
      <tbody><tr><td>Зорька</td><td>34,5</td></tr></tbody>
    </table>
  </div>
</div>
```

### 5.26. AiAssistantButton

Плавающая кнопка чата с ИИ. Фиксируется в правом нижнем углу (fixed, right 32 / bottom 32), есть на всех экранах заготовки.

```html
<button class="ai-assistant-btn" type="button" aria-expanded="false" data-is-floating-element="true">
  <span class="icon"><span class="innerRoot"><svg><use href="../shared/icons.svg#arkasha"/></svg></span></span>
  <span class="children">Чат с ИИ</span>
</button>
```

### 5.27. DataBlocked

Сообщение о недоступности данных. 1:1 с product-src `DataBlockedMessage` (2026-04-21).

**Элементы:** только `.data-blocked` (grid контейнер). Внутри — Icon + Typography + утилиты.

**Композиция:** Icon (`icon text-muted mb-4`) → Typography (`bodySmallStrong` или `bodyLargeStrong` при isLarge) → optional description (`descriptionLarge text-soft`) → optional Button (`mt-12`).

```html
<div class="data-blocked">
  <svg class="icon text-muted mb-4" width="20" height="20">
    <use href="../shared/icons.svg#info-circle-filled"/>
  </svg>
  <div class="bodySmallStrong">Нет данных за выбранный период</div>
  <div class="descriptionLarge text-soft">Попробуйте другой период или фильтр</div>
</div>
```

**isLarge variant** (крупнее в hero-местах):

```html
<div class="data-blocked">
  <svg class="icon text-muted mb-4" width="32" height="32">
    <use href="../shared/icons.svg#info-circle-filled"/>
  </svg>
  <div class="bodyLargeStrong">Данные временно недоступны</div>
</div>
```

### 5.28. DefinitionList

Список "ключ — значение". 1:1 с product-src `DefinitionList` (2026-04-21).

**Структура:** `.def-list` (root) → `.def-list-content` → `.def-list-column` (bordered) → `.def-list-item` → `.def-list-label` + `.def-list-value`.

**Два режима:**
- **`.list`** (default) — одна колонка, длинные значения оборачиваются (`overflow-wrap: anywhere`)
- **`.wrapped`** — multi-column grid с container-queries. Columns count задаётся inline `style="--data-sheet-columns-count: 2"` (в product-src — JS по breakpoints, в HTML вручную). ellipsis вместо wrap.

Typography: label и value оба `bodySmall` (14/400/20) — используй Typography utility-класс.

```html
<!-- list mode (default) -->
<div class="def-list list" role="list">
  <div class="def-list-content">
    <div class="def-list-column">
      <div class="def-list-item" role="listitem">
        <div class="def-list-label"><div class="bodySmall">Порода</div></div>
        <div class="def-list-value"><div class="bodySmall">Голштинская</div></div>
      </div>
      <div class="def-list-item" role="listitem">
        <div class="def-list-label"><div class="bodySmall">Лактация</div></div>
        <div class="def-list-value"><div class="bodySmall">3-я</div></div>
      </div>
    </div>
  </div>
</div>

<!-- wrapped 2-column mode -->
<div class="def-list wrapped" style="--data-sheet-columns-count: 2" role="list">
  <div class="def-list-content">
    <div class="def-list-column">...</div>
    <div class="def-list-column">...</div>
  </div>
</div>
```

---

## 6. Layout

### 6.1. Page Shell

`body` -- flex row: sidebar + main. `height: 100vh`, `overflow: hidden`.

### 6.2. Sidebar

- `.sidebar` -- 248px, CSS Grid 3 rows (header / menu / bottom)
- `.sidebar.collapsed` -- 72px, скрывает текст навигации, поиск, chevron, badge
- `.sidebar-header` -- логотип + поиск
- `.sidebar-logo` -- flex, gap-12, содержит `.menu-btn` (24x24) и `.brand-svg` (72x24)
- `.sidebar-search` -- поиск коровы (`.cow-select`)
- `.nav-menu-items` -- скроллируемый контейнер, автоматические border-индикаторы (`scroll-top`, `scroll-bottom`)
- `.nav-section` -- группа навигации (pl-16, pr-8)
- `.nav-item-root` -- пункт меню, `.nav-item-root.active` -- оранжевый акцент
- `.nav-link` -- CSS Grid: 24px icon + auto text. `.nav-link.with-chevron` -- добавляет колонку под chevron
- `.nav-section-label` -- заголовок секции (16/500/24)
- `.nav-sub-label` -- подпункт (16/400/24)
- `.nav-badge` -- счётчик (pill, accent bg, белый текст)
- `.sidebar-bottom` -- нижняя панель (профиль, выбор компании)

```html
<nav class="sidebar">
  <div class="sidebar-header">
    <div class="sidebar-logo">
      <button class="menu-btn">...</button>
      <svg class="brand-svg">...</svg>
    </div>
    <div class="sidebar-search">
      <div class="cow-select">...</div>
    </div>
  </div>
  <div class="nav-menu-items" id="navMenuItems">
    <div class="nav-section">
      <div class="nav-item-root active">
        <div class="nav-link with-chevron">
          <svg class="nav-icon">...</svg>
          <span class="nav-section-label">Стадо</span>
          <svg class="nav-chevron">...</svg>
        </div>
      </div>
    </div>
  </div>
  <div class="sidebar-bottom">...</div>
</nav>
```

### 6.3. Main Content

- `.main` -- flex column, responsive padding (16/24/48px по брейкпоинту)
- `.content` -- scrollable area, flex-1, padding-bottom 48px, custom scrollbar

### 6.4. Page Header

```html
<div class="page-header">
  <div class="page-header-left">
    <a class="page-header-back" href="#">
      <svg width="16" height="16">...</svg>
      Назад к списку
    </a>
    <h1 class="page-header-title">Стадо</h1>
    <div class="page-header-description">Всего 1 234 головы</div>
    <div class="page-header-badges">
      <span class="badge badge-md badge-success">
        <span class="badge-text">Активно</span>
      </span>
    </div>
  </div>
  <div class="page-header-right">
    <button class="btn btn-md btn-primary-accent">
      <span class="btn-text">Добавить</span>
    </button>
  </div>
</div>
```

### 6.5. Panel Card

Белая карточка с border-radius-12, padding 24px.

**Элементы:** `.panel-card`, `.card-header`, `.card-header-left`, `.card-title` (22/700/24), `.card-header-right`

```html
<div class="panel-card">
  <div class="card-header">
    <div class="card-header-left">
      <h2 class="card-title">Заголовок</h2>
    </div>
    <div class="card-header-right">
      <button class="btn btn-sm btn-ghost-neutral">
        <span class="btn-text">Ещё</span>
      </button>
    </div>
  </div>
  <!-- content -->
</div>
```

### 6.6. Tile Grid

Адаптивная сетка карточек.

**Размеры сетки:** `tile-grid-sm` (min 244px), `tile-grid-md` (min 296px), `tile-grid-lg` (min 428px)

**Размеры тайлов:** `tile-sm` (min-h 100px), `tile-md` (min-h 196px), `tile-lg` (min-h 260px)

**Элементы:** `.tile-header`, `.tile-icon`, `.tile-title`, `.tile-description`, `.tile-badges`, `.tile-actions`

```html
<div class="tile-grid tile-grid-md">
  <div class="tile tile-md">
    <div class="tile-header">
      <div class="tile-title">Название карточки</div>
      <div class="tile-actions">
        <button class="fn-btn fn-btn-tertiary">
          <svg width="20" height="20">...</svg>
        </button>
      </div>
    </div>
    <div class="tile-description">Описание карточки</div>
    <div class="tile-badges">
      <span class="badge badge-sm badge-success">
        <span class="badge-text">Активно</span>
      </span>
    </div>
  </div>
</div>
```

### 6.7. Mobile Header

Фиксированный мобильный хедер. Отображается только на экранах до 767px.

**Размеры:** `mobile-header-sm` (64px), `mobile-header-md` (80px)

```html
<div class="mobile-header mobile-header-sm">
  <button class="fn-btn fn-btn-secondary">
    <svg width="24" height="24">...</svg>
  </button>
  <span class="body-md-strong">Стадо</span>
</div>
```

### 6.8. Router Tabs

Sticky-табы внутри контентной области.

```html
<div class="router-tabs">
  <div class="router-tabs-content">
    <div class="tab active">Вкладка 1</div>
    <div class="tab">Вкладка 2</div>
  </div>
  <div class="router-tabs-actions">
    <button class="btn btn-sm btn-secondary-neutral">
      <span class="btn-text">Действие</span>
    </button>
  </div>
</div>
```

---

## 7. Утилиты

| Категория | Классы |
|---|---|
| Display | `flex`, `inline-flex`, `block`, `inline-block`, `grid`, `hidden`, `contents` |
| Flex | `flex-col`, `flex-col-reverse`, `flex-row-reverse`, `flex-wrap`, `flex-1`, `flex-none`, `shrink-0` |
| Alignment | `items-center`, `items-start`, `items-end`, `items-stretch`, `justify-center`, `justify-between`, `justify-around`, `justify-end`, `self-start`, `self-center`, `self-end`, `self-stretch`, `place-items-center`, `place-self-center` |
| Gap | `gap-2`, `gap-4`, `gap-6`, `gap-8`, `gap-12`, `gap-16`, `gap-20`, `gap-24`, `gap-32`, `gap-40`, `gap-48` |
| Grid | `grid-cols-2`, `grid-cols-3`, `grid-cols-4`, `col-span-2`, `col-span-3`, `col-span-full` |
| Margin | `m-{0-48}`, `mt-{0-48}`, `mr-{0-48}`, `mb-{0-48}`, `ml-{0-48}`, `mx-{0-48}`, `my-{0-48}`, `ml-auto`, `mr-auto`, `mt-auto` |
| Padding | `p-{0-48}`, `pt-{0-48}`, `pr-{0-48}`, `pb-{0-48}`, `pl-{0-48}`, `px-{0-48}`, `py-{0-48}` |
| Sizing | `w-full`, `h-full`, `min-w-0`, `min-w-full`, `max-w-full` |
| Text | `text-left`, `text-center`, `text-right`, `whitespace-nowrap`, `capitalize`, `text-underline`, `ellipsis`, `ellipsis-2`, `ellipsis-3` |
| Text Color | `text-default`, `text-soft`, `text-muted`, `text-disabled`, `text-accent`, `text-accent-soft`, `text-success`, `text-error`, `text-warning`, `text-info` |
| Overflow | `overflow-auto`, `overflow-hidden`, `overflow-clip`, `hidden-scrollbar` |
| Pointer | `pointer-events-none`, `cursor-default`, `cursor-pointer`, `cursor-grab`, `cursor-grabbing` |
| Borders | `rounded-full`, `rounded-8`, `rounded-12`, `border-muted`, `border-soft`, `shadow-border` |
| Position | `relative`, `absolute`, `fixed`, `sticky`, `inset-0` |
| Opacity | `opacity-0`, `opacity-50` |
| Scrollbar | `custom-scroll` (стилизованный 8px scrollbar) |

Значения margin/padding: 0, 2, 4, 6, 8, 12, 16, 20, 24, 32, 40, 48 (в пикселях).

---

## 8. Иконки

SVG-спрайт `icons.svg` содержит 107 иконок. Использование:

```html
<svg width="24" height="24"><use href="../shared/icons.svg#check"/></svg>
<svg width="20" height="20"><use href="../shared/icons.svg#search"/></svg>
<svg width="16" height="16"><use href="../shared/icons.svg#x-close"/></svg>
```

Размер задаётся через `width`/`height`. Цвет наследуется через `color` (иконки используют `currentColor`).

**Все доступные иконки (107 штук):**

| ID | ID | ID | ID |
|---|---|---|---|
| analytics | arkasha | arrow-down-right-turn | arrow-up |
| automatic-play | between | block | calendar |
| calendar-check | cancel | cancel-circle | cancel-circle-filled |
| chart | chat-left-off | chat-left-plus | check |
| check-circle | check-circle-filled | chevron-down | chevron-right-circle |
| chevron-right-circle-filled | clipboard-check | clipboard-check-filled | clipboard-list |
| clock | code | collapse-all | company |
| copy-to-down | cow | delete | dot |
| dot-filled | dots | download | drag-handle |
| drag-horizontal | drag-indicator | duplicate | edit |
| entering-data | equal | equally | expand-all |
| eye-hide | eye-keep-out | eye-show | filter |
| greater-then | greater-then-or-equal | help-circle | help-circle-filled |
| herriot-connected | herriot-disabled | income | info-circle |
| info-circle-filled | is-empty | is-not-empty | key |
| layout-grid | leaf-filled | less-then | less-then-or-equal |
| lightning | line-chart | list | lock |
| logout | megaphone | menu | metric-negative |
| metric-positive | metric-unchanged | mic | minus |
| new-tab | not-between | not-equal | outcome |
| pin | plus | printer | printer-off |
| profile | search | send | settings |
| skip | sort-asc | sort-desc | spinner |
| star | syringe | syringe-filled | telegram | timer |
| tree-filled | undo | update | upload |
| user | warning-circle | warning-circle-filled | whats-app |
| x-close | zoom-in | | |

