// The app's line icons, from the 12ui conversion of the owner-picked screen: one
// hidden sprite per page, and `icon(name)` draws one by reference.
const paths: Record<string, string> = {
  chevron: '<path d="m9 5 7 7-7 7"/>',
  back: '<path d="m15 5-7 7 7 7"/>',
  down: '<path d="m5 9 7 7 7-7"/>',
  calendar: '<rect x="3" y="5" width="18" height="17" rx="2"/><path d="M7 2v6M17 2v6M3 10h18m-12 6 2 2 5-5"/>',
  day: '<rect x="3" y="5" width="18" height="17" rx="2"/><path d="M7 2v6M17 2v6M3 10h18"/>',
  person: '<circle cx="12" cy="6" r="4"/><path d="M4 22v-3c0-6 16-6 16 0v3Z"/>',
  people: '<circle cx="9" cy="7" r="3.5"/><path d="M2 21v-2c0-5 14-5 14 0v2M16 3.5a3.5 3.5 0 0 1 0 7M18 14c2.5.6 4 2 4 5v2"/>',
  note: '<path d="M5 2h9l5 5v15H5ZM14 2v6h5M9 12h6M9 16h6"/>',
  card: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="M2 9h20"/>',
  message: '<path d="M3 3h18v15H9l-6 4v-7Z"/>',
  bars: '<path d="M5 21V11M12 21V3M19 21V8"/>',
  gear: '<path d="m9 2 6 0 1 4 4 1 2 5-3 3v4l-5 3-3-3-4 1-4-5 2-4-1-4 4-2Z"/><circle cx="12" cy="12" r="3"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  check: '<path d="m5 12 4 4 10-10"/>',
  checked: '<circle cx="12" cy="12" r="9"/><path d="m7 12 3 3 6-6"/>',
  shield: '<path d="m12 2 8 4v6c0 5-8 10-8 10S4 17 4 12V6Z"/><path d="m8 11 3 3 5-6"/>',
  warning: '<path d="M11 3 1 21h22L13 3Z"/><path d="M12 9v5m0 3v1"/>',
  arrow: '<path d="M3 12h17m-6-6 6 6-6 6"/>',
  external: '<path d="M14 3h7v7m0-7L10 14M10 5H4v16h16v-7"/>',
  money: '<path d="M16 6c-8-5-13 5-4 6s5 12-5 6M12 2v20"/>',
  leaf: '<path fill="currentColor" stroke="none" d="M12 21C2 18 0 10 4 6c7 1 8 6 8 11C8 7 12 1 17 0c4 8-1 13-4 17 3-7 7-8 10-7-1 8-6 10-10 11v3h-1Z"/>',
  pin: '<path d="M12 22s7-6.5 7-12a7 7 0 0 0-14 0c0 5.5 7 12 7 12Z"/><circle cx="12" cy="10" r="2.5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  pen: '<path d="M4 20h4L19 9l-4-4L4 16Z"/><path d="m13 7 4 4"/>',
  x: '<circle cx="12" cy="12" r="9"/><path d="m9 9 6 6m0-6-6 6"/>',
  open: '<circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h1M3 12h1M3 18h1"/>',
  building: '<path d="M4 22V4l8-2v20M12 8h8v14M8 7v1m0 4v1m0 4v1m8-5v1m0 4v1M2 22h20"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="m11 12 9-9m-4 4 3 3m-5-1 2 2"/>',
  upload: '<path d="M12 16V4m-5 5 5-5 5 5M4 16v4h16v-4"/>',
  form: '<rect x="4" y="3" width="16" height="19" rx="2"/><path d="M9 3v2h6V3M8 10h8M8 14h8M8 18h5"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
  claim: '<path d="M6 2h12v20l-3-2-3 2-3-2-3 2Z"/><path d="M9 7h6M9 11h6M9 15h3"/>',
  case: '<rect x="3" y="7" width="18" height="14" rx="2"/><path d="M9 7V4h6v3M3 13h18"/>',
  waitlist: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5h4"/><path d="M3 3l3 3"/>',
  signout: '<path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
}

export const iconSprite = `<svg class="sprite" aria-hidden="true" focusable="false"><defs>${Object.entries(paths).map(([id, d]) => `<symbol id="i-${id}" viewBox="0 0 24 24">${d}</symbol>`).join('')}</defs></svg>`

/** One icon from the sprite; decorative unless a label is given. */
export const icon = (name: keyof typeof paths | string, extra = '') => `<svg class="icon${extra ? ' ' + extra : ''}" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><use href="#i-${name}"/></svg>`
