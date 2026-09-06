Оба backup успешно восстановлены и проверены 04.09.2026 в отдельных временных БД; временные копии удалены, действующая ферменная база и её snapshot не изменились.

## Архивы

| Архив | SHA-256 | Время восстановления |
|---|---|---|
| `.local/backups/arka-test-before-rules-20260904T174625.dump` | `7bec5b0db13e0b8c6886e1ada9042cf65803506b946ebbb173bcac5e03a0a0bc` | 4.549 с |
| `.local/backups/chat-before-rule-catalog.dump` | `9c0bdd92f0eba8ac8e8f7a1c4f456745d666d037d55939732f7db3f363bdc7eb` | 0.049 с |

Формат обоих архивов — PostgreSQL custom, версия сервера и pg_dump — 15.18. Проверялось реальное восстановление схемы и данных, не только чтение оглавления.

## Изоляция

Перед `createdb` проверено отсутствие каждой целевой БД в `pg_database`. Созданы только:

- `arka_rules_restore_farm_20260904_181159_e8d239`;
- `arka_rules_restore_chat_20260904_181159_e8d239`.

`pg_restore` выполнялся с `--exit-on-error --single-transaction`. После проверок `dropdb` применён исключительно к двум БД, созданным этим запуском. Повторный запрос `pg_database` подтвердил отсутствие обеих временных БД.

## Ферменный backup

| Проверка | Восстановленное значение |
|---|---|
| Фермы | 6 |
| Животные | 51 000 |
| События | 312 307 |
| MD5 упорядоченных ID животных | `0490a84cb40198d2a617aa19a5221b70` |
| Миграции | 12, от `001_core.sql` до `012_multi_farm_scope.sql` |
| Определения полей / формулы | 14 / 8 |
| `animal_rule_projection_snapshot` | Отсутствует, как ожидается до миграции 013 |

Количество животных, событий и checksum ID совпали с зафиксированным baseline до реализации правил.

## Продуктовый backup

Число записей независимо подсчитано в секциях `COPY` архива и сравнено с `SELECT count(*)` восстановленной БД. Тексты чатов в отчёт и логи не выводились.

| Таблица | Строк в архиве | После восстановления |
|---|---|---|
| `drizzle.__drizzle_migrations` | 9 | 9 |
| `public."Chat"` | 610 | 610 |
| `public."Document"` | 0 | 0 |
| `public."Message_v2"` | 142 | 142 |
| `public."ReportView"` | 963 | 963 |
| `public."Stream"` | 0 | 0 |
| `public."Suggestion"` | 0 | 0 |
| `public."UploadedFile"` | 21 | 21 |
| `public."User"` | 1303 | 1303 |
| `public."Vote_v2"` | 0 | 0 |

Все 10 таблиц совпали. Восстановлено 9 записей `drizzle.__drizzle_migrations`; каталог правил в этом backup отсутствует.

## Фактически выполненные команды

Рабочая папка: `<project-root>`. Имена временных БД ниже относятся только к завершённому проверочному запуску.

```bash
createdb -h 127.0.0.1 -p 55432 -U arka_admin --maintenance-db=postgres arka_rules_restore_farm_20260904_181159_e8d239
pg_restore -h 127.0.0.1 -p 55432 -U arka_admin --exit-on-error --single-transaction -d arka_rules_restore_farm_20260904_181159_e8d239 '<project-root>/.local/backups/arka-test-before-rules-20260904T174625.dump'
createdb -h 127.0.0.1 -p 55432 -U arka_admin --maintenance-db=postgres arka_rules_restore_chat_20260904_181159_e8d239
pg_restore -h 127.0.0.1 -p 55432 -U arka_admin --exit-on-error --single-transaction -d arka_rules_restore_chat_20260904_181159_e8d239 '<project-root>/.local/backups/chat-before-rule-catalog.dump'
dropdb -h 127.0.0.1 -p 55432 -U arka_admin --maintenance-db=postgres arka_rules_restore_chat_20260904_181159_e8d239
dropdb -h 127.0.0.1 -p 55432 -U arka_admin --maintenance-db=postgres arka_rules_restore_farm_20260904_181159_e8d239
```

Контрольные значения фермы получены запросами `count(*)` и `md5(string_agg(id::text,',' ORDER BY id))`; продуктовые значения — `count(*)` каждой таблицы из архива. SHA-256 вычислен по полному бинарному содержимому dump.

## Действующий стенд после проверки

В `arka_test` сохранились 51 000 животных, 312 612 событий и checksum ID `0490a84cb40198d2a617aa19a5221b70`. Полностью совпали `as_of`, `knowledge_at`, `formula_version`, `refreshed_at`, `stale` в `animal_rule_projection_snapshot` до и после восстановления. Действующая `arkasha_chat` не была целью команд восстановления или удаления.

## Пользовательские поля после восстановления

Последующий шаг 016 закрывает DB-разрыв отдельно от проверки backup: общий типизированный bulk, зависимости `FIELD`, версии определений и invalidation. Проверки в `scripts/rules-custom-validate-data.sql` выполняются с обязательным ROLLBACK: 6 ферм, RLS, NULL, исправления, отзыв исправления, новые версии, границы времени и все поддерживаемые типы. Динамическая регистрация поля в интерфейсе относится к слою приложения и не доказывается восстановлением backup.
