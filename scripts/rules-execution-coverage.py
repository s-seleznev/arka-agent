#!/usr/bin/env python3
"""Join evidence only when all audits describe the exact current artifacts."""
import csv
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RULES = ROOT / 'rules'


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def load(name):
    return json.loads((RULES / name).read_text())


def stable_id(value):
    h = hashlib.sha256(value.encode()).hexdigest()
    return f'{h[:8]}-{h[8:12]}-5{h[13:16]}-a{h[17:20]}-{h[20:32]}'


def main():
    normalized_sha = sha(RULES / 'normalized.jsonl')
    records = [json.loads(line) for line in (RULES / 'normalized.jsonl').read_text().splitlines()]
    compiler, query, imported = load('compiler-audit.json'), load('query-coverage.json'), load('import-verification.json')
    assert compiler['normalizedSha256'] == query['normalizedSha256'] == normalized_sha, 'STALE_NORMALIZED_AUDIT'
    assert query['complete'] and not query['implementationChangedDuringRun'], 'INCOMPLETE_QUERY_AUDIT'
    assert compiler['bindingConfigSha256'] == query['bindingConfigSha256'] == sha(RULES / 'demo-bindings.json'), 'STALE_BINDING_AUDIT'
    assert compiler['bindingVersion'] == query['bindingVersion'], 'BINDING_VERSION_MISMATCH'
    for audit in (compiler, query):
        for path, expected in audit['implementationSha256'].items():
            assert sha(ROOT / 'agent-app' / path) == expected, f'STALE_IMPLEMENTATION:{path}'
    assert 'lib/farm/fields.ts' in compiler['implementationSha256'], 'MISSING_REGISTRY_IMPLEMENTATION_HASH'
    snapshots = [row for row in imported['snapshots'] if row['normalizedSha256'] == normalized_sha]
    assert len(snapshots) == 1 and snapshots[0]['exactDefinitionReadback'], 'UNVERIFIED_IMPORT'
    snapshot = snapshots[0]
    with (RULES / 'compiler-coverage.csv').open() as file:
        compiled_rows = list(csv.DictReader(file))
    compiled = {(row['company_id'], row['list_id']): row for row in compiled_rows}
    executed = {(row['companyId'], row['listId']): row for row in query['results']}
    assert len(compiled_rows) == len(compiled) == len(executed) == len(query['results']) == len(records) == 6735, 'COVERAGE_COUNT_MISMATCH'
    output = []
    for record in records:
        source = record['source']
        key = (source['companyId'], source['listId'])
        c, q = compiled[key], executed[key]
        assert c['snapshot_sha256'] == source['snapshotSha256'] == snapshot['sourceSha256'], 'SOURCE_HASH_MISMATCH'
        assert q['definitionId'] == source['definitionId'], 'SOURCE_DEFINITION_MISMATCH'
        ready = c['compile_only'] == 'true'
        assert ready == q['compiled'], 'COMPILE_QUERY_DISAGREEMENT'
        assert sorted(json.loads(c['diagnostic_codes'])) == sorted(q['diagnostics']), 'DIAGNOSTICS_DISAGREEMENT'
        output.append({
            'snapshot_id': snapshot['snapshotId'],
            'normalized_sha256': normalized_sha,
            'parser_version': record['parserVersion'],
            'binding_version': query['bindingVersion'],
            'binding_config_sha256': query['bindingConfigSha256'],
            'source_definition_id': source['definitionId'],
            'product_definition_id': stable_id(f"RuleDefinition:{snapshot['snapshotId']}:{key[0]}:{key[1]}"),
            'company_id': key[0], 'list_id': key[1], 'farm_id': q['farmId'],
            'imported': 'true', 'syntax_parsed': str(record['status']['parsed']).lower(),
            'compile_ready': str(ready).lower(), 'query_execution': q['execution'],
            'independent_semantic_check': 'partial' if q.get('independentScope') else 'unverified',
            'independent_scope': q.get('independentScope', ''),
            'ui_verified': 'unverified', 'diagnostic_codes': c['diagnostic_codes'],
            'as_of': query['asOf'], 'data_snapshot': query['snapshot'],
        })
    assert sum(row['compile_ready'] == 'true' for row in output) == compiler['compiled'] == query['compiled'], 'COMPILED_COUNT_MISMATCH'
    with (RULES / 'execution-coverage.csv').open('w') as file:
        writer = csv.DictWriter(file, fieldnames=list(output[0]))
        writer.writeheader()
        writer.writerows(output)
    print(json.dumps({'records': len(output), 'compiled': compiler['compiled'], 'queryExecutionPassed': query['executionPassed'], 'uiVerified': 'unverified', 'normalizedSha256': normalized_sha, 'coverageSha256': sha(RULES / 'execution-coverage.csv')}))


if __name__ == '__main__':
    main()
