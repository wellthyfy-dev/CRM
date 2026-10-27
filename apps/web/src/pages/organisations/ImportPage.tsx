import * as React from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  IMPORT_FIELD_LABELS,
  IMPORT_FIELDS,
  SEGMENT_LABELS,
  STAGE_LABELS,
  type ImportField,
  type TransformedRow,
} from '@wellthyfy/shared';
import { PageHeader } from '@/components/layout/AppShell';
import { ErrorMessage } from '@/components/common';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { api, apiUpload } from '@/lib/api';

interface Parsed {
  sheetName: string;
  headers: string[];
  rows: Record<string, unknown>[];
  preview: Record<string, unknown>[];
  totalRows: number;
  suggestedMapping: Partial<Record<ImportField, string>>;
}

interface CommitResult {
  created: number;
  updated: number;
  skipped: number;
  results: {
    row: number;
    status: 'created' | 'updated' | 'skipped';
    reason?: string;
    organisationId?: string;
    recordId?: string;
    name?: string;
    warnings: string[];
  }[];
}

export function ImportPage() {
  const qc = useQueryClient();
  const [parsed, setParsed] = React.useState<Parsed | null>(null);
  const [mapping, setMapping] = React.useState<Partial<Record<ImportField, string>>>({});
  const [updateExisting, setUpdateExisting] = React.useState(true);
  const [interpreted, setInterpreted] = React.useState<TransformedRow[] | null>(null);
  const [result, setResult] = React.useState<CommitResult | null>(null);

  const parse = useMutation({
    mutationFn: (file: File) => apiUpload<Parsed>('/api/import/parse', file),
    onSuccess: (p) => {
      setParsed(p);
      setMapping(p.suggestedMapping);
      setInterpreted(null);
      setResult(null);
    },
  });
  const preview = useMutation({
    mutationFn: () => api<TransformedRow[]>('/api/import/preview', { body: { rows: parsed!.rows, mapping } }),
    onSuccess: setInterpreted,
  });
  const commit = useMutation({
    mutationFn: () =>
      api<CommitResult>('/api/import/commit', { body: { rows: parsed!.rows, mapping, updateExisting } }),
    onSuccess: (r) => {
      setResult(r);
      void qc.invalidateQueries({ queryKey: ['organisations'] });
    },
  });

  return (
    <div className="grid gap-4">
      <PageHeader
        title="Import organisations"
        description="Upload the Wellthyfy Outreach CRM workbook (.xlsx) or a .csv. SAMPLE- rows are skipped."
      />
      <Card>
        <CardHeader>
          <CardTitle>1. Upload</CardTitle>
        </CardHeader>
        <CardContent>
          <Input
            type="file"
            accept=".xlsx,.csv"
            aria-label="Spreadsheet file"
            onChange={(e) => e.target.files?.[0] && parse.mutate(e.target.files[0])}
          />
          <ErrorMessage error={parse.error} />
          {parsed && (
            <p className="mt-2 text-sm text-muted-foreground" data-testid="import-summary">
              Sheet “{parsed.sheetName}”: {parsed.totalRows} rows, {parsed.headers.length} columns.
            </p>
          )}
        </CardContent>
      </Card>

      {parsed && (
        <Card>
          <CardHeader>
            <CardTitle>2. Preview (first 20 rows)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="max-h-72 overflow-auto">
              <Table>
                <THead>
                  <TR>
                    {parsed.headers.map((h) => (
                      <TH key={h} className="whitespace-nowrap">
                        {h}
                      </TH>
                    ))}
                  </TR>
                </THead>
                <TBody>
                  {parsed.preview.map((row, i) => (
                    <TR key={i}>
                      {parsed.headers.map((h) => (
                        <TD key={h} className="max-w-48 truncate text-xs">
                          {String(row[h] ?? '')}
                        </TD>
                      ))}
                    </TR>
                  ))}
                </TBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {parsed && (
        <Card>
          <CardHeader>
            <CardTitle>3. Map columns</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
              {IMPORT_FIELDS.map((f) => (
                <label key={f} className="grid grid-cols-[180px_1fr] items-center gap-2 text-sm">
                  <span>{IMPORT_FIELD_LABELS[f]}</span>
                  <Select
                    aria-label={`Map ${IMPORT_FIELD_LABELS[f]}`}
                    value={mapping[f] ?? ''}
                    onChange={(e) => setMapping((m) => ({ ...m, [f]: e.target.value || undefined }))}
                  >
                    <option value="">— not imported —</option>
                    {parsed.headers.map((h) => (
                      <option key={h} value={h}>
                        {h}
                      </option>
                    ))}
                  </Select>
                </label>
              ))}
            </div>
            <label className="mt-3 flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={updateExisting}
                onChange={(e) => setUpdateExisting(e.target.checked)}
              />
              Update existing organisations matched by domain or record ID (otherwise skip them)
            </label>
            <div className="mt-3 flex gap-2">
              <Button
                variant="outline"
                onClick={() => preview.mutate()}
                disabled={!mapping.name || !mapping.orgType}
              >
                Check interpretation
              </Button>
              <Button
                onClick={() => commit.mutate()}
                disabled={commit.isPending || !mapping.name || !mapping.orgType}
              >
                {commit.isPending ? 'Importing…' : `Import ${parsed.totalRows} rows`}
              </Button>
            </div>
            <ErrorMessage error={preview.error ?? commit.error} />
          </CardContent>
        </Card>
      )}

      {interpreted && (
        <Card>
          <CardHeader>
            <CardTitle>How rows will be imported</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <THead>
                <TR>
                  <TH>Row</TH>
                  <TH>Organisation</TH>
                  <TH>Type / segment</TH>
                  <TH>Stage</TH>
                  <TH>Contact</TH>
                  <TH>Notes</TH>
                </TR>
              </THead>
              <TBody>
                {interpreted.map((t) => (
                  <TR key={t.rowNumber}>
                    <TD>{t.rowNumber}</TD>
                    <TD>{t.organisation.name}</TD>
                    <TD className="text-xs">{t.skip ? '—' : SEGMENT_LABELS[t.organisation.segment]}</TD>
                    <TD className="text-xs">{t.skip ? '—' : STAGE_LABELS[t.organisation.stage]}</TD>
                    <TD className="text-xs">
                      {t.contact?.email} {t.contact?.verified && <Badge variant="success">verified</Badge>}{' '}
                      {t.contact?.optOut && <Badge variant="danger">opt-out</Badge>}
                    </TD>
                    <TD className="text-xs">
                      {t.skip ? <Badge variant="warning">skip: {t.skip}</Badge> : t.warnings.join('; ')}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {result && (
        <Card>
          <CardHeader>
            <CardTitle>Import report</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="mb-3 flex gap-3 text-sm" data-testid="import-report">
              <Badge variant="success">Created: {result.created}</Badge>
              <Badge variant="info">Updated: {result.updated}</Badge>
              <Badge variant="warning">Skipped: {result.skipped}</Badge>
            </div>
            <Table>
              <THead>
                <TR>
                  <TH>Row</TH>
                  <TH>Organisation</TH>
                  <TH>Result</TH>
                  <TH>Reason / warnings</TH>
                </TR>
              </THead>
              <TBody>
                {result.results.map((r) => (
                  <TR key={r.row}>
                    <TD>{r.row}</TD>
                    <TD>
                      {r.organisationId ? (
                        <Link
                          className="text-primary hover:underline"
                          to={`/organisations/${r.organisationId}`}
                        >
                          {r.recordId ?? ''} {r.name}
                        </Link>
                      ) : (
                        r.name
                      )}
                    </TD>
                    <TD>{r.status}</TD>
                    <TD className="text-xs">{[r.reason, ...r.warnings].filter(Boolean).join('; ')}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
