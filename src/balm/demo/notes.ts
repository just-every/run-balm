// Treatment note text for the demo clinic's attended visits, in the plain
// SOAP style practitioners write: the first visit records the assessment,
// later visits record progress against the client's goal.
import type { Kind } from './people'
import type { Visit } from './visits'

const progress: Record<Kind, string[]> = {
  pt: [
    'Reports pain 3/10 this week, down from 5/10. Home exercises done most days.',
    'Tolerated the progression of loading well; mild soreness the next morning that settled by midday.',
    'Better week. Managed the aggravating activity twice with only brief discomfort.',
    'Flare-up after a busy weekend; settled with rest and the easier exercise set.',
  ],
  massage: [
    'Moderate pressure throughout; client comfortable. Myofascial release over the tight areas found at the first visit.',
    'Tension noticeably less than at the last visit. Trigger points released with sustained pressure.',
    'Client reports sleeping better since the last session. Lighter pressure today at their request.',
  ],
  hand: [
    'Splint fits well; skin checked, no pressure areas. Tendon gliding x10 without pain.',
    'Edema reduced since last visit. Active range improving; progressed to light putty grip work.',
    'Using the hand more at home. Reviewed joint protection for daily tasks.',
  ],
}
const plans: Record<Kind, string> = {
  pt: 'Plan: progress the home program, review in one week.',
  massage: 'Plan: home stretches given; rebook in two weeks.',
  hand: 'Plan: continue the home exercise sheet three times a day; review next week.',
}

export function noteBody(v: Visit) {
  const c = v.client, kind = v.practitioner.kind
  if (v.number === 1) return `S: ${c.reason}. ${c.history}\nO: ${c.finding}\nA: Findings consistent with ${c.diagnosis}.\n${plans[kind]} Goal: ${c.goal}.`
  return `Visit ${v.number}. S: ${progress[kind][(v.number + v.seq) % progress[kind].length]}\nO: ${kind === 'massage' ? c.finding : 'Reassessed; measures improving since the first visit.'}\n${plans[kind]} Goal: ${c.goal}.`
}

/** A few notes carry a correction, kept as a second revision. */
export const amendment = (v: Visit) => v.number === 1 && v.seq % 4 === 1
  ? { body: noteBody(v).replace('Plan:', 'Plan: confirmed with the client by phone the next day.'), reason: 'Added the follow-up phone call' } : null
