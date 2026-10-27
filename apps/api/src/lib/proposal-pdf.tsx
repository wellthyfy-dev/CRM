import { Document, Page, StyleSheet, Text, View, renderToBuffer } from '@react-pdf/renderer';
import { formatIst, SENDER } from '@wellthyfy/shared';

export interface ProposalPdfInput {
  proposalNo: string;
  date: Date;
  organisation: { name: string; city?: string | null; state?: string | null };
  contact?: { fullName: string; designation?: string | null } | null;
  programme: { name: string; modules: string[] };
  duration: string;
  valueInr: number;
  notes?: string | null;
  trainingNeed?: string | null;
}

const teal = '#0f766e';
const s = StyleSheet.create({
  page: { padding: 40, fontSize: 10.5, fontFamily: 'Helvetica', color: '#1f2937', lineHeight: 1.45 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 18,
    borderBottom: `2pt solid ${teal}`,
    paddingBottom: 12,
  },
  logo: {
    width: 44,
    height: 44,
    backgroundColor: teal,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  logoText: { color: 'white', fontSize: 22, fontFamily: 'Helvetica-Bold' },
  company: { fontSize: 14, fontFamily: 'Helvetica-Bold', color: teal },
  tagline: { fontSize: 9, color: '#6b7280', marginTop: 2 },
  title: { fontSize: 18, fontFamily: 'Helvetica-Bold', marginBottom: 4 },
  meta: { fontSize: 9, color: '#6b7280', marginBottom: 16 },
  h2: { fontSize: 12, fontFamily: 'Helvetica-Bold', color: teal, marginTop: 14, marginBottom: 6 },
  bullet: { flexDirection: 'row', marginBottom: 3 },
  dot: { width: 12 },
  table: { borderTop: '1pt solid #e5e7eb', marginTop: 4 },
  row: { flexDirection: 'row', borderBottom: '1pt solid #e5e7eb', paddingVertical: 5 },
  cellLabel: { width: 150, color: '#6b7280' },
  cellValue: { flex: 1 },
  footer: {
    position: 'absolute',
    bottom: 28,
    left: 40,
    right: 40,
    fontSize: 8.5,
    color: '#6b7280',
    borderTop: '1pt solid #e5e7eb',
    paddingTop: 6,
    textAlign: 'center',
  },
});

const inr = (n: number) => `INR ${n.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;

function ProposalDocument({ p }: { p: ProposalPdfInput }) {
  return (
    <Document
      title={`Training proposal — ${p.organisation.name}`}
      author={SENDER.name}
      creator="Wellthyfy Outreach CRM"
    >
      <Page size="A4" style={s.page}>
        <View style={s.header}>
          {/* Logo placeholder */}
          <View style={s.logo}>
            <Text style={s.logoText}>W</Text>
          </View>
          <View>
            <Text style={s.company}>{SENDER.company}</Text>
            <Text style={s.tagline}>{SENDER.tagline}</Text>
          </View>
        </View>

        <Text style={s.title}>Training Proposal</Text>
        <Text style={s.meta}>
          {p.proposalNo} · {formatIst(p.date, false)} · Prepared for {p.organisation.name}
          {p.organisation.city ? `, ${p.organisation.city}` : ''}
          {p.contact?.fullName
            ? ` — attn. ${p.contact.fullName}${p.contact.designation ? `, ${p.contact.designation}` : ''}`
            : ''}
        </Text>

        <Text style={s.h2}>About the trainer</Text>
        <Text>
          {SENDER.name} ({SENDER.credentials}) is the {SENDER.title}. With 22+ years of industry experience in
          frontline sales, territory management, distribution development, sales planning and team leadership
          across FMCG, consumer healthcare and pharma-related businesses, he brings practical industry
          experience to every session.
        </Text>

        {p.trainingNeed ? (
          <>
            <Text style={s.h2}>Your requirement</Text>
            <Text>{p.trainingNeed}</Text>
          </>
        ) : null}

        <Text style={s.h2}>Programme: {p.programme.name.replace(/^SAMPLE – edit me:\s*/, '')}</Text>
        {p.programme.modules.map((m) => (
          <View key={m} style={s.bullet}>
            <Text style={s.dot}>•</Text>
            <Text>{m}</Text>
          </View>
        ))}

        <Text style={s.h2}>Format and investment</Text>
        <View style={s.table}>
          <View style={s.row}>
            <Text style={s.cellLabel}>Duration / format</Text>
            <Text style={s.cellValue}>{p.duration}</Text>
          </View>
          <View style={s.row}>
            <Text style={s.cellLabel}>Professional fee</Text>
            <Text style={s.cellValue}>{inr(p.valueInr)} (taxes as applicable)</Text>
          </View>
        </View>

        {p.notes ? (
          <>
            <Text style={s.h2}>Notes</Text>
            <Text>{p.notes}</Text>
          </>
        ) : null}

        <Text style={s.h2}>Contact</Text>
        <Text>
          {SENDER.name} · {SENDER.title}
        </Text>
        <Text>
          {SENDER.phone} · {SENDER.email} · {SENDER.website}
        </Text>

        <Text style={s.footer} fixed>
          {SENDER.company} · {SENDER.phone} · {SENDER.email} · {SENDER.website}
        </Text>
      </Page>
    </Document>
  );
}

export async function renderProposalPdf(p: ProposalPdfInput): Promise<Buffer> {
  return renderToBuffer(<ProposalDocument p={p} />);
}
