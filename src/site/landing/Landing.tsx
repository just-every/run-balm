import { Hero } from './Hero'
import { Spread } from './parts'
import { Billing, Documentation } from './sections/Clinical'
import { CaseAgent, MovingIn } from './sections/Cases'
import { Closing } from './sections/Closing'
import { Details } from './sections/Details'
import { Interlude } from './sections/Interlude'
import { Ownership } from './sections/Ownership'
import { Payments, Reminders } from './sections/Payments'
import { Intake, Scheduling } from './sections/Scheduling'
import '../styles/site.css'
import '../styles/landing.css'
import '../styles/cards.css'
import '../styles/phone.css'

/**
 * run-balm.com's homepage, built from the design desk's page (16 Oct 2026) in its order: hero; scheduling and intake;
 * documentation and insurance billing; the interlude; patient payments and reminders; the case agent and moving in;
 * ownership; the quiet details; the closing with the footer. Painted art appears only in the hero, the interlude and
 * the closing; every other drawing is HTML and CSS.
 */
export function Landing() {
  return <>
    <Hero />
    <main id="main">
      <Spread name="2"><Scheduling /><Intake /></Spread>
      <Spread name="3"><Documentation /><Billing /></Spread>
      <Interlude />
      <Spread name="5"><Payments /><Reminders /></Spread>
      <Spread name="6"><CaseAgent /><MovingIn /></Spread>
      <Spread name="7"><Ownership /></Spread>
      <Spread name="8"><Details /></Spread>
      <Closing />
    </main>
  </>
}
