// The patient portal in the app's look: the same rail and cards, the patient's visits,
// home program, forms, statements and the care-team thread. Tokens only.
export const portalStyle = `
html{scroll-behavior:smooth}
.portal-section p>a,.portal-section article a{display:inline-flex;min-height:24px;align-items:center}

.portal-top{margin:0 0 22px;padding-top:18px}.portal-top h1{margin:0 0 4px}.portal-top p{margin:0;font-size:15px}
.portal-notice{margin:0 0 18px;padding:12px 16px;border:1px solid var(--sage-tint);border-left:3px solid var(--sage);border-radius:10px;background:var(--sage-wash);color:var(--body)}
.portal-error{border-color:var(--coral-tint);border-left-color:var(--coral);background:var(--coral-wash);color:var(--ink)}
.columns{display:grid;grid-template-columns:minmax(0,1.4fr) minmax(0,1fr);gap:20px;align-items:start}
.left{display:grid;gap:20px;min-width:0}
.card{min-width:0;padding:20px 22px;background:var(--rer-surface);border:1px solid var(--line);border-radius:var(--radius-card);box-shadow:var(--shadow-card)}
.card h2{margin:0 0 12px}
.portal-section article+article{margin-top:14px;padding-top:14px;border-top:1px solid var(--line)}
.portal-section form{margin:10px 0}
.eyebrow{margin:0 0 4px;font-size:12px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:var(--teal-ink)}
.visit-item h3{margin:0 0 2px;font-variant-numeric:tabular-nums}.visit-item p{margin:0}
.intro{margin:-4px 0 14px;color:var(--body)}
.exercise-row{display:grid;grid-template-columns:120px minmax(0,1fr) auto;gap:16px;align-items:start;padding:14px 0;border-top:1px solid var(--line)}
.exercise-row:not(:has(img)){grid-template-columns:minmax(0,1fr) auto}.exercise-row img{width:120px;height:90px;object-fit:contain;border-radius:8px;background:var(--row)}
.exercise-text{min-width:0}.exercise-text h3{margin:0 0 2px}.exercise-text p{margin:0 0 4px;font-size:13px}.reps{color:var(--ink)}
.instructions,.bubble{white-space:pre-wrap;overflow-wrap:anywhere}
.completion{font-size:12px;color:var(--sage-ink)}.completed{color:var(--sage-ink);font-weight:600;white-space:nowrap}
.row-actions{flex:none;margin:0}.row-actions form{margin:0}
.balance{margin:0 0 8px;font:500 30px/1.1 var(--rer-font-heading);font-variant-numeric:tabular-nums;color:var(--ink)}.balance span{font:400 14px var(--rer-font-body);color:var(--soft)}
.care{padding:0;overflow:hidden}.care-header{padding:20px 22px 0}.care-header p{margin:2px 0 0}
.thread{padding:18px 22px}
.message{display:grid;grid-template-columns:34px minmax(0,1fr);gap:10px;margin-bottom:18px}.message:last-child{margin-bottom:0}
.message-name{margin:0;font-size:13.5px;font-weight:600}.message time{display:block;font-size:12px;color:var(--soft)}
.bubble{margin:6px 0 0;padding:10px 14px;border-radius:10px;background:var(--sage-wash);font-size:13.5px;color:var(--body)}.self .bubble{background:var(--row)}
.composer{padding:16px 22px 20px;border-top:1px solid var(--line)}.composer form{display:grid;gap:10px}
.emergency{margin:0;font-size:12px;color:var(--soft)}
main.signin{max-width:480px}.signin h1{margin:0 0 16px}
@media(max-width:1100px){.columns{grid-template-columns:minmax(0,1fr)}}
@media(max-width:600px){.exercise-row{grid-template-columns:88px minmax(0,1fr)}.exercise-row img{width:88px;height:66px}.row-actions{grid-column:2}.exercise-row:not(:has(img)){grid-template-columns:minmax(0,1fr)}.exercise-row:not(:has(img)) .row-actions{grid-column:1}.card{padding:16px}}
`
