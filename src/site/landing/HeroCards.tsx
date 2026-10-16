import { Avatar, Check, Chevron, Icon } from './parts'

// One Tuesday at the clinic as Balm shows it: the day's schedule, Dr. Patel's signed plan of care, Ana's Aetna
// authorization and paid claim (the same claim #10482 as the billing section), Thursday's reminder and a resubmitted denial.
export function HeroCards() {
  return <div className="hero-cards" role="img" aria-label="Tuesday schedule for Mar 24, 2026: 9:00 Ana R., knee re-eval; 9:45 Marcus T., daily note signed. Plan of care signed by Dr. Patel on Mar 11. Authorization: 8 of 12 visits left, Aetna, PT. Claim paid by Aetna, $142.18. Reminder sent for Thursday 10:30 to Ana R. Denied for a missing KX modifier, resubmitted Mar 10.">
    <div aria-hidden="true">
      <div className="hc hc-schedule">
        <div className="hc-head"><Icon name="calendar" className="hc-cal" /><p className="hc-title">Tuesday schedule</p><p className="hc-date">Mar 24, 2026</p></div>
        <div className="hc-visit"><Avatar initials="AR" tone="honey" /><div><p className="hc-name"><span>9:00</span>Ana R.</p><p className="hc-sub">knee re-eval</p></div><Chevron /></div>
        <div className="hc-visit"><Avatar initials="MT" tone="sage" /><div><p className="hc-name"><span>9:45</span>Marcus T.</p><p className="hc-sub">daily note <Check className="check mini" /></p></div><Chevron /></div>
      </div>
      <div className="hc hc-row hc-1"><span className="hc-icon tone-green"><Icon name="docFill" /></span><div><p className="hc-title">Plan of care signed</p><p className="hc-sub">by Dr. Patel · Mar 11</p></div><Check /></div>
      <div className="hc hc-row hc-2"><span className="hc-icon tone-indigo"><Icon name="shield" /></span><div><p className="hc-title">Auth: 8 of 12 visits left</p><p className="hc-sub">Aetna · PT</p></div><Chevron /></div>
      <div className="hc hc-row hc-3"><span className="hc-icon tone-money"><Icon name="dollar" /></span><div><p className="hc-title">Claim paid</p><p className="hc-sub">Aetna · $142.18</p></div><Check /></div>
      <div className="hc hc-row hc-4"><span className="hc-icon tone-honey"><Icon name="bell" /></span><div><p className="hc-title">Reminder sent</p><p className="hc-sub">Thu 10:30 · Ana R.</p></div><Check /></div>
      <div className="hc hc-row hc-5"><span className="hc-icon tone-coral"><Icon name="alert" /></span><div><p className="hc-title">Denied: missing KX modifier</p><p className="hc-sub">Resubmitted · Mar 10</p></div><Chevron /></div>
    </div>
  </div>
}
