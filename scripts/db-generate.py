#!/usr/bin/env python3

import argparse
import hashlib
import random
import uuid
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path


NAMESPACE = uuid.UUID("d7bb02e4-902f-4d58-a965-316d4b1ce92c")


def uid(*parts: object) -> str:
    return str(uuid.uuid5(NAMESPACE, ":".join(map(str, parts))))


def sql(value: object) -> str:
    if value is None:
        return "NULL"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)):
        return str(value)
    if isinstance(value, (date, datetime)):
        return "'" + value.isoformat().replace("+00:00", "Z") + "'"
    return "'" + str(value).replace("'", "''") + "'"


class Generator:
    def __init__(
        self,
        seed: int,
        farms: int,
        animals: int,
        as_of: date,
        profile: str,
        farm_id: str | None = None,
        existing_farm: bool = False,
    ):
        self.rng = random.Random(seed)
        self.seed = seed
        self.farm_count = farms
        self.animals_per_farm = animals
        self.as_of_date = as_of
        self.as_of = datetime.combine(as_of, time(12), timezone.utc)
        self.profile = profile
        self.fixed_farm_id = farm_id
        self.existing_farm = existing_farm
        self.serial_prefix = "l8-" if existing_farm else ""
        if existing_farm and not farm_id:
            raise ValueError("--existing-farm requires --farm-id")
        self.lines = [
            "-- GENERATED TEST DATA. DO NOT TREAT AS CUSTOMER DATA.",
            f"-- AS_OF_DATE={as_of.isoformat()}",
        ]
        if existing_farm:
            self.lines.append(
                "CREATE TEMP TABLE l8_scope_before ON COMMIT DROP AS "
                "SELECT (SELECT count(*) FROM animal WHERE farm_id <> '" + farm_id + "'::uuid) AS other_animals, "
                "(SELECT count(*) FROM animal_event WHERE farm_id <> '" + farm_id + "'::uuid) AS other_events;"
            )
        else:
            self.lines.extend(["SET synchronous_commit = off;", "SET session_replication_role = replica;", "BEGIN;"])

    def add(self, statement: str) -> None:
        self.lines.append(statement.rstrip() + ";")

    def event(
        self,
        farm_id: str,
        animal_id: str,
        serial: str,
        code: str,
        occurred: datetime,
        table: str,
        detail: dict[str, object],
        *,
        recorded: datetime | None = None,
        related: str | None = None,
        supersedes: str | None = None,
        voided: datetime | None = None,
    ) -> str:
        serial = self.serial_prefix + serial
        event_id = uid(self.seed, farm_id, animal_id, serial)
        recorded = recorded or occurred + timedelta(hours=1)
        values = [
            sql(event_id), sql(farm_id), sql(animal_id),
            f"(SELECT id FROM event_type WHERE farm_id IS NULL AND code = {sql(code)})",
            sql(occurred), sql(recorded), sql("SIMULATION"), sql(serial),
            sql("db-generate.py"), sql(related), sql(supersedes), sql(voided),
            sql("GENERATED TEST DATA"), sql('{"test_data":true}'),
        ]
        self.add(
            "INSERT INTO animal_event(id,farm_id,animal_id,event_type_id,occurred_at,recorded_at,"
            "source_type,source_record_id,actor_ref,related_event_id,supersedes_event_id,voided_at,comment,metadata) VALUES ("
            + ",".join(values) + ") ON CONFLICT (id) DO NOTHING"
        )
        columns = ["event_id", "farm_id", *detail.keys()]
        detail_values = [sql(event_id), sql(farm_id), *[sql(v) for v in detail.values()]]
        self.add(f"INSERT INTO {table}({','.join(columns)}) VALUES ({','.join(detail_values)}) ON CONFLICT DO NOTHING")
        return event_id

    def generate(self) -> str:
        scenario_status = {
            0: "HEIFER", 1: "LACTATING", 2: "CULLED", 3: "LACTATING",
            4: "READY_FOR_INSEMINATION", 5: "SELL_READY", 6: "FRESH",
            7: "LACTATING", 8: "PREGNANT", 9: "INSEMINATED", 10: "LACTATING",
            11: "INSEMINATED", 12: "INSEMINATED", 13: "INSEMINATED",
            14: "READY_FOR_INSEMINATION", 15: "HEIFER", 16: "HEIFER",
            17: "HEIFER", 18: "LACTATING",
        }
        group_for = {
            0: "HEIFERS", 1: "MILKING", 2: "EXIT", 3: "HOSPITAL",
            4: "MILKING", 5: "BULLS", 6: "MILKING", 7: "MILKING",
            8: "DRY", 9: "MILKING", 10: "MILKING",
            11: "MILKING", 12: "MILKING", 13: "MILKING", 14: "MILKING",
            15: "HEIFERS", 16: "HEIFERS", 17: "HEIFERS", 18: "MILKING",
        }

        # One block approximates a commercial dairy herd: 40% lactating,
        # 25% heifers, 12% dry pregnant, 8% inseminated, 8% ready for
        # insemination, 5% fresh, 1.5% exited and 0.5% bulls.
        scenario_block = (
            [10] * 70 + [0] * 50 + [8] * 24 + [9] * 16 + [4] * 16
            + [6] * 10 + [1] * 4 + [3] * 4 + [2] * 3 + [7] * 2 + [5]
            if self.profile == "realistic"
            else list(range(10))
        )

        # Keep process boundaries visible in small fixtures.  The first three
        # animals are deliberately adjacent to the UZI1 boundary: 31 is out,
        # 32 is in, and 33 is in.  This is a simulation of the skill predicate,
        # not a claim about the source farm's operational data.
        if self.profile == "realistic":
            scenario_block = [11, 12, 13, 14, 15, 16, 17, 18] + scenario_block

        for farm_no in range(1, self.farm_count + 1):
            # Keep the explicit boundary roster at animal 1..3.  The remaining
            # realistic block is already deterministic; shuffling it would
            # erase the reproducible 31/32/33-day fixture.
            farm_id = self.fixed_farm_id if self.fixed_farm_id else uid(self.seed, "farm", farm_no)
            if self.existing_farm:
                self.add(
                    f"DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM farm WHERE id = {sql(farm_id)}) "
                    f"THEN RAISE EXCEPTION 'target farm does not exist: {farm_id}'; END IF; END $$"
                )
            else:
                self.add(
                    "INSERT INTO farm(id,external_id,name,timezone,settings) VALUES ("
                    f"{sql(farm_id)},{sql(f'TEST-FARM-{farm_no}')},{sql(f'Тестовая ферма {farm_no}')},"
                    f"'Europe/Moscow','{{\"test_data\":true}}') ON CONFLICT (id) DO NOTHING"
                )
                self.add(
                    "INSERT INTO farm_access(farm_id,subject_id,role,valid_from) VALUES ("
                    f"{sql(farm_id)},{sql('test-manager')},'MANAGER','2020-01-01Z') ON CONFLICT DO NOTHING"
                )

            groups: dict[str, str] = {}
            for code, name, group_type, hospital, milking, lactation in [
                ("HEIFERS", "Тестовые тёлки", "AGE", False, False, False),
                ("MILKING", "Тестовое дойное стадо", "PRODUCTION", False, True, True),
                ("HOSPITAL", "Тестовый стационар", "HEALTH", True, False, False),
                ("DRY", "Тестовый сухостой", "REPRODUCTION", False, False, True),
                ("BULLS", "Тестовые быки", "SEX", False, False, False),
                ("EXIT", "Тестовое выбытие", "EXIT", False, False, False),
            ]:
                group_id = uid(self.seed, farm_id, "group", code)
                groups[code] = (
                    f"RAW:(SELECT id FROM farm_group WHERE farm_id = {farm_id!r}::uuid AND code = '{code}')"
                    if self.existing_farm else group_id
                )
                if self.existing_farm:
                    continue
                self.add(
                    "INSERT INTO farm_group(id,farm_id,code,name,group_type,is_hospital,is_milking,is_lactation_group,valid_from) VALUES ("
                    + ",".join(map(sql, [group_id, farm_id, code, name, group_type, hospital, milking, lactation, datetime(2020, 1, 1, tzinfo=timezone.utc)])) + ") ON CONFLICT (id) DO NOTHING"
                )

            for rule, value in [
                ("GESTATION_DAYS", 280), ("DRY_PERIOD_DAYS", 60),
                ("HEAT_CYCLE_DAYS", 21), ("PREGNANCY_CHECK_DAYS", 35),
                ("FIRST_INSEMINATION_DIM", 60),
            ]:
                if self.existing_farm:
                    continue
                self.add(
                    "INSERT INTO farm_rule(id,farm_id,code,value_numeric,unit_code,valid_from,source) VALUES ("
                    + ",".join(map(sql, [uid(self.seed, farm_id, "rule", rule), farm_id, rule, value, "DAY", datetime(2020, 1, 1, tzinfo=timezone.utc), "GENERATED TEST DATA"])) + ") ON CONFLICT (id) DO NOTHING"
                )

            custom_field_id = uid(self.seed, farm_id, "field", "TEMPERAMENT_SCORE")
            if not self.existing_farm:
                self.add(
                "INSERT INTO field_definition(id,farm_id,code,name,scope,value_type,unit_code,source_kind,source_path,is_system) VALUES ("
                + ",".join(map(sql, [custom_field_id, farm_id, "TEMPERAMENT_SCORE", "Тестовый балл темперамента", "ANIMAL", "NUMERIC", "SCORE", "CUSTOM_EVENT_VALUE", "TEMPERAMENT_SCORE", False])) + ") ON CONFLICT (id) DO NOTHING"
            )
                self.add(
                "INSERT INTO field_alias(id,farm_id,field_definition_id,alias,valid_from) VALUES ("
                + ",".join(map(sql, [uid(self.seed, farm_id, "alias", "temperament"), farm_id, custom_field_id, "темперамент", datetime(2020, 1, 1, tzinfo=timezone.utc)])) + ") ON CONFLICT (id) DO NOTHING"
            )

            for animal_no in range(1, self.animals_per_farm + 1):
                scenario = scenario_block[(animal_no - 1) % len(scenario_block)]
                animal_key = "realistic-animal" if self.existing_farm else "animal"
                animal_id = uid(self.seed, farm_id, animal_key, animal_no)
                sex = "MALE" if scenario == 5 else "FEMALE"
                birth_days = 450 if scenario == 0 else (400 if scenario == 5 else 1100 + self.rng.randint(0, 500))
                if scenario in (15, 16, 17):
                    birth_days = {15: 90, 16: 380, 17: 420}[scenario]
                birth_date = self.as_of_date - timedelta(days=birth_days)
                origin = "PURCHASED" if scenario == 5 else "BORN_ON_FARM"
                self.add(
                    "INSERT INTO animal(id,farm_id,name,sex,breed_code,birth_date,origin) VALUES ("
                    + ",".join(map(sql, [animal_id, farm_id, f"Тестовое животное {farm_no}-{animal_no:03d}", sex, "HOLSTEIN", birth_date, origin])) + ") ON CONFLICT (id) DO NOTHING"
                )

                born_at = datetime.combine(birth_date, time(6), timezone.utc)
                if scenario == 5:
                    self.event(farm_id, animal_id, f"f{farm_no}-a{animal_no}-arrival", "ARRIVED", self.as_of - timedelta(days=300),
                               "event_arrival", {"source_kind": "PURCHASE", "previous_farm_ref": "TEST-SOURCE-FARM"})
                else:
                    self.event(farm_id, animal_id, f"f{farm_no}-a{animal_no}-birth", "BORN", born_at,
                               "event_birth", {"birth_weight_kg": 38 + scenario, "birth_order": 1, "viability": "ALIVE"})
                identifier_prefix = "L8-R" if self.existing_farm else "T"
                self.event(farm_id, animal_id, f"f{farm_no}-a{animal_no}-identifier", "IDENTIFIER_CHANGED", born_at + timedelta(hours=2),
                           "event_identifier_change", {"identifier_type": "INVENTORY_NUMBER", "identifier_value": f"{identifier_prefix}{farm_no}-{animal_no:04d}", "action": "ASSIGNED", "is_primary": True, "related_assignment_event_id": None})
                group_at = max(self.as_of - timedelta(days=120), born_at + timedelta(days=3))
                self.event(farm_id, animal_id, f"f{farm_no}-a{animal_no}-group", "GROUP_CHANGED", group_at,
                           "event_group_change", {"previous_group_id": None, "new_group_id": groups[group_for[scenario]], "reason": "GENERATED TEST DATA"})
                if self.existing_farm:
                    self.lines[-1] = self.lines[-1].replace(sql(groups[group_for[scenario]]), groups[group_for[scenario]][4:])

                calving_days = {1: 70, 2: 50, 3: 30, 4: 80, 6: 10, 7: 100, 8: 320, 9: 80, 10: 140, 11: 80, 12: 80, 13: 80, 14: 80}.get(scenario)
                if calving_days is not None:
                    calving_id = self.event(farm_id, animal_id, f"f{farm_no}-a{animal_no}-calving", "CALVED", self.as_of - timedelta(days=calving_days),
                                            "event_calving", {"difficulty": 1, "offspring_count": 1, "live_offspring_count": 1, "complications": None})
                    self.add("INSERT INTO event_calving_offspring(calving_event_id,farm_id,ordinal,animal_id,sex,outcome,birth_weight_kg) VALUES ("
                             + ",".join(map(sql, [calving_id, farm_id, 1, None, "FEMALE", "ALIVE", 39])) + ") ON CONFLICT DO NOTHING")

                status_time = self.as_of - timedelta(days=30 if scenario == 2 else 1)
                self.event(farm_id, animal_id, f"f{farm_no}-a{animal_no}-status", "STATUS_CHANGED", status_time,
                           "event_status_change", {"previous_status_id": None, "new_status_id": f"RAW:(SELECT id FROM animal_status_type WHERE farm_id IS NULL AND code = '{scenario_status[scenario]}')", "reason": "GENERATED TEST DATA"})
                # Replace a deliberately marked raw scalar in the last detail insert.
                self.lines[-1] = self.lines[-1].replace(sql(f"RAW:(SELECT id FROM animal_status_type WHERE farm_id IS NULL AND code = '{scenario_status[scenario]}')"), f"(SELECT id FROM animal_status_type WHERE farm_id IS NULL AND code = '{scenario_status[scenario]}')")

                if calving_days is not None and scenario != 2:
                    if scenario == 4:
                        self.event(farm_id, animal_id, f"f{farm_no}-a{animal_no}-milk-previous", "DAILY_MILK_RECORDED", self.as_of - timedelta(days=2),
                                   "event_daily_milk", {"farm_date": self.as_of_date - timedelta(days=2), "milk_kg": 25, "milking_count": 3})
                    self.event(farm_id, animal_id, f"f{farm_no}-a{animal_no}-milk", "DAILY_MILK_RECORDED", self.as_of - timedelta(days=1),
                               "event_daily_milk", {"farm_date": self.as_of_date - timedelta(days=1), "milk_kg": 24 + scenario, "milking_count": 3})

                if scenario == 1:
                    self.event(farm_id, animal_id, f"f{farm_no}-a{animal_no}-lameness", "DIAGNOSED", self.as_of - timedelta(days=5),
                               "event_diagnosis", {"disease_id": "RAW:(SELECT id FROM disease_definition WHERE farm_id IS NULL AND code = 'LAMENESS')", "diagnosis_status": "CONFIRMED", "severity": 2, "body_location": "LEFT_REAR"})
                    self.lines[-1] = self.lines[-1].replace(sql("RAW:(SELECT id FROM disease_definition WHERE farm_id IS NULL AND code = 'LAMENESS')"), "(SELECT id FROM disease_definition WHERE farm_id IS NULL AND code = 'LAMENESS')")
                elif scenario == 2:
                    exit_at = self.as_of - timedelta(days=30)
                    self.event(farm_id, animal_id, f"f{farm_no}-a{animal_no}-exit", "EXITED", exit_at,
                               "event_exit", {"exit_type": "CULLED", "reason": "GENERATED TEST DATA", "counterparty": None, "amount": None})
                elif scenario == 3:
                    diagnosis_id = self.event(farm_id, animal_id, f"f{farm_no}-a{animal_no}-mastitis", "DIAGNOSED", self.as_of - timedelta(days=4),
                                              "event_diagnosis", {"disease_id": "RAW:(SELECT id FROM disease_definition WHERE farm_id IS NULL AND code = 'MASTITIS')", "diagnosis_status": "CONFIRMED", "severity": 3, "body_location": "UDDER"})
                    self.lines[-1] = self.lines[-1].replace(sql("RAW:(SELECT id FROM disease_definition WHERE farm_id IS NULL AND code = 'MASTITIS')"), "(SELECT id FROM disease_definition WHERE farm_id IS NULL AND code = 'MASTITIS')")
                    self.event(farm_id, animal_id, f"f{farm_no}-a{animal_no}-treatment", "TREATMENT_GIVEN", self.as_of - timedelta(days=3),
                               "event_treatment", {"product_id": "RAW:(SELECT id FROM product_definition WHERE farm_id IS NULL AND code = 'MASTITIS_DRUG')", "dose": 10, "unit_code": "ML", "administration_route": "INTRAMAMMARY", "performer_ref": "test-vet"}, related=diagnosis_id)
                    self.lines[-1] = self.lines[-1].replace(sql("RAW:(SELECT id FROM product_definition WHERE farm_id IS NULL AND code = 'MASTITIS_DRUG')"), "(SELECT id FROM product_definition WHERE farm_id IS NULL AND code = 'MASTITIS_DRUG')")
                elif scenario == 7:
                    self.event(farm_id, animal_id, f"f{farm_no}-a{animal_no}-protocol", "PROTOCOL_ASSIGNED", self.as_of - timedelta(days=2),
                               "event_protocol_assignment", {"protocol_id": "RAW:(SELECT id FROM protocol_definition WHERE farm_id IS NULL AND code = 'FRESH_COW_CHECK' AND version = 1)", "purpose": "GENERATED TEST DATA", "planned_start_at": self.as_of - timedelta(days=2)})
                    self.lines[-1] = self.lines[-1].replace(sql("RAW:(SELECT id FROM protocol_definition WHERE farm_id IS NULL AND code = 'FRESH_COW_CHECK' AND version = 1)"), "(SELECT id FROM protocol_definition WHERE farm_id IS NULL AND code = 'FRESH_COW_CHECK' AND version = 1)")
                elif scenario in (8, 9, 11, 12, 13):
                    insemination_days = {8: 260, 9: 20, 11: 31, 12: 32, 13: 33}[scenario]
                    insemination_id = self.event(farm_id, animal_id, f"f{farm_no}-a{animal_no}-insemination", "INSEMINATED", self.as_of - timedelta(days=insemination_days),
                                                 "event_insemination", {"bull_ref": "TEST-BULL", "bull_registration_number": "TEST-REG", "semen_batch": "TEST-BATCH", "dose": 1, "method": "AI", "technician_ref": "test-tech", "scheme_code": None})
                    if scenario == 8:
                        self.event(farm_id, animal_id, f"f{farm_no}-a{animal_no}-pregnancy", "PREGNANCY_CHECKED", self.as_of - timedelta(days=225),
                                   "event_pregnancy_check", {"insemination_event_id": insemination_id, "method": "ULTRASOUND", "result": "PREGNANT", "gestation_days": 35}, related=insemination_id)

                if scenario == 4:
                    occurred = self.as_of - timedelta(days=100)
                    old_recorded = self.as_of - timedelta(days=20)
                    corrected_recorded = self.as_of - timedelta(days=10)
                    old_id = self.event(farm_id, animal_id, f"f{farm_no}-a{animal_no}-weight-old", "MEASURED", occurred,
                                        "event_measurement", {"measurement_code": "WEIGHT", "value_numeric": 500, "unit_code": "KG", "method": "SCALE", "device_ref": "TEST-SCALE"},
                                        recorded=old_recorded, voided=corrected_recorded)
                    self.event(farm_id, animal_id, f"f{farm_no}-a{animal_no}-weight-corrected", "MEASURED", occurred,
                               "event_measurement", {"measurement_code": "WEIGHT", "value_numeric": 525, "unit_code": "KG", "method": "SCALE", "device_ref": "TEST-SCALE"},
                               recorded=corrected_recorded, supersedes=old_id)

                if animal_no == 1 and not self.existing_farm:
                    self.event(farm_id, animal_id, f"f{farm_no}-a{animal_no}-custom", "CUSTOM_EVENT_RECORDED", self.as_of - timedelta(days=2),
                               "custom_event_value", {"field_definition_id": custom_field_id, "value_numeric": 4})
                    self.exercise_remaining_event_types(farm_id, animal_id, farm_no, animal_no)

        if self.existing_farm:
            self.add(
                "DO $$ DECLARE before_row record; BEGIN SELECT * INTO before_row FROM l8_scope_before; "
                "IF before_row.other_animals <> (SELECT count(*) FROM animal WHERE farm_id <> '" + self.fixed_farm_id + "'::uuid) "
                "OR before_row.other_events <> (SELECT count(*) FROM animal_event WHERE farm_id <> '" + self.fixed_farm_id + "'::uuid) "
                "THEN RAISE EXCEPTION 'l8 fixture changed rows outside target farm'; END IF; END $$"
            )
        else:
            self.lines.extend(["COMMIT;", "SET session_replication_role = origin;"])
        return "\n".join(self.lines) + "\n"

    def exercise_remaining_event_types(self, farm_id: str, animal_id: str, farm_no: int, animal_no: int) -> None:
        """Add closed, non-current examples so every standard table is executable."""
        prefix = f"f{farm_no}-a{animal_no}-coverage"
        base = self.as_of - timedelta(days=90)
        archive_id = self.event(farm_id, animal_id, prefix + "-archive", "ARCHIVE_CHANGED", base,
                                "event_archive", {"action": "ARCHIVED", "reason": "GENERATED TEST DATA"})
        self.event(farm_id, animal_id, prefix + "-restore", "ARCHIVE_CHANGED", base + timedelta(hours=1),
                   "event_archive", {"action": "RESTORED", "reason": "GENERATED TEST DATA"}, related=archive_id)
        note_id = uid(self.seed, farm_id, "coverage-note")
        note_event = self.event(farm_id, animal_id, prefix + "-note-add", "NOTE_CHANGED", base + timedelta(days=1),
                                "event_note", {"note_id": note_id, "action": "ADDED", "category": "TEST", "note_text": "GENERATED TEST DATA", "previous_note_event_id": None})
        self.event(farm_id, animal_id, prefix + "-note-update", "NOTE_CHANGED", base + timedelta(days=2),
                   "event_note", {"note_id": note_id, "action": "UPDATED", "category": "TEST", "note_text": "GENERATED TEST DATA UPDATED", "previous_note_event_id": note_event}, related=note_event)
        staff_event = self.event(farm_id, animal_id, prefix + "-staff-on", "STAFF_ASSIGNMENT_CHANGED", base + timedelta(days=3),
                                 "event_staff_assignment", {"subject_id": "test-worker", "assignment_role": "VET", "action": "ASSIGNED", "related_assignment_event_id": None})
        self.event(farm_id, animal_id, prefix + "-staff-off", "STAFF_ASSIGNMENT_CHANGED", base + timedelta(days=4),
                   "event_staff_assignment", {"subject_id": "test-worker", "assignment_role": "VET", "action": "UNASSIGNED", "related_assignment_event_id": staff_event}, related=staff_event)
        insurance_event = self.event(farm_id, animal_id, prefix + "-insurance-on", "INSURANCE_CHANGED", base + timedelta(days=5),
                                     "event_insurance", {"action": "STARTED", "provider": "TEST INSURER", "policy_number": "TEST-POLICY", "valid_until": self.as_of_date, "related_start_event_id": None, "reason": None})
        self.event(farm_id, animal_id, prefix + "-insurance-off", "INSURANCE_CHANGED", base + timedelta(days=6),
                   "event_insurance", {"action": "ENDED", "provider": "TEST INSURER", "policy_number": "TEST-POLICY", "valid_until": self.as_of_date, "related_start_event_id": insurance_event, "reason": "GENERATED TEST DATA"}, related=insurance_event)
        self.event(farm_id, animal_id, prefix + "-heat", "HEAT_DETECTED", base + timedelta(days=7),
                   "event_heat", {"detection_method": "VISUAL", "intensity": 3})
        coverage_insemination = self.event(farm_id, animal_id, prefix + "-insemination", "INSEMINATED", base + timedelta(days=8),
                                           "event_insemination", {"bull_ref": "TEST-COVERAGE-BULL", "bull_registration_number": None, "semen_batch": "TEST", "dose": 1, "method": "AI", "technician_ref": "test-tech", "scheme_code": None})
        coverage_check = self.event(farm_id, animal_id, prefix + "-pregnancy", "PREGNANCY_CHECKED", base + timedelta(days=43),
                                    "event_pregnancy_check", {"insemination_event_id": coverage_insemination, "method": "ULTRASOUND", "result": "PREGNANT", "gestation_days": 35}, related=coverage_insemination)
        self.event(farm_id, animal_id, prefix + "-pregnancy-loss", "PREGNANCY_LOST", base + timedelta(days=44),
                   "event_pregnancy_loss", {"pregnancy_check_event_id": coverage_check, "loss_type": "EARLY", "reason": "GENERATED TEST DATA", "confirmation_method": "ULTRASOUND"}, related=coverage_check)
        self.event(farm_id, animal_id, prefix + "-dry-off", "DRIED_OFF", base + timedelta(days=45),
                   "event_dry_off", {"pregnancy_check_event_id": coverage_check, "method": "ABRUPT", "reason": "GENERATED TEST DATA"}, related=coverage_check)
        self.event(farm_id, animal_id, prefix + "-milking", "MILKED", base + timedelta(days=46),
                   "event_milking", {"session_code": "TEST-AM", "milk_kg": 12, "duration_seconds": 300, "device_ref": "TEST-METER"})
        self.event(farm_id, animal_id, prefix + "-milk-test", "MILK_TESTED", base + timedelta(days=47),
                   "event_milk_test", {"milk_kg": 24, "fat_percent": 4.1, "protein_percent": 3.3, "somatic_cells": 150000, "urea": 18})
        self.event(farm_id, animal_id, prefix + "-observation", "HEALTH_OBSERVED", base + timedelta(days=48),
                   "event_health_observation", {"procedure_id": None, "observation_code": "BODY_CONDITION", "body_location": None, "result": "NORMAL", "severity": 1})
        diagnosis_id = self.event(farm_id, animal_id, prefix + "-diagnosis", "DIAGNOSED", base + timedelta(days=49),
                                  "event_diagnosis", {"disease_id": "RAW:(SELECT id FROM disease_definition WHERE farm_id IS NULL AND code = 'KETOSIS')", "diagnosis_status": "SUSPECTED", "severity": 1, "body_location": None})
        self.lines[-1] = self.lines[-1].replace(sql("RAW:(SELECT id FROM disease_definition WHERE farm_id IS NULL AND code = 'KETOSIS')"), "(SELECT id FROM disease_definition WHERE farm_id IS NULL AND code = 'KETOSIS')")
        self.event(farm_id, animal_id, prefix + "-diagnosis-resolved", "DIAGNOSIS_RESOLVED", base + timedelta(days=50),
                   "event_diagnosis_resolution", {"diagnosis_event_id": diagnosis_id, "result": "CLEARED", "reason": "GENERATED TEST DATA"}, related=diagnosis_id)
        self.event(farm_id, animal_id, prefix + "-vaccination", "VACCINATED", base + timedelta(days=51),
                   "event_vaccination", {"product_id": "RAW:(SELECT id FROM product_definition WHERE farm_id IS NULL AND code = 'BASE_VACCINE')", "dose": 2, "unit_code": "ML", "batch_number": "TEST-BATCH", "administration_route": "IM"})
        self.lines[-1] = self.lines[-1].replace(sql("RAW:(SELECT id FROM product_definition WHERE farm_id IS NULL AND code = 'BASE_VACCINE')"), "(SELECT id FROM product_definition WHERE farm_id IS NULL AND code = 'BASE_VACCINE')")
        self.event(farm_id, animal_id, prefix + "-hoof", "HOOF_PROCEDURE", base + timedelta(days=52),
                   "event_hoof_procedure", {"procedure_id": "RAW:(SELECT id FROM procedure_definition WHERE farm_id IS NULL AND code = 'HOOF_TRIM')", "limb": "LEFT_REAR", "result": "COMPLETED"})
        self.lines[-1] = self.lines[-1].replace(sql("RAW:(SELECT id FROM procedure_definition WHERE farm_id IS NULL AND code = 'HOOF_TRIM')"), "(SELECT id FROM procedure_definition WHERE farm_id IS NULL AND code = 'HOOF_TRIM')")
        withdrawal_id = self.event(farm_id, animal_id, prefix + "-withdrawal-on", "WITHDRAWAL_STARTED", base + timedelta(days=53),
                                   "event_withdrawal_start", {"reason": "GENERATED TEST DATA", "expected_end_at": base + timedelta(days=56)})
        self.event(farm_id, animal_id, prefix + "-withdrawal-off", "WITHDRAWAL_ENDED", base + timedelta(days=56),
                   "event_withdrawal_end", {"withdrawal_start_event_id": withdrawal_id, "actual_end_at": base + timedelta(days=56), "reason": "COMPLETED"}, related=withdrawal_id)
        assignment = self.event(farm_id, animal_id, prefix + "-protocol", "PROTOCOL_ASSIGNED", base + timedelta(days=57),
                                "event_protocol_assignment", {"protocol_id": "RAW:(SELECT id FROM protocol_definition WHERE farm_id IS NULL AND code = 'FRESH_COW_CHECK' AND version = 1)", "purpose": "COVERAGE", "planned_start_at": base + timedelta(days=57)})
        self.lines[-1] = self.lines[-1].replace(sql("RAW:(SELECT id FROM protocol_definition WHERE farm_id IS NULL AND code = 'FRESH_COW_CHECK' AND version = 1)"), "(SELECT id FROM protocol_definition WHERE farm_id IS NULL AND code = 'FRESH_COW_CHECK' AND version = 1)")
        self.event(farm_id, animal_id, prefix + "-protocol-step", "PROTOCOL_STEP_COMPLETED", base + timedelta(days=58),
                   "event_protocol_step", {"assignment_event_id": assignment, "step_definition_id": "RAW:(SELECT id FROM protocol_step_definition WHERE step_code = 'CHECK' LIMIT 1)", "planned_at": base + timedelta(days=58), "completed_at": base + timedelta(days=58), "result": "NORMAL"}, related=assignment)
        self.lines[-1] = self.lines[-1].replace(sql("RAW:(SELECT id FROM protocol_step_definition WHERE step_code = 'CHECK' LIMIT 1)"), "(SELECT id FROM protocol_step_definition WHERE step_code = 'CHECK' LIMIT 1)")
        self.event(farm_id, animal_id, prefix + "-protocol-complete", "PROTOCOL_COMPLETED", base + timedelta(days=59),
                   "event_protocol_completion", {"assignment_event_id": assignment, "result": "COMPLETED"}, related=assignment)
        cancelled_assignment = self.event(farm_id, animal_id, prefix + "-protocol-cancel-assignment", "PROTOCOL_ASSIGNED", base + timedelta(days=60),
                                          "event_protocol_assignment", {"protocol_id": "RAW:(SELECT id FROM protocol_definition WHERE farm_id IS NULL AND code = 'OVSYNCH' AND version = 1)", "purpose": "COVERAGE", "planned_start_at": base + timedelta(days=60)})
        self.lines[-1] = self.lines[-1].replace(sql("RAW:(SELECT id FROM protocol_definition WHERE farm_id IS NULL AND code = 'OVSYNCH' AND version = 1)"), "(SELECT id FROM protocol_definition WHERE farm_id IS NULL AND code = 'OVSYNCH' AND version = 1)")
        self.event(farm_id, animal_id, prefix + "-protocol-cancel", "PROTOCOL_CANCELLED", base + timedelta(days=61),
                   "event_protocol_cancellation", {"assignment_event_id": cancelled_assignment, "reason": "GENERATED TEST DATA"}, related=cancelled_assignment)


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate deterministic synthetic farm data")
    parser.add_argument("--seed", type=int, required=True)
    parser.add_argument("--farms", type=int, required=True)
    parser.add_argument("--animals-per-farm", type=int, required=True)
    parser.add_argument("--as-of", type=date.fromisoformat, required=True)
    parser.add_argument("--profile", choices=["coverage", "realistic"], default="coverage")
    parser.add_argument("--farm-id", help="Use this exact farm UUID instead of deriving IDs from --seed")
    parser.add_argument(
        "--existing-farm",
        action="store_true",
        help="Emit a guarded single-farm fixture; never create farm/access rows",
    )
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()

    if args.existing_farm and args.farms != 1:
        parser.error("--existing-farm requires --farms 1")
    if args.farm_id and args.farms != 1:
        parser.error("--farm-id requires --farms 1")
    content = Generator(
        args.seed,
        args.farms,
        args.animals_per_farm,
        args.as_of,
        args.profile,
        farm_id=args.farm_id,
        existing_farm=args.existing_farm,
    ).generate()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(content, encoding="utf-8")
    digest = hashlib.sha256(content.encode()).hexdigest()
    print(f"wrote {args.output} sha256={digest}")


if __name__ == "__main__":
    main()
