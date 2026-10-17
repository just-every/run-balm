// What pages are made of: white hairline cards with serif or tracked-caps
// titles, entries divided by hairlines, status chips whose tint carries their
// meaning (sage done, honey needs a look, sky booked or informational, grey
// closed, coral refused), initials avatars, icon discs, tables and notices.
export const contentStyle = `
.rer-themed .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,460px),1fr));gap:20px;align-items:start}
.rer-themed .grid>.panel{margin:0}
.rer-themed .full{grid-column:1/-1}
.rer-themed .panel{min-width:0;padding:22px 26px 24px;margin:0 0 20px;background:var(--surface);border:1px solid var(--line);border-radius:var(--radius-card);box-shadow:var(--shadow-card)}
.rer-themed .panel>h2,.rer-themed .panel-head h2{display:flex;align-items:center;gap:12px;margin:0 0 14px;font:500 27px/1.15 var(--font-head);letter-spacing:-.015em}
.rer-themed .panel.facts>h2,.rer-themed .eyebrow{display:block;margin:0 0 12px;font:600 11.5px/1.3 var(--font-body);letter-spacing:.16em;text-transform:uppercase;color:var(--soft)}
.rer-themed .disc{flex:none;display:grid;place-items:center;width:42px;height:42px;border-radius:50%;background:var(--sage-tint);color:var(--sage-ink)}
.rer-themed .disc svg{width:20px;height:20px}
.rer-themed .disc.honey{background:var(--honey-tint);color:var(--honey-ink)}.rer-themed .disc.sky{background:var(--sky-tint);color:var(--sky-ink)}
.rer-themed .icon{fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}
.rer-themed h3{margin:0 0 6px;font:600 15.5px/1.4 var(--font-body);letter-spacing:-.005em}
.rer-themed h4{margin:16px 0 8px;font:600 12px/1.3 var(--font-body);letter-spacing:.12em;text-transform:uppercase;color:var(--soft)}
.rer-themed .panel h3+p{margin-top:0}
.rer-themed .entry{min-width:0;padding:16px 0;border-top:1px solid var(--line)}
.rer-themed .entry:first-of-type{border-top:0;padding-top:2px}
.rer-themed .entry:last-child{padding-bottom:0}
.rer-themed .entry p{margin-bottom:10px}
.rer-themed .entry form+form{margin-top:10px}
.rer-themed .status{display:inline-flex;align-items:center;gap:5px;min-height:24px;padding:0 10px;margin:0 4px 4px 0;border-radius:var(--radius-chip);background:var(--row);color:var(--body);font:500 12.5px/1.2 var(--font-body);white-space:nowrap;vertical-align:middle}
.rer-themed .status.done{background:var(--sage-tint);color:var(--sage-ink)}
.rer-themed .status.done::before{content:'';width:7px;height:4px;margin:-2px 1px 0 0;border:solid currentColor;border-width:0 0 1.6px 1.6px;transform:rotate(-45deg)}
.rer-themed .status.todo{background:var(--honey-tint);color:var(--honey-text)}
.rer-themed .status.info{background:var(--sky-tint);color:var(--sky-ink)}
.rer-themed .status.closed{background:var(--bubble);color:var(--soft)}
.rer-themed .status.refused{background:var(--coral-tint);color:var(--coral-ink)}
.rer-themed .chips{display:flex;flex-wrap:wrap;align-items:center;gap:0;margin:0 0 8px}
.rer-themed .avatar{flex:none;display:inline-grid;place-items:center;width:34px;height:34px;border-radius:50%;background:var(--honey-tint);color:var(--honey-text);font:600 12.5px/1 var(--font-body);letter-spacing:.02em}
.rer-themed .avatar.sage{background:var(--sage-tint);color:var(--sage-ink)}.rer-themed .avatar.sky{background:var(--sky-tint);color:var(--sky-ink)}
.rer-themed .avatar.big{width:64px;height:64px;font-size:21px}
.rer-themed .help{font-size:13px;color:var(--soft)}
.rer-themed .empty{margin:0;color:var(--soft)}
.rer-themed .plain{list-style:none;padding:0;margin:0 0 12px}
.rer-themed .plain li{padding:8px 0;border-top:1px solid var(--line)}.rer-themed .plain li:first-child{border-top:0}
.rer-themed .steps{margin:0 0 12px;padding-left:22px}.rer-themed .steps li{margin-bottom:8px;color:var(--body)}.rer-themed .steps li.done{color:var(--soft)}
.rer-themed .notice{margin:0 0 20px;padding:14px 18px;border:1px solid color-mix(in srgb,var(--sky-ink) 18%,transparent);border-radius:14px;background:var(--sky-tint);color:var(--ink)}
.rer-themed .notice.error{border-color:color-mix(in srgb,var(--coral) 35%,transparent);background:var(--coral-tint)}
.rer-themed .notice[role=note]{border-color:color-mix(in srgb,var(--honey-ink) 30%,transparent);background:var(--honey-wash)}
.rer-themed .notice ul{margin:8px 0 0}
.rer-themed pre{max-width:100%;margin:0 0 12px;padding:12px 14px;white-space:pre-wrap;overflow-wrap:anywhere;background:var(--row);border:1px solid var(--line);border-radius:10px;font:13px/1.55 var(--font-mono);color:var(--ink)}
.rer-themed code{font-family:var(--font-mono);font-size:.92em}
.rer-themed .note,.rer-themed .waiver-text{white-space:pre-wrap;overflow-wrap:anywhere;margin:0 0 12px;padding:12px 14px;background:var(--row);border-radius:10px;color:var(--ink)}
.rer-themed dl.answers{display:grid;grid-template-columns:minmax(120px,max-content) minmax(0,1fr);gap:8px 24px;margin:6px 0 14px}
.rer-themed .answers dt{margin:0;font:600 11.5px/1.7 var(--font-body);letter-spacing:.12em;text-transform:uppercase;color:var(--teal-ink)}
.rer-themed .answers dd{margin:0;white-space:pre-wrap;overflow-wrap:anywhere;color:var(--ink)}
.rer-themed .table{overflow-x:auto;margin:0 0 12px;border:1px solid var(--line);border-radius:12px}
.rer-themed table{width:100%;border-collapse:collapse;font-size:14px;font-variant-numeric:tabular-nums}
.rer-themed th{padding:9px 12px;text-align:left;vertical-align:bottom;background:var(--row);border-bottom:1px solid var(--line);font:600 11px/1.3 var(--font-body);letter-spacing:.1em;text-transform:uppercase;color:var(--soft);white-space:nowrap}
.rer-themed td{padding:9px 12px;text-align:left;vertical-align:top;border-bottom:1px solid var(--line);overflow-wrap:anywhere;color:var(--ink)}
.rer-themed tr:last-child td{border-bottom:0}
.rer-themed table.units th,.rer-themed table.units td:not(:nth-child(2)){white-space:nowrap;overflow-wrap:normal}
.rer-themed .billed{margin:0 0 12px;padding:10px 14px;border-radius:10px;background:var(--sage-tint);color:var(--sage-ink);font-size:14px}
.rer-themed .billed strong{color:var(--sage-ink)}
.rer-themed .signature{display:flex;flex-wrap:wrap;gap:4px 10px;align-items:baseline;margin:12px 0;padding-top:12px;border-top:1px solid var(--line);font-size:13.5px}
.rer-themed .signature::before{content:'';flex:none;align-self:center;width:18px;height:18px;border-radius:50%;background:var(--check)}
.rer-themed .empty-state{display:grid;justify-items:center;gap:12px;padding:44px 16px 36px;text-align:center}
.rer-themed .empty-state svg{width:76px;height:76px}
.rer-themed .empty-state p{max-width:42ch;margin:0;color:var(--body)}
.rer-themed .empty-state .links{display:flex;flex-wrap:wrap;justify-content:center;gap:6px 28px;font-size:14px}
@media(max-width:700px){
.rer-themed .grid{display:block}.rer-themed .grid>.panel{margin-bottom:16px}
.rer-themed .panel{padding:18px 18px 20px;border-radius:14px}
.rer-themed .panel>h2,.rer-themed .panel-head h2{font-size:24px}
.rer-themed dl.answers{grid-template-columns:1fr;gap:2px}.rer-themed .answers dd{margin-bottom:8px}
}
`
