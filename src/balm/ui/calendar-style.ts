// The calendar's layout in the owner-picked look. Grid placement uses generated
// classes (rs = row start, re = rows spanned, cs = column, n = column count),
// never inline styles, so the hashed style policy stays as strict as the rest of
// the app. Rows are 15 minutes; the labels and lines fall on the half hour.
const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i)
const placement = range(1, 97).map(n => `.rs${n}{grid-row-start:${n}}`).join('')
  + range(1, 96).map(n => `.re${n}{grid-row-end:span ${n}}`).join('')
  + range(1, 41).map(n => `.cs${n}{grid-column-start:${n}}`).join('')
  + range(1, 40).map(n => `.cal.n${n}{grid-template-columns:${n > 3 ? 64 : 88}px repeat(${n},minmax(${n > 1 ? 172 : 220}px,1fr))}`).join('')
  // The week fits its card: seven day columns share the width, and the booking panel moves under the grid.
  + '.cal.wk.n7{grid-template-columns:64px repeat(7,minmax(0,1fr))}'

export const calendarStyle = placement + `
[hidden]{display:none!important}
.view-options{position:relative;flex:none;align-self:center}.view-options>summary{display:flex;align-items:center;justify-content:space-between;gap:24px;min-width:145px;min-height:42px;padding:8px 16px;border:1px solid var(--line);border-radius:15px;background:var(--rer-surface);color:var(--ink);cursor:pointer;list-style:none}.view-options>summary{margin:0;font-weight:500}.view-options>summary::before,.view-options>summary::-webkit-details-marker{display:none}.view-options>summary .icon{width:16px;height:16px;transform:rotate(90deg)}.view-options[open]>.cal-controls{position:absolute;right:0;top:48px;z-index:8;width:310px;padding:16px;background:var(--rer-surface);border:1px solid var(--line);border-radius:14px;box-shadow:var(--shadow-float)}
.cal-controls{display:flex;flex-wrap:wrap;align-items:flex-end;gap:10px}
.cal-nav{display:inline-flex;padding:3px;border:1px solid var(--line);border-radius:12px;background:var(--rer-surface)}
.seg{display:inline-flex;align-items:center;min-height:32px;padding:0 13px;border-radius:9px;color:var(--body);font-size:13.5px;font-weight:500;text-decoration:none}.seg:hover{background:var(--hover);color:var(--ink)}
.seg.on{background:var(--sage-tint);color:var(--ink);font-weight:600}
.cal-filter{display:flex;gap:8px;align-items:flex-end}.cal-filter label{font-size:12.5px;color:var(--soft);font-weight:500}.cal-filter select{min-height:38px;min-width:170px}.cal-filter button{min-height:38px}
.cal-wrap{overflow-x:auto;background:var(--rer-surface);border:1px solid var(--line);border-radius:var(--radius-card);box-shadow:var(--shadow-card)}
.cal{display:grid;grid-template-rows:60px;grid-auto-rows:19px;position:relative;min-width:100%}
.cal-head{position:sticky;top:0;z-index:3;display:flex;align-items:center;gap:10px;min-width:0;padding:8px 14px;background:var(--rer-surface);border-bottom:1px solid var(--line);border-left:1px solid var(--line)}
.cal-head.cs1{left:0;z-index:4;border-left:0;color:var(--soft);font-size:13px}
.cal-head span{min-width:0}.cal-head strong{display:block;font-size:13.5px;font-weight:600;line-height:1.3;color:var(--ink)}.cred{white-space:nowrap}.cal-head small{display:block;font-size:12px;line-height:1.3;color:var(--soft)}
.cal-head a{text-decoration:none}.cal-head.is-today{background:var(--sage-wash)}
.cal-head .avatar{width:40px;height:40px}
.cal-time{position:sticky;left:0;z-index:2;padding:6px 6px 0 18px;font-size:12px;line-height:1.2;white-space:nowrap;color:var(--soft);background:var(--rer-surface);border-top:1px dashed var(--line);font-variant-numeric:tabular-nums}
.cell{min-width:0;border-left:1px solid var(--line)}.cell.hour,.cell.half{border-top:1px dashed var(--line)}
.cell[data-book]{cursor:pointer}.cell[data-book]:hover{background:var(--sky-wash)}
.cell.off{background:repeating-linear-gradient(135deg,var(--row) 0 5px,transparent 5px 11px)}
.cell.drop{outline:2px solid var(--teal);outline-offset:-2px;background:var(--sky-wash)}

/* Visit cards: a tinted card with its hairline, a status glyph, time, name and chips. */
.appt{--card:var(--sky-wash);--edge:var(--sky-tint);--glyph:var(--sky-ink);--chip:var(--sky-tint);position:relative;z-index:1;container-type:inline-size;display:flex;align-items:flex-start;gap:8px;min-width:0;margin:2px 7px 2px;padding:2px 10px;overflow:hidden;border:1px solid var(--edge);border-left:2px solid var(--edge);border-radius:6px;background:linear-gradient(110deg,var(--card),color-mix(in srgb,var(--card) 85%,white));color:var(--ink);text-decoration:none;font-size:13px;line-height:1.3}
.appt:hover{border-color:color-mix(in srgb,var(--glyph) 45%,var(--edge));box-shadow:0 6px 16px -12px rgba(23,50,58,.4)}
.appt .mark{width:17px;height:17px;margin-top:1px;color:var(--glyph)}
.appt .go{width:14px;height:14px;align-self:center;margin-left:auto;color:var(--soft)}
.appt-copy{display:flex;flex-direction:column;min-width:0;flex:1}
.appt-time{font-size:11.5px;line-height:14px;color:var(--body);font-variant-numeric:tabular-nums;white-space:nowrap}.appt-time .t-from{font-weight:500;color:var(--ink)}
.appt strong{font-size:13.5px;line-height:18px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.appt-tags{display:flex;flex-wrap:wrap;gap:4px 5px;height:16px;margin-top:1px;min-width:0;overflow:hidden}
/* A chip that does not fit its card's one chip row wraps out of sight whole, never cut: the zero-width lead item lets even
   the first chip wrap to the hidden second line. */
.appt-tags::before{content:'';flex:none;width:0;height:100%;margin-right:-5px}
.appt .tag{display:inline-block;flex:none;max-width:none;white-space:nowrap;background:var(--chip);color:var(--body);font-size:11px;line-height:16px;padding:0 5px;border-radius:5px}
.appt .tag.coral{background:var(--coral-tint);color:var(--coral-ink)}.appt .tag.sage{background:var(--sage-tint);color:var(--sage-ink)}.appt .tag.honey{background:var(--honey-tint);color:var(--honey-ink)}
.appt .tag.k3{display:none}.appt .tag .brief{display:none}
@container (max-width:185px){.appt .go{display:none}}
@container (max-width:215px){.appt .mark{display:none}.appt.size1 .t-to,.appt.size2 .t-to{display:none}}
.appt.size1{padding:2px 8px;align-items:center}.appt.size1 .appt-copy{flex-direction:row;gap:6px;align-items:baseline}.appt.size1 .appt-tags,.appt.size1 .mark{display:none}
.appt.size2{padding:1px 8px}.appt.size2 strong{line-height:16px}.appt.size2 .appt-tags{height:14px}.appt.size2 .tag{line-height:14px;font-size:11px}.appt.size2 .appt-copy{display:grid;grid-template-columns:auto minmax(0,1fr);grid-template-areas:'time name' 'tags tags';column-gap:6px;align-items:baseline}.appt.size2 strong{grid-area:name}.appt.size2 .appt-time{grid-area:time}.appt.size2 .appt-tags{grid-area:tags;margin:1px 0 0}.appt.size2 .mark{display:none}
/* A narrow half-hour card keeps its start time and the whole name: time and the first chip on one line, the name under them.
   Its flag chip takes its short form so the note state still fits beside it. */
@container (max-width:215px){.appt.size2 .appt-copy{grid-template-areas:'time tags' 'name name'}.appt.size2 .appt-tags{margin:0;align-self:center}.appt.size2 .tag .full{display:none}.appt.size2 .tag .brief{display:inline}}
.appt.tone-sage{--card:var(--sage-wash);--edge:var(--sage-tint);--glyph:var(--check);--chip:var(--sage-tint)}
.appt.tone-honey{--card:var(--rer-surface);--edge:var(--line-strong);--glyph:var(--honey-ink);--chip:var(--row);border-left-color:var(--honey)}
.appt.tone-coral{--card:var(--coral-wash);--edge:var(--coral-tint);--glyph:var(--coral);--chip:var(--coral-tint)}
.appt.tone-muted{--card:var(--row);--edge:var(--line-strong);--glyph:var(--soft);--chip:var(--line);border-style:dashed;border-left-style:solid;color:var(--body)}
.appt.chosen{box-shadow:0 0 0 2px var(--rer-surface),0 0 0 4px color-mix(in srgb,var(--glyph) 60%,transparent);z-index:2}
.appt.dragging{opacity:.5}.appt[draggable=true]{cursor:grab}
.openslot{position:relative;z-index:1;display:flex;align-items:flex-start;gap:8px;margin:2px 7px 2px;padding:4px 10px;border:1px dashed color-mix(in srgb,var(--sky) 70%,transparent);border-radius:8px;background:color-mix(in srgb,var(--sky-wash) 70%,var(--rer-surface));color:var(--sky-ink);text-decoration:none;overflow:hidden}
.openslot:hover{border-style:solid;background:var(--sky-wash)}
.openslot .icon{width:17px;height:17px;margin-top:1px}.openslot span{min-width:0}
.openslot.compact{align-items:center;padding-top:2px;padding-bottom:2px}.openslot.compact span{display:flex;gap:8px;align-items:baseline;flex-wrap:wrap;height:18px;overflow:hidden}.openslot strong{display:block;font-size:13px;line-height:17px;font-weight:500;color:var(--ink)}.openslot small{display:block;font-size:11.5px;line-height:16px;color:var(--body);white-space:nowrap}

/* The phone agenda (agenda.ts): the grid's cards in time order, one column at a time. */
.agenda{display:none}
@media(max-width:600px){
.cal-wrap{display:none}.agenda{display:block}
.ag-pick{display:flex;flex-wrap:wrap;gap:6px;margin:0 0 10px;padding:2px}
.ag-radio{position:absolute;opacity:0;width:1px;height:1px;pointer-events:none}
.ag-pick label{display:inline-flex;align-items:center;gap:6px;flex:none;min-height:36px;padding:0 12px;border:1px solid var(--line);border-radius:999px;background:var(--rer-surface);color:var(--body);font-size:13.5px;font-weight:500;cursor:pointer}
.ag-pick label small{font-size:12px;color:var(--soft);font-variant-numeric:tabular-nums}
.ag-radio:checked+label{background:var(--sage-tint);border-color:var(--sage-tint);color:var(--ink);font-weight:600}.ag-radio:focus-visible+label{outline:3px solid var(--rer-focus);outline-offset:2px}
.ag-col{display:none}.ag-col.only{display:block}
${range(0, 39).map(i => `.agenda:has(#ag-${i}:checked) .ag-${i}{display:block}`).join('')}
.ag-col,.ag-day{padding:12px;background:var(--rer-surface);border:1px solid var(--line);border-radius:var(--radius-card);box-shadow:var(--shadow-card)}.ag-day{margin:0 0 10px}.ag-day.is-today{border-color:var(--sage-tint)}
.ag-col h3,.ag-day h3{display:flex;align-items:center;gap:10px;margin:0 0 10px;font-size:15px;font-weight:600;line-height:1.3}.ag-col h3 small,.ag-day h3 small{display:block;font-size:12.5px;font-weight:400;color:var(--soft)}.ag-day h3 small{margin-left:auto}.ag-day h3 a{color:var(--ink);text-decoration:none}
.ag-today{padding:0 7px;border-radius:6px;background:var(--sage-tint);color:var(--sage-ink);font-size:12px;font-weight:600}
.ag-empty{display:flex;justify-content:space-between;gap:10px;margin:0 0 8px;padding:10px 12px;border:1px solid var(--line);border-radius:12px;background:var(--rer-surface);font-size:14px}.ag-empty a{color:var(--ink);text-decoration:none;font-weight:500}.ag-empty small{font-size:12.5px;color:var(--soft)}
.ag-list{list-style:none;margin:0;padding:0;display:grid;gap:6px}.ag-none{margin:0;color:var(--soft);font-size:13.5px}
.appt.ag{margin:0;padding:8px 10px}.appt.ag .appt-time{font-size:12.5px;line-height:16px}.appt.ag strong{font-size:14.5px;line-height:20px;white-space:normal}
.appt.ag .appt-tags{height:auto;flex-wrap:wrap;margin-top:4px}.appt.ag .tag{max-width:100%;white-space:normal}.appt.ag .tag.k3{display:inline-block}.appt.ag .mark{display:block}
.agenda .openslot{margin:0;padding:8px 10px}.agenda .openslot small{white-space:normal}
}
.weekdays{display:flex;flex-wrap:wrap;gap:4px 14px;border:0;padding:0;margin:0}.weekdays legend{font-weight:500;margin-bottom:6px;padding:0}.weekdays .check{gap:6px}
.series-review{margin:0 0 16px}.series-review h3{font-size:15px}.series-review tr.conflict td{background:var(--honey-wash)}.series-review tr.skipped td{color:var(--soft);text-decoration:line-through}
.series-review input[type=time]{min-height:36px;padding:4px 8px;width:auto}.series-review .actions{margin-top:12px}
@media(max-width:600px){.series-review thead{display:none}.series-review table,.series-review tbody{display:block}.series-review tr{display:flex;flex-wrap:wrap;align-items:center;gap:4px 12px;padding:8px 0;border-bottom:1px solid var(--line)}.series-review td{display:block;border:0;padding:0}.series-review td:first-child{font-weight:600;min-width:100px}.series-review td:nth-child(3){flex-basis:100%;order:3}.series-review .table{overflow:visible}.view-options[open]>.cal-controls{left:0;right:auto;width:min(310px,calc(100vw - 44px))}.cal-filter{width:100%}.cal-filter label{flex:1}.cal-filter select{min-width:0}}
`
