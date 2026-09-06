"""Independent source/fixture checks; this does not certify runtime execution."""

import csv
import datetime as dt
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
fixture = json.loads(Path(__file__).with_name("source-boundaries.json").read_text())
source = ROOT / "data/lists.csv"
assert hashlib.sha256(source.read_bytes()).hexdigest() == fixture["sourceSha256"]
with source.open(encoding="utf-8-sig", newline="") as stream:
    rows = {(r["company_id"], r["list_id"]): r for r in csv.DictReader(stream)}

checked = 0
for rule in fixture["rules"]:
    row = rule["source"]
    assert rows[(row["company_id"], row["list_id"])] == row
    rule_id = row["list_id"]
    for case in rule.get("filterCases", []):
        if rule_id == "541":
            days = case["daysSinceInsemination"]
            actual = case["status"] in ("Новотельная", "Готова к осеменению") and (
                case["daysOnScheme"] == 36 or (days is not None and 42 <= days <= 48)
            )
        elif rule_id == "197":
            second = case["secondDate"]
            lower = dt.date.fromisoformat(case["asOfDate"]) - dt.timedelta(days=365)
            actual = case["lactation"] > 0 and second is not None and dt.date.fromisoformat(second) >= lower
        elif rule_id == "4153":
            actual = case["genomicDate"] is not None
        else:
            raise AssertionError(rule_id)
        assert actual == case["matchesTree"], (rule_id, case)
        checked += 1
    for case in rule.get("historicalCases", []):
        events = sorted(
            [e for e in case["events"] if e["lactationId"] == case["currentLactationId"]],
            key=lambda event: event["date"],
        )
        # This fixture deliberately avoids ties/corrections, whose contract is open.
        assert events[1]["id"] == case["expectedSecondEventId"]
        checked += 1
    for case in rule.get("namedRootCases", []):
        value = case["forecast"]
        roots = []
        if value is not None:
            if case["lactation"] > 0 and value <= 5000:
                roots.append(1)
            for ordinal, lower in enumerate(range(5001, 12000, 1000), start=2):
                if lower <= value <= lower + 999:
                    roots.append(ordinal)
            if value >= 12001:
                roots.append(9)
        assert roots == case["matchingRootOrdinals"], case
        checked += 1

print(f"PASS: 4 exact source records and {checked} independent boundary cases; runtime and unresolved source semantics NOT verified")
