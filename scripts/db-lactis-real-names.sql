-- Replace synthetic animal names in Lactis Prime 8 only.
-- Identity, identifiers, events, status and farm membership are guarded below.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

CREATE TEMP TABLE _lactis_guard AS
SELECT
  (SELECT count(*) FROM animal) AS animal_count,
  (SELECT md5(string_agg(id::text, ',' ORDER BY id)) FROM animal) AS animal_ids,
  (SELECT count(*) FROM animal_event) AS event_count,
  (SELECT md5(string_agg(id::text, ',' ORDER BY id)) FROM animal_event) AS event_ids,
  (SELECT md5(string_agg(id::text || ':' || name, ',' ORDER BY id))
     FROM animal WHERE farm_id <> '2911f095-dd8c-5878-a8f3-2e027513ad6a'::uuid) AS other_farm_animals;

CREATE TEMP TABLE _lactis_female_names(ord integer PRIMARY KEY, name text NOT NULL);
INSERT INTO _lactis_female_names(ord, name) VALUES
(1,'Агата'),(2,'Аглая'),(3,'Аделина'),(4,'Акулина'),(5,'Алёна'),
(6,'Алиса'),(7,'Алёнка'),(8,'Альбина'),(9,'Анастасия'),(10,'Ангелина'),
(11,'Анжела'),(12,'Анна'),(13,'Арина'),(14,'Ариша'),(15,'Ассоль'),
(16,'Афина'),(17,'Багира'),(18,'Барыня'),(19,'Белла'),(20,'Белянка'),
(21,'Берёзка'),(22,'Богдана'),(23,'Божена'),(24,'Бусинка'),(25,'Ванилька'),
(26,'Вега'),(27,'Весна'),(28,'Веста'),(29,'Вишенка'),(30,'Гвоздика'),
(31,'Грация'),(32,'Дана'),(33,'Дарина'),(34,'Даша'),(35,'Дива'),
(36,'Долли'),(37,'Ева'),(38,'Есения'),(39,'Жемчужина'),(40,'Жасминка'),
(41,'Звезда'),(42,'Злата'),(43,'Ива'),(44,'Иволга'),(45,'Ида'),
(46,'Индира'),(47,'Искра'),(48,'Камелия'),(49,'Карамелька'),(50,'Карина'),
(51,'Касатка'),(52,'Кира'),(53,'Кнопка'),(54,'Краса'),(55,'Лада'),
(56,'Ласточка'),(57,'Лейла'),(58,'Лилия'),(59,'Лира'),(60,'Луна'),
(61,'Малина'),(62,'Мальва'),(63,'Маргарита'),(64,'Марина'),(65,'Маркиза'),
(66,'Маруся'),(67,'Мелисса'),(68,'Мила'),(69,'Милка'),(70,'Мира'),
(71,'Мишель'),(72,'Надежда'),(73,'Натали'),(74,'Неженка'),(75,'Ника'),
(76,'Ночка'),(77,'Оливка'),(78,'Ольга'),(79,'Орхидея'),(80,'Павлинка'),
(81,'Пани'),(82,'Пенка'),(83,'Поляна'),(84,'Прима'),(85,'Радость'),
(86,'Радуга'),(87,'Ромашка'),(88,'Росинка'),(89,'Рубина'),(90,'Рябинка'),
(91,'Сакура'),(92,'Света'),(93,'Селена'),(94,'Серена'),(95,'Симона'),
(96,'Сирень'),(97,'Сказка'),(98,'Сметанка'),(99,'Снежана'),(100,'Снежинка'),
(101,'Соня'),(102,'София'),(103,'Стеша'),(104,'Тайга'),(105,'Талия'),
(106,'Таня'),(107,'Тая'),(108,'Тереза'),(109,'Тихоня'),(110,'Тучка'),
(111,'Улыбка'),(112,'Фея'),(113,'Фиалка'),(114,'Фортуна'),(115,'Хлоя'),
(116,'Цветана'),(117,'Чайка'),(118,'Черешня'),(119,'Шанель'),(120,'Шёлка'),
(121,'Эврика'),(122,'Элина'),(123,'Эмма'),(124,'Юла'),(125,'Юнона'),
(126,'Ягодка'),(127,'Янтарка'),(128,'Астра'),(129,'Бархатка'),(130,'Вьюга'),
(131,'Горлица'),(132,'Дымка'),(133,'Зорька'),(134,'Капелька'),(135,'Клеверка'),
(136,'Клубника'),(137,'Корица'),(138,'Лаванда'),(139,'Мята'),(140,'Одуванчик'),
(141,'Плюшка'),(142,'Пчёлка'),(143,'Сливка'),(144,'Сосенка'),(145,'Травинка'),
(146,'Черника'),(147,'Шоколадка'),(148,'Ясная'),(149,'Мелодия'),(150,'Нежность'),
(151,'Бронза'),(152,'Галатея'),(153,'Джемма'),(154,'Забава'),(155,'Карамель'),
(156,'Ласка'),(157,'Мечта'),(158,'Пастила'),(159,'Розочка'),(160,'Снежка'),
(161,'Тополинка'),(162,'Урсула'),(163,'Флора'),(164,'Хризантема'),(165,'Янка');

CREATE TEMP TABLE _lactis_male_names(ord integer PRIMARY KEY, name text NOT NULL);
INSERT INTO _lactis_male_names(ord, name) VALUES
(1,'Амур'),(2,'Барс'),(3,'Гром'),(4,'Орфей'),(5,'Север');

WITH ranked AS (
  SELECT a.id, row_number() OVER (ORDER BY a.id)::integer AS ord
  FROM animal a
  WHERE a.farm_id = '2911f095-dd8c-5878-a8f3-2e027513ad6a'::uuid
    AND a.sex = 'FEMALE'
    AND (a.name LIKE 'Тестовое животное %' OR a.name LIKE 'Корова X-%' OR a.name LIKE 'Тёлка H-%')
)
UPDATE animal a
SET name = n.name
FROM ranked r JOIN _lactis_female_names n ON n.ord = r.ord
WHERE a.id = r.id;

WITH ranked AS (
  SELECT a.id, row_number() OVER (ORDER BY a.id)::integer AS ord
  FROM animal a
  WHERE a.farm_id = '2911f095-dd8c-5878-a8f3-2e027513ad6a'::uuid
    AND a.sex = 'MALE'
    AND a.name LIKE 'Бычок B-%'
)
UPDATE animal a
SET name = n.name
FROM ranked r JOIN _lactis_male_names n ON n.ord = r.ord
WHERE a.id = r.id;

DO $$
DECLARE g record;
BEGIN
  SELECT * INTO g FROM _lactis_guard;
  IF (SELECT count(*) FROM animal) <> g.animal_count
     OR (SELECT md5(string_agg(id::text, ',' ORDER BY id)) FROM animal) <> g.animal_ids
     OR (SELECT count(*) FROM animal_event) <> g.event_count
     OR (SELECT md5(string_agg(id::text, ',' ORDER BY id)) FROM animal_event) <> g.event_ids
     OR (SELECT md5(string_agg(id::text || ':' || name, ',' ORDER BY id))
           FROM animal WHERE farm_id <> '2911f095-dd8c-5878-a8f3-2e027513ad6a'::uuid) <> g.other_farm_animals
  THEN RAISE EXCEPTION 'identity, event or other-farm guard failed'; END IF;
  IF (SELECT count(*) FROM animal WHERE farm_id='2911f095-dd8c-5878-a8f3-2e027513ad6a'::uuid) <> 170
     OR (SELECT count(*) FROM animal WHERE farm_id='2911f095-dd8c-5878-a8f3-2e027513ad6a'::uuid AND sex='FEMALE') <> 165
     OR (SELECT count(*) FROM animal WHERE farm_id='2911f095-dd8c-5878-a8f3-2e027513ad6a'::uuid AND sex='MALE') <> 5
  THEN RAISE EXCEPTION 'Lactis count guard failed'; END IF;
  IF EXISTS (SELECT 1 FROM animal WHERE farm_id='2911f095-dd8c-5878-a8f3-2e027513ad6a'::uuid
             AND (name LIKE 'Тестовое животное %' OR name LIKE 'Бычок B-%' OR name LIKE 'Тёлка H-%' OR name LIKE 'Корова X-%'))
  THEN RAISE EXCEPTION 'synthetic animal name remains'; END IF;
END $$;

COMMIT;
