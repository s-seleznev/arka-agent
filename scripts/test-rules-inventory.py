#!/usr/bin/env python3
"""Independent source fidelity checks and boundary parser fixtures."""
import csv
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('rules_inventory', Path(__file__).with_name('rules-inventory.py'))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


class ParserTests(unittest.TestCase):
    def test_line_endings_and_source_spans(self):
        for separator in ['\\n', '\n', '\r\n', '\\r\\n']:
            text = '(AND)' + separator + '  • Возраст ≥ 3.0000000000000001'
            selection, errors = m.parse_filters(text)
            root = selection['roots'][0]
            self.assertEqual(root['operator'], 'AND')
            leaf = root['children'][0]
            self.assertEqual(leaf['operand']['value'], '3.0000000000000001')
            self.assertEqual(text[leaf['span']['start']:leaf['span']['end']], '• Возраст ≥ 3.0000000000000001')
            self.assertEqual(text[leaf['fieldSpan']['start']:leaf['fieldSpan']['end']], 'Возраст')
            self.assertFalse(errors)

    def test_nested_not_and_multiple_roots(self):
        text = '[A] (AND)\\n  (NOT)\\n    (OR)\\n      • X = 1\\n      • X = 2\\n[B] (OR)\\n  • X = 3'
        result, errors = m.parse_filters(text)
        self.assertIsNone(result['rootCombination'])
        self.assertEqual(len(result['roots']), 2)
        self.assertEqual(result['roots'][0]['children'][0]['operator'], 'NOT')
        self.assertIn('ROOT_COMBINATION_UNCONFIRMED', [d['code'] for d in errors])
        self.assertFalse(any(d['severity'] == 'syntax' for d in errors))

    def test_ambiguous_operands_stay_ambiguous(self):
        for raw in ['Дата С', 'Дата осеменения', 'DATE_MINUS_DAYS_0', 'Стельная', 'NULL', 'false', 'a,b', '1;2', 'Сегодня - 365']:
            self.assertEqual(m.operand(raw)['kind'], 'unresolved')
        self.assertEqual(m.operand('0E-16')['value'], '0E-16')
        self.assertEqual(m.operand('Сегодня - 7 дней')['offsetDays'], -7)
        self.assertEqual(m.operand('2024-02-29')['kind'], 'date')
        self.assertEqual(m.operand('2023-02-29')['kind'], 'unresolved')

    def test_unknown_and_missing_fragments_block(self):
        for text, code in [('• X = ', 'MISSING_OPERAND'), ('(NOT)\\n  • X = 1\\n  • X = 2', 'GROUP_ARITY'), ('• X = 1\\n  • Y = 2', 'INDENT_AFTER_LEAF'), ('malformed', 'UNRECOGNIZED_LINE'), ('• X NOT_NULL value', 'UNEXPECTED_NULL_OPERAND')]:
            result, errors = m.parse_filters(text)
            self.assertIn(code, [d['code'] for d in errors])
            for d in errors:
                self.assertEqual(d['raw'], text[d['span']['start']:d['span']['end']])

    def test_column_labels_require_unique_source_evidence(self):
        text = 'Возраст в месяцах, целое, Номер'
        labels = m.resolve_columns(text, 2, {'Возраст в месяцах, целое'})
        self.assertEqual([item['label'] for item in labels], ['Возраст в месяцах, целое', 'Номер'])
        for item in labels:
            self.assertEqual(text[item['span']['start']:item['span']['end']], item['label'])
        # A field seen only in another company is not supplied to this resolver.
        self.assertEqual(len(m.resolve_columns(text, 2, set())), 3)
        # Two possible partitions are not a license to pick either one.
        self.assertEqual(len(m.resolve_columns('A, B, C', 2, {'A, B', 'B, C'})), 3)
        self.assertEqual(len(m.resolve_columns('A, B, C', 3, {'A, B'})), 3)

    def test_balanced_brackets_preserve_label_and_group_dimension(self):
        text = 'Возраст (Год, Месяц), Номер животного'
        columns = m.resolve_columns(text, 2, set())
        self.assertEqual([item['label'] for item in columns], ['Возраст (Год, Месяц)', 'Номер животного'])
        self.assertEqual(len(m.bracket_labels('Возраст (Год, Месяц)', 'group_by_names')), 1)
        self.assertIsNone(m.bracket_labels('Возраст (Год, Месяц', 'group_by_names'))

    def test_source_fidelity_and_full_coverage(self):
        source = m.ROOT / 'data/lists.csv'
        with source.open(encoding='utf-8-sig', newline='') as handle:
            rows = list(csv.DictReader(handle))
        with tempfile.TemporaryDirectory() as tmp:
            output = Path(tmp)
            manifest = m.inventory(source, output)
            self.assertEqual(manifest['recordCount'], 6735)
            self.assertTrue(manifest['checksumMatchesExpected'])
            self.assertEqual(manifest['metrics']['columnRecordsResolvedFromSourceEvidence'], 75)
            self.assertEqual(manifest['metrics']['parsedRecords'], 6702)
            self.assertEqual(manifest['metrics']['maxGroupDimensions'], 1)
            normalized = [json.loads(line) for line in (output / 'normalized.jsonl').read_text().splitlines()]
            self.assertEqual(len(normalized), len(rows))
            for original, record in zip(rows, normalized):
                self.assertEqual(record['raw'], original)
                self.assertEqual(len(record['raw']), 18)
                predicate_count = sum(n['kind'] == 'predicate' for n in m.walk(record['selection']['roots']))
                # Independent evidence: source bullet count and export count both match.
                self.assertEqual(predicate_count, original['filters_text'].count('•'))
                self.assertEqual(predicate_count, int(original['filters_count']))
                for n in m.walk(record['selection']['roots']):
                    at = n['span']
                    self.assertTrue(original[at['column']][at['start']:at['end']].strip())
                for label in record['columns'] + record['groupBy']:
                    at = label['span']
                    self.assertEqual(label['label'], original[at['column']][at['start']:at['end']])
                for d in record['diagnostics']:
                    at = d['span']
                    self.assertEqual(d['raw'], original[at['column']][at['start']:at['end']])
            rule = next(r for r in normalized if r['source']['companyId'] == '20' and r['source']['listId'] == '541')
            root = rule['selection']['roots'][0]
            self.assertEqual(root['operator'], 'OR')
            self.assertEqual(len(root['children']), 2)
            first, second = root['children']
            self.assertEqual(first['children'][0]['operand']['value'], '36')
            self.assertEqual([n['operand']['value'] for n in second['children'][:2]], ['42', '48'])
            self.assertEqual(rule['vitality']['value'], 'alive')
            before = {p.name: p.read_bytes() for p in output.iterdir()}
            m.inventory(source, output)
            self.assertEqual(before, {p.name: p.read_bytes() for p in output.iterdir()})


if __name__ == '__main__':
    unittest.main()
