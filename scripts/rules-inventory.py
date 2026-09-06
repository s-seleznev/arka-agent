#!/usr/bin/env python3
"""Lossless CSV inventory. No implicit joins, bindings or field semantics.

Spans index Unicode code points in the CSV-decoded, otherwise unmodified cell.
Run from any directory: python3 scripts/rules-inventory.py [--output DIRECTORY]
"""
import argparse
import collections
import csv
import datetime
import decimal
import hashlib
import functools
import json
from pathlib import Path
import re

VERSION = 'csv-rules-text/v2'
EXPECTED_SHA = '5718a05d135123c7f9eaafb8ac5039494fe1b2d60abac86c1159ecb224749d0e'
ROOT = Path(__file__).resolve().parents[1]
HEADERS = ['company_id', 'list_id', 'list_name', 'run_type', 'description', 'created_date', 'favorites_count', 'columns_count', 'filters_count', 'has_group_by', 'launches_3m', 'launches_all', 'used_in_reports_count', 'interval_text', 'vitality_filter', 'column_names', 'group_by_names', 'filters_text']
GROUP = re.compile(r'(?:\[(.*)\]\s+)?\((AND|OR|NOT)\)')
PREDICATE = re.compile(r'•\s+(.+?)\s+(NOT_NULL|IS_NULL|пусто|NOT_IN|IN|BETWEEN|NOT_BETWEEN|CONTAINS|NOT_CONTAINS|>=|<=|!=|=|≠|≥|≤|>|<)(?:\s+(.*)|\s*)')
NUMBER = re.compile(r'[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?')
NEWLINE = re.compile(r'\\r\\n|\\n|\r\n|\n|\r')


def dumps(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':'), sort_keys=True)


def span(column, start, end):
    return {'column': column, 'start': start, 'end': end}


def diagnostic(code, severity, cell, at, message):
    return {'code': code, 'severity': severity, 'span': at, 'raw': cell[at['start']:at['end']], 'message': message}


def lines(cell):
    start = 0
    for match in NEWLINE.finditer(cell):
        yield start, cell[start:match.start()]
        start = match.end()
    yield start, cell[start:]


def parse_labels(cell, column):
    """Export uses comma-space separators; spans retain exact label spelling."""
    labels = []
    start = 0
    for match in list(re.finditer(r', ', cell)) + [None]:
        end = match.start() if match else len(cell)
        part = cell[start:end]
        if part.strip():
            left = start + len(part) - len(part.lstrip())
            right = end - (len(part) - len(part.rstrip()))
            labels.append({'label': cell[left:right], 'span': span(column, left, right)})
        start = match.end() if match else len(cell)
    return labels


def bracket_labels(cell, column):
    """Only split comma-space outside balanced round/square brackets."""
    stack, separators = [], []
    for index, char in enumerate(cell):
        if char in '([':
            stack.append(char)
        elif char in ')]':
            if not stack or (stack.pop(), char) not in [('(', ')'), ('[', ']')]:
                return None
        elif cell[index:index + 2] == ', ' and not stack:
            separators.append(index)
    if stack:
        return None
    result, start = [], 0
    for end in separators + [len(cell)]:
        part = cell[start:end]
        if part.strip():
            left = start + len(part) - len(part.lstrip())
            right = end - (len(part) - len(part.rstrip()))
            result.append({'label': cell[left:right], 'span': span(column, left, right)})
        start = end + 2
    return result


def resolve_columns(cell, expected, known_labels):
    original = parse_labels(cell, 'column_names')
    # An already matching declared count gives no evidence to merge columns.
    if len(original) == expected:
        return original
    parts = bracket_labels(cell, 'column_names')
    if parts is None:
        return original

    @functools.lru_cache(None)
    def solutions(index, remaining):
        if index == len(parts):
            return [()] if remaining == 0 else []
        if remaining <= 0:
            return []
        found = []
        for end in range(index + 1, len(parts) + 1):
            left, right = parts[index]['span']['start'], parts[end - 1]['span']['end']
            label = cell[left:right]
            # Cross-company aliases and fuzzy label matching are forbidden.
            if end == index + 1 or label in known_labels:
                for tail in solutions(end, remaining - 1):
                    found.append(((left, right),) + tail)
                    if len(found) == 2:
                        return found
        return found

    candidates = solutions(0, expected)
    if len(candidates) != 1:
        return original
    return [{'label': cell[left:right], 'span': span('column_names', left, right)} for left, right in candidates[0]]


def operand(raw):
    if NUMBER.fullmatch(raw):
        # Decimal stays text: JSON binary floats would silently round source values.
        return {'kind': 'decimal', 'raw': raw, 'value': raw}
    if re.fullmatch(r'\d{4}-\d{2}-\d{2}', raw):
        try:
            datetime.date.fromisoformat(raw)
            return {'kind': 'date', 'raw': raw, 'value': raw}
        except ValueError:
            pass
    m = re.fullmatch(r'Сегодня(?:\s*([+-])\s*(\d+)\s+дней)?', raw)
    if m:
        return {'kind': 'relativeDate', 'raw': raw, 'anchor': 'as_of_local_date', 'offsetDays': (int(m[2]) * (-1 if m[1] == '-' else 1)) if m[2] else 0}
    if len(raw) >= 2 and raw[0] == raw[-1] == '"':
        return {'kind': 'unresolved', 'raw': raw, 'candidates': ['literal'], 'reason': 'QUOTED_LITERAL_ENCODING_UNCONFIRMED'}
    return {'kind': 'unresolved', 'raw': raw, 'candidates': ['literal', 'fieldReference', 'parameter'], 'reason': 'OPERAND_KIND_UNCONFIRMED'}


def walk(roots):
    for node in roots:
        yield node
        yield from walk(node.get('children', []))


def parse_filters(cell):
    roots, stack, diagnostics = [], [], []
    previous_indent, previous_kind = None, None
    for start, line in lines(cell):
        if not line.strip():
            continue
        indent = len(line) - len(line.lstrip(' '))
        content = line[indent:]
        at = span('filters_text', start + indent, start + len(line))
        match_group = GROUP.fullmatch(content)
        match_predicate = PREDICATE.fullmatch(content)
        if '\t' in line[:len(line) - len(line.lstrip())]:
            diagnostics.append(diagnostic('TAB_INDENT', 'syntax', cell, at, 'Indentation uses an unconfirmed tab width.'))
        if previous_indent is not None and indent > previous_indent and previous_kind != 'group':
            diagnostics.append(diagnostic('INDENT_AFTER_LEAF', 'syntax', cell, at, 'Only a group may contain indented children.'))
        if match_group:
            node = {'kind': 'group', 'operator': match_group[2], 'name': match_group[1], 'children': [], 'span': at}
        elif match_predicate:
            field, op, rhs = match_predicate[1], match_predicate[2], match_predicate[3] or ''
            field_start = at['start'] + match_predicate.start(1)
            node = {'kind': 'predicate', 'fieldLabel': field, 'fieldSpan': span('filters_text', field_start, field_start + len(field)), 'operator': op, 'span': at}
            if op in ('NOT_NULL', 'IS_NULL', 'пусто'):
                node['operand'] = {'kind': 'none', 'raw': rhs}
                if rhs:
                    diagnostics.append(diagnostic('UNEXPECTED_NULL_OPERAND', 'syntax', cell, at, 'A null test has unexpected trailing text.'))
                diagnostics.append(diagnostic('NULL_POLICY_UNCONFIRMED', 'semantic', cell, at, 'Export does not define missing versus empty value behavior.'))
            else:
                node['operand'] = operand(rhs)
                rhs_start = at['start'] + (match_predicate.start(3) if match_predicate[3] is not None else len(content))
                node['operand']['span'] = span('filters_text', rhs_start, at['end'])
                if not rhs:
                    diagnostics.append(diagnostic('MISSING_OPERAND', 'syntax', cell, at, 'Comparison has no right operand.'))
                elif node['operand']['kind'] == 'unresolved':
                    diagnostics.append(diagnostic(node['operand']['reason'], 'semantic', cell, node['operand']['span'], 'Confirm literal, field reference or parameter against the original definition.'))
                if op in ('IN', 'NOT_IN', 'BETWEEN', 'NOT_BETWEEN', 'CONTAINS', 'NOT_CONTAINS'):
                    diagnostics.append(diagnostic('VALUE_COLLECTION_ENCODING_UNCONFIRMED', 'semantic', cell, at, 'Value list/range encoding requires an explicit format contract.'))
        else:
            node = {'kind': 'unknown', 'raw': content, 'span': at}
            diagnostics.append(diagnostic('UNRECOGNIZED_LINE', 'syntax', cell, at, 'Line is retained but has no recognized grammar.'))
        while stack and indent <= stack[-1][0]:
            stack.pop()
        (stack[-1][1]['children'] if stack else roots).append(node)
        if node['kind'] == 'group':
            stack.append((indent, node))
        previous_indent, previous_kind = indent, node['kind']
    for node in walk(roots):
        if node['kind'] == 'group':
            if not node['children'] or (node['operator'] == 'NOT' and len(node['children']) != 1):
                diagnostics.append(diagnostic('GROUP_ARITY', 'syntax', cell, node['span'], 'Group is empty or NOT does not have exactly one child.'))
            if node['name'] is not None:
                diagnostics.append(diagnostic('NAMED_BLOCK_MEMBERSHIP_UNCONFIRMED', 'semantic', cell, node['span'], 'Confirm segment membership, overlapping segments and display behavior.'))
    if len(roots) > 1:
        diagnostics.append(diagnostic('ROOT_COMBINATION_UNCONFIRMED', 'semantic', cell, span('filters_text', 0, len(cell)), 'Multiple exported roots have no explicit combination operator.'))
    if not roots:
        diagnostics.append(diagnostic('EMPTY_SELECTION_UNCONFIRMED', 'semantic', cell, span('filters_text', 0, len(cell)), 'Confirm that empty export means no predicate, rather than missing export data.'))
    return {'roots': roots, 'rootCombination': 'SINGLE' if len(roots) == 1 else None}, diagnostics


def parse_record(raw, sha, row_number, known_labels=frozenset()):
    selection, diagnostics = parse_filters(raw['filters_text'])
    expected_columns = int(raw['columns_count']) if raw['columns_count'].isdigit() else -1
    columns = resolve_columns(raw['column_names'], expected_columns, known_labels)
    group_by = bracket_labels(raw['group_by_names'], 'group_by_names')
    if group_by is None:
        group_by = parse_labels(raw['group_by_names'], 'group_by_names')
        diagnostics.append(diagnostic('GROUP_LABEL_BRACKETS_UNBALANCED', 'semantic', raw['group_by_names'], span('group_by_names', 0, len(raw['group_by_names'])), 'Grouping labels contain unbalanced brackets; dimension boundaries remain unconfirmed.'))
    predicates = [n for n in walk(selection['roots']) if n['kind'] == 'predicate']
    for name, actual in [('filters_count', len(predicates)), ('columns_count', len(columns))]:
        try:
            matches = int(raw[name]) == actual
        except ValueError:
            matches = False
        if not matches:
            diagnostics.append(diagnostic('DECLARED_COUNT_MISMATCH', 'syntax', raw[name], span(name, 0, len(raw[name])), f'Export declares {raw[name]!r}; parser counted {actual}.'))
    if not raw['columns_count'].isdigit() or len(columns) != int(raw['columns_count']):
        diagnostics.append(diagnostic('COLUMN_DELIMITER_AMBIGUITY', 'semantic', raw['column_names'], span('column_names', 0, len(raw['column_names'])), 'Comma-space tokenization disagrees with declared count; tokens are candidate labels, not confirmed fields. Original field IDs or unambiguous export are required.'))
        for entry in columns:
            entry['lexicalStatus'] = 'candidate'
    vitality = {'raw': raw['vitality_filter'], 'value': {'Живые': 'alive', 'Мёртвые': 'dead', 'Все': 'all'}.get(raw['vitality_filter'])}
    diagnostics.append(diagnostic('VITALITY_BINDING_UNCONFIRMED', 'semantic', raw['vitality_filter'], span('vitality_filter', 0, len(raw['vitality_filter'])), 'Source vitality label is preserved; death, disposal and archive mapping requires confirmation.'))
    if vitality['value'] is None:
        diagnostics.append(diagnostic('UNKNOWN_VITALITY', 'syntax', raw['vitality_filter'], span('vitality_filter', 0, len(raw['vitality_filter'])), 'Unknown vitality value.'))
    return {'parserVersion': VERSION, 'source': {'snapshotSha256': sha, 'definitionId': sha + ':' + raw['company_id'] + ':' + raw['list_id'], 'rowNumber': row_number, 'companyId': raw['company_id'], 'listId': raw['list_id']}, 'raw': raw, 'selection': selection, 'columns': columns, 'groupBy': group_by, 'vitality': vitality, 'diagnostics': diagnostics, 'status': {'parsed': not any(d['severity'] == 'syntax' for d in diagnostics), 'semanticResolved': not diagnostics}}


def write_csv(path, rows, headers):
    with path.open('w', encoding='utf-8', newline='') as out:
        writer = csv.DictWriter(out, fieldnames=headers)
        writer.writeheader()
        writer.writerows(rows)


def inventory(source, output):
    sha = hashlib.sha256(source.read_bytes()).hexdigest()
    with source.open(encoding='utf-8-sig', newline='') as handle:
        reader = csv.DictReader(handle)
        if reader.fieldnames != HEADERS:
            raise ValueError('Source CSV headers differ from the 18-column contract')
        raws = list(reader)
    keys = [(r['company_id'], r['list_id']) for r in raws]
    if len(keys) != len(set(keys)):
        raise ValueError('Duplicate company_id + list_id source key')
    if any(None in r or any(v is None for v in r.values()) for r in raws):
        raise ValueError('Malformed source CSV record width')
    known_labels = collections.defaultdict(set)
    for raw in raws:
        parsed, _ = parse_filters(raw['filters_text'])
        for node in walk(parsed['roots']):
            if node['kind'] == 'predicate':
                known_labels[raw['company_id']].add(node['fieldLabel'])
    output.mkdir(parents=True, exist_ok=True)
    mappings, coverage, issues = {}, [], collections.defaultdict(list)
    operators, operands, vitality, run_types, usages = (collections.Counter() for _ in range(5))
    metrics = collections.Counter()
    with (output / 'normalized.jsonl').open('w', encoding='utf-8', newline='\n') as normalized:
        for row_number, raw in enumerate(raws, 1):
            record = parse_record(raw, sha, row_number, known_labels[raw['company_id']])
            normalized.write(dumps(record) + '\n')
            nodes = list(walk(record['selection']['roots']))
            predicates = [n for n in nodes if n['kind'] == 'predicate']
            occurrences = [('filter', n['fieldLabel'], n['fieldSpan']) for n in predicates]
            occurrences += [('column', n['label'], n['span']) for n in record['columns']]
            occurrences += [('group', n['label'], n['span']) for n in record['groupBy']]
            for usage, label, at in occurrences:
                key = raw['company_id'], label
                if key not in mappings:
                    mappings[key] = {'company_id': raw['company_id'], 'source_label': label, 'filter_count': 0, 'column_count': 0, 'group_count': 0, 'list_ids': set(), 'occurrences': []}
                m = mappings[key]
                m[usage + '_count'] += 1
                m['list_ids'].add(raw['list_id'])
                m['occurrences'].append({'listId': raw['list_id'], 'usage': usage, **at})
                usages[usage] += 1
            for n in predicates:
                operators[n['operator']] += 1
                operands[n['operand']['kind']] += 1
            codes = sorted({d['code'] for d in record['diagnostics']})
            for code in codes:
                issues[code].append({'companyId': raw['company_id'], 'listId': raw['list_id'], 'spans': [d['span'] for d in record['diagnostics'] if d['code'] == code]})
            vitality[raw['vitality_filter']] += 1
            run_types[raw['run_type']] += 1
            def depth(ns):
                return max((1 + depth(n.get('children', [])) for n in ns), default=0)
            d = depth(record['selection']['roots'])
            metrics['maxDepth'] = max(metrics['maxDepth'], d)
            metrics['maxPredicates'] = max(metrics['maxPredicates'], len(predicates))
            metrics['maxColumns'] = max(metrics['maxColumns'], len(record['columns']))
            metrics['maxGroupDimensions'] = max(metrics['maxGroupDimensions'], len(record['groupBy']))
            metrics['maxRoots'] = max(metrics['maxRoots'], len(record['selection']['roots']))
            metrics['emptyFilters'] += not nodes
            metrics['multipleRoots'] += len(record['selection']['roots']) > 1
            metrics['namedBlocks'] += sum(n['kind'] == 'group' and n['name'] is not None for n in nodes)
            metrics['parsedRecords'] += record['status']['parsed']
            metrics['columnRecordsResolvedFromSourceEvidence'] += len(record['columns']) != len(parse_labels(raw['column_names'], 'column_names'))
            metrics['groupRecordsResolvedFromBrackets'] += record['groupBy'] != parse_labels(raw['group_by_names'], 'group_by_names')
            coverage.append({'snapshot_sha256': sha, 'parser_version': VERSION, 'row_number': row_number, 'company_id': raw['company_id'], 'list_id': raw['list_id'], 'imported': 'unverified', 'source_inventoried': 'true', 'parsed': str(record['status']['parsed']).lower(), 'semantic_resolved': 'false', 'fields_mapped': 'unverified', 'data_prepared': 'unverified', 'query_verified': 'unverified', 'display_verified': 'unverified', 'predicate_count': len(predicates), 'root_count': len(record['selection']['roots']), 'depth': d, 'column_count': len(record['columns']), 'group_count': len(record['groupBy']), 'fields': dumps(sorted({label for _, label, _ in occurrences})), 'operators': dumps(sorted({n['operator'] for n in predicates})), 'blocking_codes': dumps(codes + ['FIELD_DEFINITIONS_UNCONFIRMED', 'BINDING_NOT_VERIFIED', 'DATA_NOT_VERIFIED', 'QUERY_NOT_VERIFIED', 'DISPLAY_NOT_VERIFIED']), 'source_record': f'normalized.jsonl:{row_number}', 'verification_reference': ''})
    map_rows = []
    for key, value in sorted(mappings.items()):
        map_rows.append({**value, 'list_ids': dumps(sorted(value['list_ids'], key=int)), 'occurrences': dumps(value['occurrences']), 'canonical_code': '', 'definition': '', 'value_type': '', 'unit': '', 'time_scope': '', 'aliases': '[]', 'value_source': '', 'status': 'unresolved', 'lexical_status': 'candidate_when_referenced_record_has_COLUMN_DELIMITER_AMBIGUITY', 'question': 'Confirm original field identity, type, unit, temporal scope and source before binding; equal labels across companies are not an identity proof.'})
    write_csv(output / 'field-mapping.csv', map_rows, list(map_rows[0]) if map_rows else ['company_id', 'source_label'])
    write_csv(output / 'coverage.csv', coverage, list(coverage[0]) if coverage else ['company_id', 'list_id'])
    (output / 'semantic-issues.json').write_text(dumps(dict(sorted(issues.items()))) + '\n', encoding='utf-8')
    manifest = {'formatVersion': 1, 'parserVersion': VERSION, 'source': 'data/lists.csv', 'sha256': sha, 'expectedSha256': EXPECTED_SHA, 'checksumMatchesExpected': sha == EXPECTED_SHA, 'recordCount': len(raws), 'uniqueKeyCount': len(set(keys)), 'companyCount': len({r['company_id'] for r in raws}), 'sourceColumns': HEADERS, 'sourceBytes': source.stat().st_size, 'maxValueListLength': None, 'valueListLengthNote': 'No list-valued comparison grammar occurs in this snapshot; bare operand punctuation is not assumed to delimit values.', 'contradictionAnalysis': 'not_performed_requires_field_types_root_combination_and_null_policy', 'spanConvention': 'zero-based Unicode code-point offsets, end exclusive, in the original CSV-decoded cell; rowNumber is one-based record index excluding header', 'operators': dict(sorted(operators.items())), 'operandKinds': dict(sorted(operands.items())), 'runTypes': dict(sorted(run_types.items())), 'vitality': dict(sorted(vitality.items())), 'fieldOccurrences': dict(usages), 'companyScopedFieldLabels': len(mappings), 'distinctExactFieldLabels': len({key[1] for key in mappings}), 'metrics': dict(metrics), 'diagnosticRecordCounts': {code: len(refs) for code, refs in sorted(issues.items())}, 'status': {'importedIntoProductDatabase': 'unverified', 'semanticResolvedRecords': 0, 'queryVerifiedRecords': 0, 'displayVerifiedRecords': 0}, 'artifacts': {name: {'sha256': hashlib.sha256((output / name).read_bytes()).hexdigest()} for name in ['normalized.jsonl', 'coverage.csv', 'field-mapping.csv', 'semantic-issues.json']}}
    (output / 'source-manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2, sort_keys=True) + '\n', encoding='utf-8')
    print(dumps({k: manifest[k] for k in ['recordCount', 'checksumMatchesExpected', 'companyScopedFieldLabels', 'distinctExactFieldLabels', 'metrics', 'diagnosticRecordCounts']}))
    return manifest


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, default=ROOT / 'data/lists.csv')
    parser.add_argument('--output', type=Path, default=ROOT / 'rules')
    args = parser.parse_args()
    inventory(args.source, args.output)
