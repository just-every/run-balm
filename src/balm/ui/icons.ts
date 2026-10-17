// Line icons for card titles and the empty state, drawn on a 24 grid in the
// homepage's stroke style (styles/content.ts colours them). Inline SVG keeps
// the page free of image requests.
const svg = (paths: string) => `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${paths}</svg>`

export const icons = {
  building: svg('<path d="M4 20.5h16M6 20.5V5.5a1.5 1.5 0 0 1 1.5-1.5h6A1.5 1.5 0 0 1 15 5.5v15M15 9.5h3.5A1.5 1.5 0 0 1 20 11v9.5"/><path d="M9 8h3M9 11.5h3M9 15h3"/>'),
  card: svg('<rect x="3" y="5.5" width="18" height="13" rx="2.5"/><path d="M3 10h18M7 15h4"/>'),
  list: svg('<path d="M9 7h11M9 12h11M9 17h11"/><circle cx="4.75" cy="7" r=".9"/><circle cx="4.75" cy="12" r=".9"/><circle cx="4.75" cy="17" r=".9"/>'),
  door: svg('<path d="M6 20.5V4.5A1.5 1.5 0 0 1 7.5 3h9A1.5 1.5 0 0 1 18 4.5v16M4 20.5h16"/><circle cx="14.5" cy="12" r=".9"/>'),
  people: svg('<circle cx="9" cy="8.5" r="3.2"/><path d="M3.5 19.5c.6-3.2 2.8-5 5.5-5s4.9 1.8 5.5 5"/><path d="M15.5 5.6a3.2 3.2 0 0 1 0 5.8M17.6 14.8c1.6.6 2.6 2.2 2.9 4.7"/>'),
  sparkle: svg('<path d="M12 3.5l1.7 4.8 4.8 1.7-4.8 1.7L12 16.5l-1.7-4.8L5.5 10l4.8-1.7z"/><path d="M18.5 15.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z"/>'),
  calendar: svg('<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 9.5h17M8 3v4M16 3v4"/>'),
  note: svg('<path d="M14 3.5H7A1.5 1.5 0 0 0 5.5 5v14A1.5 1.5 0 0 0 7 20.5h10a1.5 1.5 0 0 0 1.5-1.5V8z"/><path d="M14 3.5V8h4.5M8.5 12.5h7M8.5 16h5"/>'),
  mail: svg('<rect x="3" y="5.5" width="18" height="13" rx="2.5"/><path d="M3.8 7l8.2 6 8.2-6"/>'),
  phone: svg('<path d="M6.5 3.5h3l1.5 4-2 1.3a10 10 0 0 0 6.2 6.2l1.3-2 4 1.5v3a2 2 0 0 1-2 2A15.5 15.5 0 0 1 4.5 5.5a2 2 0 0 1 2-2z"/>'),
  clock: svg('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>'),
  person: svg('<circle cx="12" cy="8" r="3.5"/><path d="M5 20c.8-3.6 3.6-5.6 7-5.6s6.2 2 7 5.6"/>'),
}

/** The empty client list's drawing: a blank file folder with the mark's sprout, in its amber and teal. */
export const emptyFolder = `<svg viewBox="0 0 80 80" aria-hidden="true" focusable="false"><path d="M13 30.5a4 4 0 0 1 4-4h14l5 5h27a4 4 0 0 1 4 4V61a4 4 0 0 1-4 4H17a4 4 0 0 1-4-4z" fill="#fdf1d9" stroke="#b8751a" stroke-width="2" stroke-linejoin="round"/><path d="M13 39h54" stroke="#b8751a" stroke-width="2" stroke-linecap="round"/><path d="M40 26.5V15" stroke="#1e907e" stroke-width="2.2" stroke-linecap="round"/><path d="M40 18c-1.2-5-5-7.5-10-7 .6 5 4.6 7.6 10 7z" fill="#1e907e"/><path d="M40 20.5c1.4-5.2 5.4-7.4 10.4-6.6-.9 5-5.2 7.3-10.4 6.6z" fill="#a3c582"/></svg>`
