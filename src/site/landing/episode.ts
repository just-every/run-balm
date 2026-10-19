// One episode of care as the homepage tells it (design desk's page-s1, owner-approved 17 Oct 2026): Ana Ramirez's
// right knee, from Dr. Patel's referral on Tue Mar 3, 2026 to discharge on Thu Apr 30, 2026, with Sarah Lee, PT, at
// Riverside Physical Therapy. Every section reads its figures from here, so the dates, counts and dollars agree.
//
// Money: each visit bills $185.00 and Aetna allows $172.18 ($142.18 paid + $30.00 copay). The $86.40 deductible comes
// out of the first claim, so Aetna pays $55.78 + 15 x $142.18 = $2,188.48 and Ana pays 16 x $30.00 + $86.40 = $566.40;
// together $2,754.88, the allowed total, so the balance is $0.00. Authorization: 12 + 4 = 16 visits, the plan's 16.

export const patient = { name: 'Ana Ramirez', first: 'Ana', initials: 'AR', complaint: 'Right knee pain', payer: 'Aetna PPO', card: '7310' }
export const clinic = 'Riverside Physical Therapy'
export const therapist = 'Sarah Lee, PT'
export const physician = 'Dr. Priya Patel'

/** Tue 9:00 and Thu 10:30 from Mar 10 to Apr 30, 2026; Thu Apr 23 moved to Fri Apr 24, 9:15. */
export const visits: { month: 'Mar' | 'Apr'; day: number; weekday: 'Tue' | 'Thu' | 'Fri'; time: string; moved?: true }[] = [
  ...[10, 12, 17, 19, 24, 26, 31].map(day => ({ month: 'Mar' as const, day })),
  ...[2, 7, 9, 14, 16, 21, 24, 28, 30].map(day => ({ month: 'Apr' as const, day })),
].map(({ month, day }) => {
  const weekday = new Date(Date.UTC(2026, month === 'Mar' ? 2 : 3, day)).getUTCDay()
  const moved = month === 'Apr' && day === 24
  return { month, day, weekday: moved ? 'Fri' : weekday === 2 ? 'Tue' : 'Thu', time: moved ? '9:15' : weekday === 2 ? '9:00' : '10:30', ...(moved ? { moved: true as const } : {}) }
})

/** Days from Mar 10 (the first visit) for the timeline's scale; Apr 30 is day 51. */
export const dayOf = (month: 'Mar' | 'Apr', day: number) => month === 'Mar' ? day - 10 : day + 21
export const SPAN = dayOf('Apr', 30)

export const totals = { visits: 16, notes: 16, aetnaPaid: '$2,188.48', anaPaid: '$566.40', balance: '$0.00' }

/** The ribbon's eight dated milestones. */
export const milestones: { date: string; label: [string, string?]; icon: 'doc' | 'form' | 'shieldCheck' | 'user' | 'docFill' | 'denied' | 'shieldPlain' | 'check'; tone: 'sky' | 'sage' | 'honey' | 'coral'; agent?: true }[] = [
  { date: 'Mar 3', label: ['Referral from', physician], icon: 'doc', tone: 'sky' },
  { date: 'Mar 6', label: ['Intake and', 'consent signed'], icon: 'form', tone: 'sage' },
  { date: 'Mar 9', label: ['Aetna authorized', '12 visits'], icon: 'shieldCheck', tone: 'honey' },
  { date: 'Mar 10', label: ['Evaluation by', therapist], icon: 'user', tone: 'sky' },
  { date: 'Mar 11', label: ['Plan of care', 'signed'], icon: 'docFill', tone: 'sage' },
  { date: 'Apr 9', label: ['CO-4 denial', 'fixed, resubmitted'], icon: 'denied', tone: 'coral', agent: true },
  { date: 'Apr 13', label: ['4 more visits', 'approved'], icon: 'shieldPlain', tone: 'sky', agent: true },
  { date: 'Apr 30', label: ['Discharged'], icon: 'check', tone: 'sage' },
]

/** Aetna's first ERA, Mon Mar 23: three claims, posted automatically. */
export const remittance = {
  title: ['Remittance · Aetna', 'EFT 88213 · Mar 23'],
  rows: [
    { visit: 'Mar 10 · #10471', billed: '$185.00', paid: '$55.78', patient: '$116.40', note: 'Deductible $86.40 · copay $30.00' },
    { visit: 'Mar 12 · #10482', billed: '$185.00', paid: '$142.18', patient: '$30.00' },
    { visit: 'Mar 17 · #10490', billed: '$185.00', paid: '$142.18', patient: '$30.00' },
  ],
}
