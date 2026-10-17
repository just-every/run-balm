// The Today screen's layout and its patient panel: the day beside the selected
// visit's patient, the coral denied-claim card with its dated trail, and the
// quiet case agent strip. Every colour is a token from public/rer-theme.css.
export const todayStyle = `
.today{display:grid;grid-template-columns:minmax(0,1fr) 426px;gap:14px;align-items:start}
.today.single{grid-template-columns:minmax(0,1fr)}
@media(min-width:1181px){.today:not(.week):has(.cal:is(.n4,.n5,.n6,.n7,.n8)){grid-template-columns:minmax(0,1fr) 340px}}
.today.week{grid-template-columns:minmax(0,1fr)}.today.week .today-side{position:static;max-width:640px}
.week-who{flex-wrap:wrap;align-self:center;margin-left:auto}
.today-main{min-width:0}
.today-head{display:flex;flex-wrap:wrap;align-items:flex-end;justify-content:space-between;gap:14px 20px;min-height:96px;padding:8px 8px 0 12px;margin:0 0 14px}
.today-head h1{font-size:58px;line-height:1.02;letter-spacing:-.035em;margin:0 0 6px}
.today-head .sub{margin:0;font-size:16px;color:var(--body);font-variant-numeric:tabular-nums}.today-head .sub span{margin:0 4px;color:var(--soft)}
.cal-help{margin:12px 2px 4px}
.today-side{position:sticky;top:16px;min-width:0}
.today-side>#book>.panel{margin:0}
.today-more{margin-top:22px}
.day-list>summary{display:flex;align-items:baseline;gap:12px;width:auto;margin:0;padding:0;color:var(--ink)}.day-list>summary h2{margin:0}.day-list[open]>summary{margin-bottom:12px}
.visit-rows{list-style:none;margin:0;padding:0}.visit-rows li{display:grid;grid-template-columns:76px minmax(0,1fr) auto;gap:4px 16px;align-items:start;padding:10px 0;border-top:1px solid var(--line)}
.visit-rows .when{font-weight:600;font-variant-numeric:tabular-nums;padding-top:1px}.visit-rows .what{min-width:0}.visit-rows .chips{margin:4px 0 0}.visit-rows .row-links{display:grid;justify-items:end;gap:6px;font-size:13px}.visit-rows .row-links form{display:block}
@media(max-width:700px){.visit-rows li{grid-template-columns:64px minmax(0,1fr)}.visit-rows .row-links{grid-column:2;justify-items:start}}
.panel.setup{margin:0 0 16px}
.button.small{min-height:32px;padding:0 12px;font-size:13px;border-radius:9px}

/* The patient panel. */
.patient{padding:18px 18px 16px;background:var(--rer-surface);border:1px solid var(--line);border-radius:16px;box-shadow:var(--shadow-card)}
.profile{display:flex;align-items:center;gap:18px;padding:0 8px}
.avatar.lg{width:80px;height:80px;font-size:24px}
.profile>div{min-width:0}
.profile h2{margin:0;font:500 28px/1.15 var(--rer-font-heading);letter-spacing:-.02em;font-variation-settings:'opsz' 48;overflow-wrap:anywhere}
.profile p{margin:4px 0 0;font-size:18px;color:var(--body)}
.more{margin-left:auto;align-self:flex-start;display:inline-grid;place-items:center;width:34px;height:34px;flex:none;border:1px solid var(--line);border-radius:50%;color:var(--ink)}.more:hover{background:var(--hover)}.more .icon{width:16px;height:16px}
.tabs{display:flex;justify-content:space-between;gap:4px;margin:14px 0 0;padding:0 4px;border-bottom:1px solid var(--line)}
.tabs a,.tabs span{padding:8px 6px 9px;color:var(--body);font-size:13.5px;text-decoration:none;border-bottom:2px solid transparent;margin-bottom:-1px}
.tabs a:hover{color:var(--ink)}.tabs [aria-current]{color:var(--ink);font-weight:600;border-bottom-color:var(--pill)}
.visit-line{padding:12px 4px 0}.visit-line p{margin:0 0 6px;font-size:13.5px;color:var(--body)}.visit-line .chips{margin:0}.visit-line strong{font-variant-numeric:tabular-nums}
.facts{list-style:none;margin:6px 0 4px;padding:0}
.fact{display:flex;gap:14px;align-items:flex-start;padding:10px 8px}
.fact strong{display:block;font-size:13.5px;line-height:1.35}.fact p{margin:1px 0 0;font-size:13.5px;line-height:1.45;color:var(--body);font-variant-numeric:tabular-nums}
.disc{display:inline-grid;place-items:center;flex:none;width:38px;height:38px;border-radius:50%;background:var(--row);color:var(--soft)}.disc .icon{width:18px;height:18px}
.disc.sage{background:var(--sage-tint);color:var(--check)}.disc.sky{background:var(--sky-tint);color:var(--sky-ink)}.disc.honey{background:var(--honey-tint);color:var(--honey-ink)}.disc.coral{background:var(--coral-tint);color:var(--coral)}.disc.ink{background:var(--row);color:var(--ink)}
.primary{display:grid;gap:10px;margin:8px 0 12px}.primary form{display:grid}.primary>form>button,.primary .actions button{width:100%}
.primary .actions{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.button.start{width:100%;min-height:46px;border-radius:12px;font-size:15px}.button.start .icon{width:18px;height:18px}
.visit-actions{margin:12px 0 0;padding:10px 8px 0;border-top:1px solid var(--line)}.visit-actions p{margin:8px 0 0}

/* The denied claim: coral edge and header, the dated trail, and the fix that waits for a person. */
.claim-alert{margin:12px 0 4px;border:1px solid color-mix(in srgb,var(--coral) 45%,var(--coral-tint));border-radius:12px;overflow:hidden;background:var(--rer-surface)}
.claim-alert header{display:flex;gap:12px;align-items:flex-start;padding:12px 12px 10px 14px;background:linear-gradient(110deg,var(--coral-wash),var(--rer-surface))}
.claim-alert header>.icon{width:26px;height:26px;color:var(--coral);margin-top:1px}
.claim-alert header>div{min-width:0}.claim-alert header strong{display:block;font-size:14.5px;line-height:1.35;color:var(--ink)}.claim-alert header p{margin:2px 0 0;font-size:13px;color:var(--body);font-variant-numeric:tabular-nums}.claim-alert header p.why{color:var(--coral-ink)}
.go{margin-left:auto;display:inline-grid;place-items:center;flex:none;width:28px;height:28px;border-radius:8px;color:var(--coral-ink)}.go:hover{background:var(--coral-tint)}.go .icon{width:16px;height:16px}
.trail{list-style:none;margin:0;padding:10px 16px 6px}
.trail li{position:relative;display:grid;grid-template-columns:14px 96px minmax(0,1fr);gap:10px;align-items:baseline;padding:4px 0;font-size:13px;color:var(--body)}
.trail time{color:var(--soft);font-variant-numeric:tabular-nums}
.trail .dot{width:9px;height:9px;border-radius:50%;background:var(--field);margin-left:2px;align-self:center}
.trail li:not(:last-child) .dot::after{content:'';position:absolute;left:6px;top:20px;height:calc(100% - 12px);border-left:1px solid var(--line-strong)}
.trail li.fault,.trail li.fault time{color:var(--coral-ink)}.trail li.fault .dot{background:var(--coral);width:11px;height:11px;margin-left:1px}
.fix{margin:6px 10px 10px;padding:11px 14px 12px;border:1px solid var(--line);border-radius:10px;background:var(--row);font-size:13px}
.fix>strong{display:block;font-size:13px}.fix p{margin:3px 0 8px;color:var(--body)}
.fix form{gap:10px}.fix .check{font-size:12.5px}
.fix-actions{display:flex;flex-wrap:wrap;gap:8px 10px;align-items:center}
.approval{display:inline-flex;align-items:center;min-height:30px;padding:0 10px;border-radius:9px;background:var(--sky-tint);color:var(--sky-ink);font-size:12px;font-weight:500;white-space:nowrap}

/* The case agent strip: quiet, cited, never a chat. */
.agent{margin-top:12px;border:1px solid var(--sage-tint);border-radius:12px;overflow:hidden}
.agent header{display:flex;align-items:center;gap:10px;padding:9px 12px;background:linear-gradient(110deg,var(--sage-wash),var(--rer-surface))}
.agent header strong{font-size:13.5px}.agent .standing .status{margin:0}.agent .leaf{width:18px;height:18px;color:var(--sage)}
.agent .go{color:var(--sage-ink)}.agent .go:hover{background:var(--sage-tint)}
.agent ul{list-style:none;margin:0;padding:8px 12px 2px}
.agent li{display:flex;gap:12px;align-items:flex-start;padding:5px 0}
.agent li .disc{width:26px;height:26px}.agent li .disc .icon{width:14px;height:14px}
.agent li strong{display:block;font-size:12.5px;line-height:1.35}.agent li p{margin:1px 0 0;font-size:12px;line-height:1.45;color:var(--soft)}
.agent li a{display:inline-flex;vertical-align:-2px;margin-left:2px;color:var(--teal-ink)}.icon.small{width:13px;height:13px}
.agent-note{margin:0;padding:4px 12px 10px 50px;font-size:11.5px;color:var(--soft)}
.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}

/* Empty states. */
.empty-state{display:grid;justify-items:start;gap:6px;max-width:560px;padding:28px;background:var(--rer-surface);border:1px dashed var(--line-strong);border-radius:var(--radius-card)}
.empty-state>.icon{width:30px;height:30px;color:var(--sage);margin-bottom:4px}.empty-state h1,.empty-state h2{margin:0;font:500 26px/1.2 var(--rer-font-heading);letter-spacing:-.02em}.empty-state p{margin:0 0 8px}

@media(max-width:1180px){.today{grid-template-columns:minmax(0,1fr)}.today-side{position:static}}
@media(max-width:600px){.today-head h1{font-size:40px}.today-head .sub{font-size:14px}.patient{padding:14px}.profile h2{font-size:24px}.avatar.lg{width:52px;height:52px;font-size:17px}.trail li{grid-template-columns:14px 88px minmax(0,1fr)}}
`
