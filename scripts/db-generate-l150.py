#!/usr/bin/env python3
"""Generate replacement event histories for 150 existing adult cows.

The input owns animal identity; this script updates demographics but retains IDs.
It emits no transaction control or trigger overrides. The caller supplies the
immutable as-of date and applies the SQL only after its scoped backup checks.
"""

import argparse
import json
import uuid
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path

NAMESPACE = uuid.UUID("8d095c5f-e4e2-4c51-94f7-2d9d8ca15000")


def uid(seed: int, animal_id: str, kind: str) -> str:
    return str(uuid.uuid5(NAMESPACE, f"{seed}:l150:{animal_id}:{kind}"))


def sql(v: object) -> str:
    if v is None:
        return "NULL"
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, (int, float)):
        return str(v)
    if isinstance(v, (date, datetime)):
        return "'" + v.isoformat().replace("+00:00", "Z") + "'"
    return "'" + str(v).replace("'", "''") + "'"


def raw(v: str) -> str:
    return f"RAW:({v})"


class L150:
    def __init__(self, seed: int, farm_id: str, as_of: date, animals: list[dict]):
        if len(animals) != 150:
            raise ValueError(f"expected exactly 150 animals, got {len(animals)}")
        self.seed, self.farm_id, self.as_of_date = seed, farm_id, as_of
        self.as_of = datetime.combine(as_of, time(12), timezone.utc)
        self.animals = animals
        self.lines = [
            "-- GENERATED L150 TEST DATA. Existing animal UUIDs are input-owned.",
            f"-- FARM_ID={farm_id}", f"-- AS_OF_DATE={as_of.isoformat()}",
            "SELECT id AS target_farm_check FROM farm WHERE id = '" + farm_id + "'::uuid;",
        ]

    def add(self, line: str) -> None:
        self.lines.append(line.rstrip(";") + ";")

    def event(self, animal: str, key: str, code: str, occurred: datetime, table: str, detail: dict) -> str:
        eid = uid(self.seed, animal, key)
        vals = [eid, self.farm_id, animal, raw(f"SELECT id FROM event_type WHERE farm_id IS NULL AND code = '{code}'"), occurred, occurred + timedelta(hours=1), "SIMULATION", f"l150-{key}", "db-generate-l150.py", None, None, None, "GENERATED L150 TEST DATA", '{"test_data":true,"fixture":"l150"}']
        line = "INSERT INTO animal_event(id,farm_id,animal_id,event_type_id,occurred_at,recorded_at,source_type,source_record_id,actor_ref,related_event_id,supersedes_event_id,voided_at,comment,metadata) VALUES (" + ",".join(sql(v) for v in vals) + ")"
        line = line.replace(sql(vals[3]), f"(SELECT id FROM event_type WHERE farm_id IS NULL AND code = '{code}')")
        self.add(line)
        cols = ["event_id", "farm_id", *detail]
        values = [eid, self.farm_id, *detail.values()]
        line = f"INSERT INTO {table}({','.join(cols)}) VALUES (" + ",".join(sql(v) for v in values) + ")"
        for v in detail.values():
            if isinstance(v, str) and v.startswith("RAW:("):
                line = line.replace(sql(v), v[4:])
        self.add(line)
        return eid

    def generate(self) -> str:
        for i, item in enumerate(self.animals, 1):
            animal = str(item.get("id") or item.get("animal_id") or item.get("uuid"))
            try:
                uuid.UUID(animal)
            except ValueError as exc:
                raise ValueError(f"animal {i} has invalid UUID: {animal}") from exc
            # Rebase demographic fields to an adult profile while preserving UUID;
            # the maintenance transaction owns the replacement of old history.
            base = f"{i:03d}"
            lact = ((i - 1) % 5) + 1
            if i <= 20:
                cohort, dim, ai_days = "fresh", 5 + ((i - 1) % 7) * 5, None
            elif i <= 45:
                cohort, dim, ai_days = "ready", 55 + ((i - 21) % 12) * 5, None
            elif i <= 70:
                ai_days = 1 + ((i - 46) % 10) * 3
                cohort, dim = "recent_ai", ai_days + 70
            elif i <= 90:
                ai_days = 31 + ((i - 71) % 20)
                cohort, dim = "uzi_queue", ai_days + 75
            elif i <= 125:
                ai_days = 60 + ((i - 91) % 15) * 10
                cohort, dim = "pregnant", ai_days + 85
            elif i <= 145:
                ai_days = 230 + ((i - 126) % 7) * 5
                cohort, dim = "dry", ai_days + 90
            else:
                cohort, ai_days, dim = "negative", 45, 120
            latest_calving = self.as_of - timedelta(days=dim)
            birth = (latest_calving - timedelta(days=(lact - 1) * 390 + 740)).date()
            self.add("UPDATE animal SET name=" + sql(item.get("name") or f"Л150 корова {i:03d}") + ", sex='FEMALE', birth_date=" + sql(birth) + " WHERE id=" + sql(animal) + " AND farm_id=" + sql(self.farm_id))
            # Historical calvings are strictly ordered and precede current AI.
            for n in range(lact):
                calving = latest_calving - timedelta(days=390 * (lact - 1 - n))
                if calving.date() <= birth:
                    raise ValueError(f"animal {animal} birth_date is too recent for lactation {lact}")
                cid = self.event(animal, f"{base}-calving-{n+1}", "CALVED", calving, "event_calving", {"difficulty": 1, "offspring_count": 1, "live_offspring_count": 1, "complications": None})
                self.add("INSERT INTO event_calving_offspring(calving_event_id,farm_id,ordinal,animal_id,sex,outcome,birth_weight_kg) VALUES (" + ",".join(sql(v) for v in [cid, self.farm_id, 1, None, "FEMALE", "ALIVE", 39]) + ")")
            born = datetime.combine(birth, time(6), timezone.utc)
            self.event(animal, f"{base}-birth", "BORN", born, "event_birth", {"birth_weight_kg": 39, "birth_order": 1, "viability": "ALIVE"})
            self.event(animal, f"{base}-identifier", "IDENTIFIER_CHANGED", born + timedelta(hours=2), "event_identifier_change", {"identifier_type": "INVENTORY_NUMBER", "identifier_value": item.get("primary_identifier") or f"L150-{i:04d}", "action": "ASSIGNED", "is_primary": True, "related_assignment_event_id": None})
            ai_id = None
            if ai_days is not None:
                ai = self.as_of - timedelta(days=ai_days)
                ai_id = self.event(animal, f"{base}-ai", "INSEMINATED", ai, "event_insemination", {"bull_ref": f"L150-BULL-{(i % 12)+1:02d}", "bull_registration_number": f"L150-REG-{(i % 12)+1:02d}", "semen_batch": f"L150-BATCH-{(i % 6)+1:02d}", "dose": 1, "method": "AI", "technician_ref": f"l150-tech-{(i % 4)+1}", "scheme_code": None})
            if cohort == "pregnant":
                self.event(animal, f"{base}-uzi", "PREGNANCY_CHECKED", self.as_of - timedelta(days=ai_days - 35), "event_pregnancy_check", {"insemination_event_id": ai_id, "method": "ULTRASOUND", "result": "PREGNANT", "gestation_days": 35})
            elif cohort == "dry":
                check_id = self.event(animal, f"{base}-uzi", "PREGNANCY_CHECKED", self.as_of - timedelta(days=ai_days - 35), "event_pregnancy_check", {"insemination_event_id": ai_id, "method": "ULTRASOUND", "result": "PREGNANT", "gestation_days": 35})
                self.event(animal, f"{base}-dryoff", "DRIED_OFF", self.as_of - timedelta(days=ai_days - 220), "event_dry_off", {"pregnancy_check_event_id": check_id, "method": "PLANNED", "reason": "L150 fixture dry-off cohort"})
            elif cohort == "negative":
                self.event(animal, f"{base}-uzi", "PREGNANCY_CHECKED", self.as_of - timedelta(days=10), "event_pregnancy_check", {"insemination_event_id": ai_id, "method": "ULTRASOUND", "result": "NOT_PREGNANT", "gestation_days": None})
            if 101 <= i <= 108:
                did = self.event(animal, f"{base}-mastitis", "DIAGNOSED", self.as_of - timedelta(days=12), "event_diagnosis", {"disease_id": raw("SELECT id FROM disease_definition WHERE farm_id IS NULL AND code = 'MASTITIS'"), "diagnosis_status": "CONFIRMED", "severity": 2, "body_location": "UDDER"})
                self.event(animal, f"{base}-treatment", "TREATMENT_GIVEN", self.as_of - timedelta(days=10), "event_treatment", {"product_id": raw("SELECT id FROM product_definition WHERE farm_id IS NULL AND code = 'MASTITIS_DRUG'"), "dose": 10, "unit_code": "ML", "administration_route": "INTRAMAMMARY", "performer_ref": "l150-vet"})
                if i % 2 == 0:
                    self.event(animal, f"{base}-diagnosis-resolved", "DIAGNOSIS_RESOLVED", self.as_of - timedelta(days=5), "event_diagnosis_resolution", {"diagnosis_event_id": did, "result": "CLEARED", "reason": "L150 fixture resolved"})
            if cohort != "dry":
                for d in range(min(14, dim)):
                    milk = 24 + ((i * 3 + d * 2) % 13)
                    self.event(animal, f"{base}-milk-{d+1:02d}", "DAILY_MILK_RECORDED", self.as_of - timedelta(days=d + 1), "event_daily_milk", {"farm_date": self.as_of_date - timedelta(days=d + 1), "milk_kg": milk, "milking_count": 3})
            group = "DRY" if cohort == "dry" else "MILKING"
            self.event(animal, f"{base}-group", "GROUP_CHANGED", self.as_of - timedelta(hours=2), "event_group_change", {"previous_group_id": None, "new_group_id": raw(f"SELECT id FROM farm_group WHERE farm_id = '{self.farm_id}'::uuid AND code = '{group}'"), "reason": "L150 fixture state"})
            self.lines[-1] = self.lines[-1].replace(sql(raw(f"SELECT id FROM farm_group WHERE farm_id = '{self.farm_id}'::uuid AND code = '{group}'")), f"(SELECT id FROM farm_group WHERE farm_id = '{self.farm_id}'::uuid AND code = '{group}')")
            status = "DRY" if cohort == "dry" else "PREGNANT" if cohort == "pregnant" else "INSEMINATED" if cohort in ("recent_ai", "uzi_queue") else "READY_FOR_INSEMINATION" if cohort in ("ready", "negative") else "FRESH" if cohort == "fresh" else "LACTATING"
            self.event(animal, f"{base}-status", "STATUS_CHANGED", self.as_of - timedelta(hours=1), "event_status_change", {"previous_status_id": None, "new_status_id": raw(f"SELECT id FROM animal_status_type WHERE farm_id IS NULL AND code = '{status}'"), "reason": "L150 fixture state"})
            self.lines[-1] = self.lines[-1].replace(sql(raw(f"SELECT id FROM animal_status_type WHERE farm_id IS NULL AND code = '{status}'")), f"(SELECT id FROM animal_status_type WHERE farm_id IS NULL AND code = '{status}')")
        return "\n".join(self.lines) + "\n"


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--input", type=Path, required=True)
    p.add_argument("--farm-id", required=True)
    p.add_argument("--as-of", type=date.fromisoformat, required=True)
    p.add_argument("--seed", type=int, default=150)
    p.add_argument("--output", type=Path, required=True)
    args = p.parse_args()
    data = json.loads(args.input.read_text(encoding="utf-8"))
    animals = data.get("animals", []) if isinstance(data, dict) else data if isinstance(data, list) else []
    content = L150(args.seed, args.farm_id, args.as_of, animals).generate()
    args.output.write_text(content, encoding="utf-8")
    print(f"wrote {args.output} animals={len(animals)}")


if __name__ == "__main__":
    main()
