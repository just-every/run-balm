import { Hero } from './Hero'
import { Band } from './sections/Band'
import { CaseAgent } from './sections/CaseAgent'
import { Closing } from './sections/Closing'
import { Evaluation } from './sections/Evaluation'
import { MoveIn } from './sections/MoveIn'
import { Paid } from './sections/Paid'
import { Ready } from './sections/Ready'
import { Ribbon } from './sections/Ribbon'
import { Stairs } from './sections/Stairs'
import { Visits } from './sections/Visits'
import '../styles/site.css'
import '../styles/landing.css'
import '../styles/cards.css'
import '../styles/stage.css'
import '../styles/sections/ribbon.css'
import '../styles/sections/ready.css'
import '../styles/sections/evaluation.css'
import '../styles/sections/visits.css'
import '../styles/sections/band.css'
import '../styles/sections/agent.css'
import '../styles/sections/paid.css'
import '../styles/sections/stairs.css'
import '../styles/sections/move-in.css'
import '../styles/phone.css'

/**
 * run-balm.com's homepage on the owner-approved page structure s1 (17 Oct 2026): one episode of care, Ana Ramirez's
 * right knee from referral to paid (episode.ts). The approved hero and closing are unchanged; between them the clinic's
 * own stages, each drawn as HTML and CSS over a soft painted ground of the hero's window light. Painted art: the hero,
 * the ridge band, the stairs and the closing.
 */
export function Landing() {
  return <>
    <Hero />
    <main id="main">
      <Ribbon />
      <Ready />
      <Evaluation />
      <Visits />
      <Band />
      <CaseAgent />
      <Paid />
      <Stairs />
      <MoveIn />
      <Closing />
    </main>
  </>
}
