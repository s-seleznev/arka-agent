ALTER TABLE "ReportView" ALTER COLUMN "schemaVersion" SET DEFAULT 4;
--> statement-breakpoint
-- v4 keeps the outer grouping from v3 and removes deeper grouping levels.
-- Revision changes invalidate cursors and stale clients built from the old tree.
UPDATE "ReportView"
SET
	"columns" = (
		SELECT COALESCE(jsonb_agg(candidate.value ORDER BY candidate.position), '[]'::jsonb)
		FROM (
			SELECT combined.value, combined.position
			FROM (
				SELECT column_value AS value, column_position AS position
				FROM jsonb_array_elements("ReportView"."columns") WITH ORDINALITY AS existing(column_value, column_position)
				UNION ALL
				SELECT to_jsonb(group_rule ->> 'field'), 1000 + group_position
				FROM jsonb_array_elements("ReportView"."groupBy") WITH ORDINALITY AS discarded(group_rule, group_position)
				WHERE group_position > 1
					AND jsonb_typeof(group_rule) = 'object'
					AND group_rule ? 'field'
					AND NOT ("ReportView"."columns" ? (group_rule ->> 'field'))
			) AS combined
			ORDER BY combined.position
			LIMIT 30
		) AS candidate
	),
	"groupBy" = CASE
		WHEN jsonb_typeof("groupBy") = 'array' AND jsonb_array_length("groupBy") > 0
			THEN jsonb_build_array("groupBy" -> 0)
		ELSE '[]'::jsonb
	END,
	"revision" = "revision" + 1,
	"schemaVersion" = CASE
		WHEN "schemaVersion" = 3 THEN 4
		ELSE "schemaVersion"
	END,
	"updatedAt" = now()
WHERE
	"schemaVersion" = 3
	OR (
		jsonb_typeof("groupBy") = 'array'
		AND jsonb_array_length("groupBy") > 1
	);
