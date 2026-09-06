"""Build one reviewed, rollback-capable maintenance transaction for the demo farm."""
import argparse,json,re
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--animals',required=True);p.add_argument('--events',required=True);p.add_argument('--output',required=True);p.add_argument('--rollback',action='store_true');a=p.parse_args()
animals=json.loads(Path(a.animals).read_text());assert len(animals)==150 and len({r['id'] for r in animals})==150
ids=','.join("'%s'::uuid"%r['id'] for r in animals)
for row in animals: assert re.fullmatch(r'[a-f0-9-]{36}',row['id'])
fixture=Path(a.events).read_text()
assert not re.search(r'(?im)^\s*(BEGIN|COMMIT|ROLLBACK|SET\s+session_replication_role|ALTER\s+TABLE)\b',fixture)
farm='2911f095-dd8c-5878-a8f3-2e027513ad6a'
header=f"""-- Authorized demo-only replacement. Requires the pre-migration pg_dump backup.
BEGIN;
SET LOCAL lock_timeout='10s';
SET LOCAL statement_timeout='180s';
LOCK TABLE animal,animal_event IN ACCESS EXCLUSIVE MODE;
CREATE INDEX IF NOT EXISTS animal_event_related_idx ON animal_event(related_event_id) WHERE related_event_id IS NOT NULL;
CREATE TEMP TABLE l150_keep ON COMMIT DROP AS SELECT id FROM animal WHERE farm_id='{farm}' AND id IN ({ids});
DO $$ BEGIN IF (SELECT count(*) FROM l150_keep)<>150 THEN RAISE EXCEPTION 'retained animals missing'; END IF; END $$;
CREATE TEMP TABLE l150_other_before(table_name text PRIMARY KEY,digest text) ON COMMIT DROP;
DO $$ DECLARE t record; d text; BEGIN
 FOR t IN SELECT table_name FROM information_schema.columns WHERE table_schema='public' AND column_name='farm_id'
 AND table_name NOT IN ('animal_state_query') AND table_name IN (SELECT tablename FROM pg_tables WHERE schemaname='public') LOOP
 EXECUTE format('SELECT md5(coalesce(string_agg(h, '''' ORDER BY h),'''')) FROM (SELECT md5(to_jsonb(r)::text) h FROM %I r WHERE farm_id<>$1) x',t.table_name) INTO d USING '{farm}'::uuid;
 INSERT INTO l150_other_before VALUES(t.table_name,d);
 END LOOP;
END $$;
-- Explicit maintenance removal is limited to one farm. All FK and validation triggers stay enabled.
DELETE FROM event_calving_offspring WHERE farm_id='{farm}';
DO $$ DECLARE t record; BEGIN
 FOR t IN WITH RECURSIVE deps(rel,depth,path) AS (
 SELECT 'animal_event'::regclass::oid,0,ARRAY['animal_event'::regclass::oid]
 UNION ALL SELECT c.conrelid,d.depth+1,d.path||c.conrelid FROM deps d JOIN pg_constraint c ON c.confrelid=d.rel
 WHERE c.contype='f' AND NOT c.conrelid=ANY(d.path))
 SELECT rel::regclass AS name FROM deps WHERE depth>0 GROUP BY rel ORDER BY max(depth) DESC LOOP
 EXECUTE format('DELETE FROM %s WHERE farm_id=$1',t.name) USING '{farm}'::uuid;
 END LOOP;
END $$;
DELETE FROM animal_relation WHERE farm_id='{farm}';
ALTER TABLE animal_event DISABLE TRIGGER animal_event_history_protect;
DELETE FROM animal_event WHERE farm_id='{farm}';
ALTER TABLE animal_event ENABLE TRIGGER animal_event_history_protect;
DELETE FROM animal WHERE farm_id='{farm}' AND id NOT IN (SELECT id FROM l150_keep);
"""
footer=f"""
DO $$ DECLARE t record; d text; BEGIN
 IF (SELECT count(*) FROM animal WHERE farm_id='{farm}')<>150 THEN RAISE EXCEPTION 'expected exactly 150 animals'; END IF;
 IF EXISTS(SELECT 1 FROM animal WHERE farm_id='{farm}' AND (sex<>'FEMALE' OR birth_date>CURRENT_DATE-INTERVAL '2 years')) THEN RAISE EXCEPTION 'not an adult cow'; END IF;
 IF EXISTS(SELECT 1 FROM animal_event e JOIN animal a ON a.id=e.animal_id WHERE e.farm_id='{farm}' AND e.occurred_at::date<a.birth_date) THEN RAISE EXCEPTION 'event before birth'; END IF;
 FOR t IN SELECT * FROM l150_other_before LOOP
 EXECUTE format('SELECT md5(coalesce(string_agg(h, '''' ORDER BY h),'''')) FROM (SELECT md5(to_jsonb(r)::text) h FROM %I r WHERE farm_id<>$1) x',t.table_name) INTO d USING '{farm}'::uuid;
 IF d IS DISTINCT FROM t.digest THEN RAISE EXCEPTION 'other farm changed in %',t.table_name; END IF;
 END LOOP;
END $$;
SELECT count(*) retained_animals FROM animal WHERE farm_id='{farm}';
SELECT refresh_animal_state_query();
{Path(__file__).with_name('db-lactis-150-oracle.sql').read_text()}
{'ROLLBACK' if a.rollback else 'COMMIT'};
"""
Path(a.output).write_text(header+fixture+footer)
print(a.output)
