import type {
  Activity,
  Contact,
  Email,
  Organisation,
  Profile,
  Programme,
  Reply,
  Research,
  Settings,
  Template,
} from '@wellthyfy/shared/db/schema';
import type { GateResult, Stage } from '@wellthyfy/shared';

/** JSON over the wire: Date fields arrive as ISO strings. */
export type Json<T> = T extends Date
  ? string
  : T extends (infer U)[]
    ? Json<U>[]
    : T extends object
      ? { [K in keyof T]: Json<T[K]> }
      : T;

export type OrganisationJ = Json<Organisation>;
export type ContactJ = Json<Contact>;
export type EmailJ = Json<Email>;
export type ResearchJ = Json<Research> & { createdByName?: string | null; programmeName?: string | null };
export type ProgrammeJ = Json<Programme>;
export type TemplateJ = Json<Template>;
export type ProfileJ = Json<Profile>;
export type ReplyJ = Json<Reply>;
export type SettingsJ = Json<Settings> & { effectiveOptOutLine: string };
export type ActivityJ = Json<Activity> & { userName?: string | null };

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface PrimaryContact {
  id?: string;
  fullName: string;
  email: string | null;
  designation: string | null;
  verified?: boolean;
  optOut?: boolean;
}

export type OrganisationRow = OrganisationJ & {
  ownerName: string | null;
  primaryContact: PrimaryContact | null;
  lastActivityAt: string | null;
};

export interface OrganisationDetail {
  organisation: OrganisationJ;
  owner: { id: string; fullName: string } | null;
  contacts: ContactJ[];
  research: ResearchJ | null;
}

export interface EmailRow {
  id: string;
  status: EmailJ['status'];
  kind: EmailJ['kind'];
  followUpNo: number;
  subject: string;
  organisationId: string;
  organisationName: string;
  recordId: string;
  contactId: string | null;
  contactName: string | null;
  contactEmail: string | null;
  approvedAt: string | null;
  sentAt: string | null;
  scheduledFor: string | null;
  gateFailureReason: string | null;
  rejectionReason: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface EmailDetail {
  email: EmailJ;
  organisation: OrganisationJ;
  contact: ContactJ | null;
  template: { key: string; name: string } | null;
  research: ResearchJ | null;
  gate: GateResult | null;
  thread: { id: string; kind: string; status: string; subject: string; sentAt: string | null }[];
  warnings: string[];
}

export interface ApprovalItem {
  email: EmailJ;
  contact: ContactJ | null;
  organisation: OrganisationJ;
  research: (ResearchJ & { programmeName: string | null }) | null;
  submittedByName: string | null;
  warnings: string[];
}

export interface PipelineCard {
  id: string;
  recordId: string;
  name: string;
  segment: OrganisationJ['segment'];
  orgType: OrganisationJ['orgType'];
  city: string | null;
  stage: Stage;
  nextFollowUpAt: string | null;
  doNotContact: boolean;
  primaryContact: PrimaryContact | null;
  lastActivity: { type: string; createdAt: string } | null;
}
