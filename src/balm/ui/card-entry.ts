import { h, hidden } from './shared'

/** Consent is separate from intake and never bundled with treatment consent. */
export function cardEntryPanel(data: any, action: string, portal = false) {
  if (!data || data.block) return ''
  return `<section id="payment-card" class="panel card"><h2>Card on file</h2>${data.card ? `<p>${h(data.card.brand)} ending ${h(data.card.last4)} is saved.</p>` : '<p>Save a card for copays and visit balances.</p>'}<details${data.card ? '' : ' open'}><summary>${data.card ? 'Replace saved card' : 'Save a payment card'}</summary><form method="post" action="${h(action)}">${portal ? hidden('name', 'payment.card') : ''}<label class="check"><input type="checkbox" name="consent" value="on" required><span>${h(data.consent)}</span></label><p>Enter your card in Stripe’s secure hosted fields on the next screen.</p><button type="submit">Continue to Stripe</button></form></details></section>`
}
