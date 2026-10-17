// The calendar's layout. Grid placement uses generated classes (rs = row start,
// re = rows spanned, cs = column, n = column count), never inline styles, so the
// hashed style policy stays as strict as the rest of the app.
const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i)
const placement = range(1, 97).map(n => `.rer-themed .rs${n}{grid-row-start:${n}}`).join('')
  + range(1, 96).map(n => `.rer-themed .re${n}{grid-row-end:span ${n}}`).join('')
  + range(1, 41).map(n => `.rer-themed .cs${n}{grid-column-start:${n}}`).join('')
  + range(1, 40).map(n => `.rer-themed .cal.n${n}{grid-template-columns:76px repeat(${n},minmax(${n > 1 ? 112 : 160}px,1fr))}`).join('')

export const calendarStyle = placement + `
.rer-themed [hidden]{display:none!important}
.rer-themed .cal-bar{display:flex;flex-wrap:wrap;align-items:flex-end;gap:12px 16px;margin-bottom:8px}.rer-themed .cal-title{margin:0 auto 0 0;font-size:22px}
.rer-themed .cal-nav{display:flex;flex-wrap:wrap;border:1px solid var(--rer-border);border-radius:var(--rer-radius);overflow:hidden}
.rer-themed .seg{padding:8px 12px;text-decoration:none;font-weight:500;border-left:1px solid var(--rer-border)}.rer-themed .seg:first-child{border-left:0}.rer-themed .seg.on{background:var(--rer-page);font-weight:700}
.rer-themed .cal-filter{display:flex;gap:8px;align-items:flex-end}.rer-themed .cal-filter label{font-size:14px}.rer-themed .cal-filter button{width:auto;min-height:46px;padding:8px 14px}
.rer-themed .cal-wrap{overflow-x:auto;border:1px solid var(--rer-border);border-radius:var(--rer-radius);margin:8px 0 24px}
.rer-themed .cal{display:grid;grid-template-rows:44px;grid-auto-rows:26px;position:relative;min-width:100%}
.rer-themed .cal-head{position:sticky;top:0;z-index:3;align-self:stretch;padding:6px 8px;background:var(--rer-surface);border-bottom:1px solid var(--rer-border);border-left:1px solid var(--rer-border);font-weight:600;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.rer-themed .cal-head.cs1{left:0;z-index:4;border-left:0}.rer-themed .cal-head.today{background:var(--rer-page)}
.rer-themed .cal .rs1{grid-row-start:1}
.rer-themed .cal-time{position:sticky;left:0;z-index:2;padding:2px 8px 0;font-size:12px;line-height:1.1;white-space:nowrap;color:var(--rer-muted);background:var(--rer-surface);border-top:1px solid var(--rer-border);transform:translateY(0)}
.rer-themed .cell{border-left:1px solid var(--rer-border);min-width:0}.rer-themed .cell.hour{border-top:1px solid var(--rer-border)}.rer-themed .cell[data-book]{cursor:pointer}.rer-themed .cell[data-book]:hover{background:var(--rer-page)}
.rer-themed .cell.off{background:repeating-linear-gradient(135deg,var(--rer-page) 0 6px,transparent 6px 12px)}.rer-themed .cell.drop{outline:2px solid var(--rer-accent,var(--rer-text));outline-offset:-2px}
.rer-themed .appt{position:relative;z-index:1;margin:1px 3px;padding:2px 6px;overflow:hidden;font-size:13px;line-height:1.3;text-decoration:none;color:var(--rer-text);border-radius:6px;border:1px solid var(--rer-border);border-left-width:4px;background:var(--rer-surface)}
.rer-themed .appt strong{display:inline}.rer-themed .appt-time{font-weight:600}.rer-themed .appt-meta{display:block;color:var(--rer-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.rer-themed .appt-tags{display:flex;flex-wrap:wrap;gap:4px;margin-top:2px}.rer-themed .tag{font-size:11px;font-weight:600;padding:0 5px;border-radius:4px;background:var(--rer-page)}
.rer-themed .appt.st-booked{border-left-color:var(--rer-accent,var(--rer-brand-accent,var(--rer-text)));background:color-mix(in srgb,var(--rer-accent,var(--rer-brand-accent,#3b6)) 20%,var(--rer-surface))}
.rer-themed .appt.st-attended{border-left-color:var(--rer-muted);background:var(--rer-page);color:var(--rer-muted)}.rer-themed .appt.st-attended strong{color:var(--rer-text)}
.rer-themed .appt.st-no_show{border-style:dashed;border-left-style:solid;border-left-color:var(--rer-muted);color:var(--rer-muted)}
.rer-themed .appt.chosen{outline:3px solid var(--rer-focus,var(--rer-text));outline-offset:-1px;z-index:2}.rer-themed .appt.dragging{opacity:.5}.rer-themed .appt[draggable=true]{cursor:grab}
.rer-themed .weekdays{display:flex;flex-wrap:wrap;gap:4px 14px;border:0;padding:0;margin:0}.rer-themed .weekdays legend{font-weight:500;margin-bottom:6px;padding:0}.rer-themed .weekdays .check{gap:6px}
.rer-themed .series-review{margin:0 0 16px}.rer-themed .series-review h3{font-size:17px}.rer-themed .series-review tr.conflict td{background:var(--rer-page)}.rer-themed .series-review tr.skipped td{color:var(--rer-muted);text-decoration:line-through}
.rer-themed .series-review input[type=time]{min-height:38px;padding:4px 8px;width:auto}.rer-themed .series-review .actions{grid-template-columns:repeat(auto-fit,minmax(160px,1fr));margin-top:12px}
.rer-themed button[disabled]{opacity:.45;cursor:not-allowed}
@media(max-width:600px){.rer-themed .series-review thead{display:none}.rer-themed .series-review table,.rer-themed .series-review tbody{display:block}.rer-themed .series-review tr{display:flex;flex-wrap:wrap;align-items:center;gap:4px 12px;padding:8px 0;border-bottom:1px solid var(--rer-border)}.rer-themed .series-review td{display:block;border:0;padding:0}.rer-themed .series-review td:first-child{font-weight:600;min-width:100px}.rer-themed .series-review td:nth-child(3){flex-basis:100%;order:3}.rer-themed .series-review .table{overflow:visible}.rer-themed .cal-title{width:100%;font-size:20px}.rer-themed .cal-filter{width:100%}.rer-themed .cal-filter label{flex:1}.rer-themed .cal-wrap{margin-left:-4px;margin-right:-4px}}
`
