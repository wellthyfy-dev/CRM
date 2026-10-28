import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, XCircle } from 'lucide-react';
import { WEEKDAYS, type Weekday } from '@wellthyfy/shared';
import { PageHeader } from '@/components/layout/AppShell';
import { ErrorMessage } from '@/components/common';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Select, Textarea } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { useToast } from '@/components/ui/toast';
import { api } from '@/lib/api';
import type { SettingsJ } from '@/lib/types';

export interface SettingsResponse {
  settings: SettingsJ;
  integrations: Record<string, boolean | string | null>;
  aiModels: { default: string; optional: string };
}

export function useSettings() {
  return useQuery({ queryKey: ['settings'], queryFn: () => api<SettingsResponse>('/api/settings') });
}

function PassFail({ label, value }: { label: string; value: 'pass' | 'fail' | undefined }) {
  if (!value) return null;
  return (
    <span className="flex items-center gap-1 text-sm">
      {value === 'pass' ? (
        <CheckCircle2 className="h-4 w-4 text-emerald-600" />
      ) : (
        <XCircle className="h-4 w-4 text-red-600" />
      )}
      {label}: {value}
    </span>
  );
}

export function SettingsPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const { data } = useSettings();
  const [form, setForm] = React.useState<Record<string, unknown> | null>(null);
  React.useEffect(() => {
    if (data && !form) {
      const s = data.settings;
      setForm({
        dailySendCap: s.dailySendCap,
        hourlySendCap: s.hourlySendCap,
        sendWindowStart: s.sendWindowStart,
        sendWindowEnd: s.sendWindowEnd,
        sendDays: s.sendDays,
        followUp1Days: s.followUp1Days,
        followUp2Days: s.followUp2Days,
        aiModel: s.aiModel ?? data.aiModels.default,
        aiMonthlyLimitInr: s.aiMonthlyLimitInr,
        searchMonthlyLimit: s.searchMonthlyLimit,
        signature: s.signature,
        optOutLine: s.optOutLine,
        privacyNoticeUrl: s.privacyNoticeUrl ?? '',
      });
    }
  }, [data, form]);
  const save = useMutation({
    mutationFn: () => api('/api/settings', { method: 'PATCH', body: form }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['settings'] });
      toast('Settings saved');
    },
  });
  const test = useMutation({
    mutationFn: () =>
      api<{
        imap: 'pass' | 'fail';
        smtp: 'pass' | 'fail';
        folders?: number;
        draftsFolder?: boolean;
        sentFolder?: boolean;
      }>('/api/settings/test-titan', { body: {} }),
  });
  if (!data || !form) return <p className="text-sm text-muted-foreground">Loading…</p>;
  const num = (k: string) => ({
    type: 'number',
    value: String(form[k] ?? ''),
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: Number(e.target.value) }),
  });
  const str = (k: string) => ({
    value: String(form[k] ?? ''),
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      setForm({ ...form, [k]: e.target.value }),
  });
  const days = form.sendDays as Weekday[];
  const integ = data.integrations;

  return (
    <div className="grid gap-4">
      <PageHeader title="Settings" />
      <Card>
        <CardHeader>
          <CardTitle>Integrations</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3">
          <div className="flex flex-wrap gap-2 text-xs">
            <Badge variant={integ.emailMode === 'live' ? 'danger' : 'secondary'}>
              EMAIL_MODE: {String(integ.emailMode)}
            </Badge>
            {(['titan', 'zerobounce', 'ai', 'serper', 'resend', 'storage', 'sentry'] as const).map((k) => (
              <Badge key={k} variant={integ[k] ? 'success' : 'outline'}>
                {k === 'ai' ? `ai (${String(integ.aiProvider)})` : k}: {integ[k] ? 'configured' : 'not set'}
              </Badge>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="outline" onClick={() => test.mutate()} disabled={test.isPending}>
              {test.isPending ? 'Testing…' : 'Test Titan connection'}
            </Button>
            {integ.titanUser && (
              <span className="text-xs text-muted-foreground">Mailbox: {String(integ.titanUser)}</span>
            )}
            <PassFail label="IMAP" value={test.data?.imap} />
            <PassFail label="SMTP" value={test.data?.smtp} />
            {test.data?.folders !== undefined && (
              <span className="text-xs text-muted-foreground">
                {test.data.folders} folders · Drafts {test.data.draftsFolder ? '✓' : '✗'} · Sent{' '}
                {test.data.sentFolder ? '✓' : '✗'}
              </span>
            )}
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Sending</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-4">
          <Field label="Daily send cap">
            <Input min={0} {...num('dailySendCap')} />
          </Field>
          <Field label="Hourly send cap">
            <Input min={0} {...num('hourlySendCap')} />
          </Field>
          <Field label="Window start (IST)">
            <Input type="time" {...str('sendWindowStart')} />
          </Field>
          <Field label="Window end (IST)">
            <Input type="time" {...str('sendWindowEnd')} />
          </Field>
          <div className="md:col-span-4">
            <div className="mb-1 text-sm font-medium">Send days</div>
            <div className="flex flex-wrap gap-2">
              {WEEKDAYS.map((d) => (
                <label key={d} className="flex items-center gap-1 rounded border px-2 py-1 text-sm">
                  <input
                    type="checkbox"
                    checked={days.includes(d)}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        sendDays: e.target.checked ? [...days, d] : days.filter((x) => x !== d),
                      })
                    }
                  />
                  {d}
                </label>
              ))}
            </div>
          </div>
          <Field label="Follow-up 1 after (days)">
            <Input min={1} {...num('followUp1Days')} />
          </Field>
          <Field label="Follow-up 2 after (days)">
            <Input min={2} {...num('followUp2Days')} />
          </Field>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>AI and search</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-3">
          <Field label="AI model">
            <Select {...str('aiModel')}>
              <option value={data.aiModels.default}>{data.aiModels.default} (default)</option>
              <option value={data.aiModels.optional}>{data.aiModels.optional}</option>
            </Select>
          </Field>
          <Field label="AI monthly limit (₹)">
            <Input min={0} {...num('aiMonthlyLimitInr')} />
          </Field>
          <Field label="Searches per month">
            <Input min={0} {...num('searchMonthlyLimit')} />
          </Field>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Signature and opt-out</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3">
          <Field label="Signature ({{signature}})">
            <Textarea className="min-h-[110px]" {...str('signature')} />
          </Field>
          <Field label="Opt-out line" hint="Appended to every outreach email">
            <Input {...str('optOutLine')} />
          </Field>
          <Field label="Privacy notice URL" hint="If set, it is added to the opt-out line">
            <Input type="url" placeholder="https://wellthyfy.in/privacy" {...str('privacyNoticeUrl')} />
          </Field>
          <p className="text-xs text-muted-foreground">
            Effective opt-out line: {data.settings.effectiveOptOutLine}
          </p>
        </CardContent>
      </Card>
      <ErrorMessage error={save.error} />
      <div className="flex justify-end">
        <Button onClick={() => save.mutate()} disabled={save.isPending}>
          Save settings
        </Button>
      </div>
    </div>
  );
}
