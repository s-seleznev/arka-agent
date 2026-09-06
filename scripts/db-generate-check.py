#!/usr/bin/env python3
"""Static checks for a generated fixture; never connects to PostgreSQL."""

import argparse
import re
from datetime import date, timedelta
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser(description="Check generated farm fixture invariants")
    parser.add_argument("sql_file", type=Path)
    parser.add_argument("--farm-id", required=True)
    args = parser.parse_args()
    text = args.sql_file.read_text(encoding="utf-8")

    # Existing-farm mode must contain a guard and must never create a farm.
    if f"farm WHERE id = '{args.farm_id}'" not in text:
        raise SystemExit("fixture is not guarded as an existing-farm fixture")
    if "INSERT INTO farm(" in text or "INSERT INTO farm (" in text:
        raise SystemExit("existing-farm fixture attempts to create a farm")
    for table in ("farm_group", "farm_rule", "field_definition", "field_alias"):
        if f"INSERT INTO {table}" in text:
            raise SystemExit(f"existing-farm fixture attempts to create {table}")
    if text.count(args.farm_id) < 3:
        raise SystemExit("target farm id is not present in fixture rows")
    source_ids = re.findall(r"'((?:l8-)[^']+)'", text)
    if not source_ids or any("source_record_id" not in line for line in text.splitlines() if "'l8-" in line):
        raise SystemExit("fixture has an unscoped source_record_id")

    # The first three realistic animals are the explicit UZI1 boundary cohort.
    as_of_match = re.search(r"^-- AS_OF_DATE=([0-9]{4}-[0-9]{2}-[0-9]{2})$", text, re.M)
    if not as_of_match:
        raise SystemExit("missing explicit AS_OF_DATE header")
    as_of = date.fromisoformat(as_of_match.group(1))
    for days, serial in [(31, "l8-f1-a1-insemination"), (32, "l8-f1-a2-insemination"), (33, "l8-f1-a3-insemination")]:
        line = next((row for row in text.splitlines() if serial in row), "")
        match = re.search(r"'([0-9]{4}-[0-9]{2}-[0-9]{2})T", line)
        if not match:
            raise SystemExit(f"missing boundary event {serial}")
        expected = (as_of - timedelta(days=days)).isoformat()
        if match.group(1) != expected:
            raise SystemExit(f"{serial}: expected {expected}, got {match.group(1)}")
    if text.count("code = 'INSEMINATED'") < 3:
        raise SystemExit("missing INSEMINATED boundary statuses")
    print(f"ok: farm={args.farm_id} boundary cohort=31,32,33 SQL-only")


if __name__ == "__main__":
    main()
