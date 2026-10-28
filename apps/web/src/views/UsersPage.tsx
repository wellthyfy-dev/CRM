import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { UserPlus } from 'lucide-react';
import { ROLES, type Role } from '@wellthyfy/shared';
import { PageHeader } from '@/components/layout/AppShell';
import { ErrorMessage, IstDate } from '@/components/common';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Input, Select } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { useToast } from '@/components/ui/toast';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { ProfileJ } from '@/lib/types';

export function UsersPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const { me } = useAuth();
  const [inviting, setInviting] = React.useState(false);
  const [form, setForm] = React.useState({ email: '', fullName: '', role: 'researcher' as Role });
  const users = useQuery({ queryKey: ['users'], queryFn: () => api<ProfileJ[]>('/api/users') });
  const invite = useMutation({
    mutationFn: () => api('/api/users/invite', { body: form }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['users'] });
      toast(`Invitation sent to ${form.email}`);
      setInviting(false);
      setForm({ email: '', fullName: '', role: 'researcher' });
    },
  });
  const update = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Partial<{ role: Role; active: boolean }> }) =>
      api(`/api/users/${id}`, { method: 'PATCH', body }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['users'] });
      toast('User updated');
    },
    onError: (e) => toast((e as Error).message, 'error'),
  });
  return (
    <div>
      <PageHeader
        title="Users"
        description="Invite-only access. Admin: everything. Researcher: research and drafts. Viewer: read-only."
        actions={
          <Button onClick={() => setInviting(true)}>
            <UserPlus /> Invite user
          </Button>
        }
      />
      <Table>
        <THead>
          <TR>
            <TH>Name</TH>
            <TH>Email</TH>
            <TH>Role</TH>
            <TH>Status</TH>
            <TH>Since</TH>
            <TH />
          </TR>
        </THead>
        <TBody>
          {users.data?.map((u) => (
            <TR key={u.id}>
              <TD className="font-medium">{u.fullName}</TD>
              <TD className="text-xs">{u.email}</TD>
              <TD>
                <Select
                  className="w-36"
                  aria-label={`Role for ${u.fullName}`}
                  value={u.role}
                  disabled={u.id === me?.id}
                  onChange={(e) => update.mutate({ id: u.id, body: { role: e.target.value as Role } })}
                >
                  {ROLES.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </Select>
              </TD>
              <TD>
                {u.active ? (
                  <Badge variant="success">active</Badge>
                ) : (
                  <Badge variant="danger">deactivated</Badge>
                )}
              </TD>
              <TD className="text-xs">
                <IstDate value={u.createdAt} time={false} />
              </TD>
              <TD className="text-right">
                {u.id !== me?.id && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => update.mutate({ id: u.id, body: { active: !u.active } })}
                  >
                    {u.active ? 'Deactivate' : 'Reactivate'}
                  </Button>
                )}
              </TD>
            </TR>
          ))}
        </TBody>
      </Table>
      <Dialog open={inviting} onOpenChange={setInviting}>
        <DialogContent
          title="Invite user"
          description="They receive a Supabase invitation email to set a password."
        >
          <div className="grid gap-3">
            <Field label="Full name">
              <Input value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} />
            </Field>
            <Field label="Email">
              <Input
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </Field>
            <Field label="Role">
              <Select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </Select>
            </Field>
            <ErrorMessage error={invite.error} />
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setInviting(false)}>
                Cancel
              </Button>
              <Button
                onClick={() => invite.mutate()}
                disabled={invite.isPending || !form.email || !form.fullName}
              >
                Send invite
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
