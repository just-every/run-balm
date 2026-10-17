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
.rer-themed .cal-card{padding:20px 22px 22px}
.rer-themed .cal-bar{display:flex;flex-wrap:wrap;align-items:flex-end;gap:12px 14px;margin-bottom:10px}
.rer-themed .cal-title{margin:0 auto 4px 0;font:500 30px/1.1 var(--font-head);letter-spacing:-.02em}
.rer-themed .cal-nav{display:flex;flex-wrap:wrap;padding:3px;border:1px solid var(--line);border-radius:var(--radius-chip);background:var(--surface)}
.rer-themed .seg{display:inline-flex;align-items:center;min-height:32px;padding:0 13px;border-radius:var(--radius-chip);color:var(--body);font-size:14px;font-weight:500;text-decoration:none;white-space:nowrap}
.rer-themed .seg:hover{color:var(--ink);background:var(--row)}
.rer-themed .seg.on{background:var(--sage-tint);color:var(--navy);font-weight:600}
.rer-themed .cal-filter{display:flex;gap:10px;align-items:flex-end}.rer-themed .cal-filter label{font-size:12.5px;color:var(--soft);min-width:190px}.rer-themed .cal-filter button{min-height:42px}
.rer-themed .cal-card>.help{margin:0 0 14px}
.rer-themed .cal-wrap{overflow-x:auto;margin:0;border:1px solid var(--line);border-radius:12px;background:var(--surface)}
.rer-themed .cal{display:grid;grid-template-rows:44px;grid-auto-rows:20px;position:relative;min-width:100%}
.rer-themed .cal-head{position:sticky;top:0;z-index:3;align-self:stretch;display:flex;align-items:center;padding:0 12px;background:var(--surface);border-bottom:1px solid var(--line);border-left:1px solid var(--line);font:500 17px/1.2 var(--font-head);color:var(--ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.rer-themed .cal-head a{color:inherit;text-decoration:none}
.rer-themed .cal-head.cs1{left:0;z-index:4;border-left:0}.rer-themed .cal-head.today{background:var(--sage-tint)}
.rer-themed .cal .rs1{grid-row-start:1}
.rer-themed .cal-time{position:sticky;left:0;z-index:2;padding:3px 10px 0;font-size:12px;line-height:1.1;white-space:nowrap;color:var(--soft);background:var(--surface);border-top:1px solid var(--line);font-variant-numeric:tabular-nums}
.rer-themed .cell{border-left:1px solid var(--line);min-width:0}.rer-themed .cell.hour{border-top:1px solid var(--line)}.rer-themed .cell[data-book]{cursor:pointer}.rer-themed .cell[data-book]:hover{background:var(--sky-tint)}
.rer-themed .cell.off{background:repeating-linear-gradient(135deg,var(--row) 0 5px,transparent 5px 10px)}.rer-themed .cell.drop{outline:2px solid var(--teal);outline-offset:-2px}
.rer-themed .appt{position:relative;z-index:1;display:block;margin:1px 4px;padding:3px 8px 3px 10px;overflow:hidden;font-size:12.5px;line-height:1.3;text-decoration:none;color:var(--ink);border-radius:8px;border:1px solid color-mix(in srgb,var(--sky-ink) 16%,transparent);border-left:3px solid var(--teal);background:var(--sky-tint)}
.rer-themed .appt:hover{box-shadow:var(--shadow-card)}
.rer-themed .appt strong{display:block;font-size:13.5px;font-weight:600}.rer-themed .appt-time{display:block;font-size:11.5px;color:var(--body);font-variant-numeric:tabular-nums}.rer-themed .appt-meta{display:block;color:var(--soft);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.rer-themed .appt-tags{display:flex;flex-wrap:wrap;gap:4px;margin-top:4px}.rer-themed .tag{display:inline-flex;align-items:center;min-height:19px;padding:0 8px;border-radius:var(--radius-chip);background:var(--surface);border:1px solid color-mix(in srgb,currentColor 22%,transparent);font-size:11px;font-weight:500;color:var(--sky-ink)}
.rer-themed .tag.done{background:var(--sage-tint);color:var(--sage-ink)}.rer-themed .tag.todo{background:var(--honey-tint);color:var(--honey-text)}
.rer-themed .appt.st-booked{border-left-color:var(--teal)}
.rer-themed .appt.st-attended{border-color:color-mix(in srgb,var(--sage-ink) 16%,transparent);border-left-color:var(--sage);background:var(--sage-tint)}.rer-themed .appt.st-attended .tag:first-child{color:var(--sage-ink)}
.rer-themed .appt.st-no_show{border-style:dashed;border-left-style:solid;border-left-color:var(--faint);background:var(--row);color:var(--soft)}
.rer-themed .appt.chosen{outline:2px solid var(--teal);outline-offset:1px;z-index:2}.rer-themed .appt.dragging{opacity:.5}.rer-themed .appt[draggable=true]{cursor:grab}
.rer-themed .weekdays{display:flex;flex-wrap:wrap;gap:4px 14px;border:0;padding:0;margin:0}.rer-themed .weekdays legend{margin-bottom:6px}.rer-themed .weekdays .check{gap:6px}
.rer-themed .series-review{margin:0 0 16px}.rer-themed .series-review h3{font-size:16px}.rer-themed .series-review tr.conflict td{background:var(--honey-wash)}.rer-themed .series-review tr.skipped td{color:var(--soft);text-decoration:line-through}
.rer-themed .series-review input[type=time]{min-height:36px;padding:4px 8px;width:auto}.rer-themed .series-review .actions{margin-top:12px}
@media(max-width:700px){.rer-themed .series-review thead{display:none}.rer-themed .series-review table,.rer-themed .series-review tbody{display:block}.rer-themed .series-review tr{display:flex;flex-wrap:wrap;align-items:center;gap:4px 12px;padding:8px 12px;border-bottom:1px solid var(--line)}.rer-themed .series-review td{display:block;border:0;padding:0}.rer-themed .series-review td:first-child{font-weight:600;min-width:100px}.rer-themed .series-review td:nth-child(3){flex-basis:100%;order:3}.rer-themed .series-review .table{overflow:visible}
.rer-themed .cal-card{padding:16px 14px 16px}.rer-themed .cal-title{width:100%;font-size:27px}.rer-themed .cal-filter{width:100%}.rer-themed .cal-filter label{flex:1;min-width:0}.rer-themed .seg{padding:0 12px}}
`
