// The app's type, cards, forms, chips, tables and notices, in the owner-picked
// look. Every colour is a token from public/rer-theme.css or public/fonts/fonts.css.
export const baseStyle = `
*,*::before,*::after{box-sizing:border-box}
html{-webkit-text-size-adjust:100%;background:var(--rer-page)}
body{margin:0;min-height:100vh;background:var(--rer-page);color:var(--ink);font:400 14px/1.5 var(--rer-font-body);-webkit-font-smoothing:antialiased;font-feature-settings:'cv11','ss01';overflow-x:clip}
a{color:var(--rer-link);text-underline-offset:3px;text-decoration-thickness:1px}a:hover{text-decoration-thickness:2px}
:focus-visible{outline:3px solid color-mix(in srgb,var(--rer-focus) 70%,transparent);outline-offset:2px;border-radius:6px}
.sprite{position:absolute;width:0;height:0;overflow:hidden}
.icon{width:20px;height:20px;flex:none;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}
.skip{position:absolute;left:16px;top:-80px;z-index:20;padding:10px 16px;border-radius:10px;background:var(--pill);color:var(--rer-accent-text);font-weight:600;text-decoration:none}.skip:focus{top:12px}
h1,h2,h3,h4{color:var(--ink);margin:0;text-wrap:balance}
h1{font:500 40px/1.1 var(--rer-font-heading);letter-spacing:-.025em;font-variation-settings:'opsz' 72;margin:0 0 8px}
h2{font-size:16px;line-height:1.35;font-weight:600;letter-spacing:-.01em;margin:0 0 14px}
h3{font-size:14.5px;line-height:1.4;font-weight:600;margin:0 0 4px}
h4{font-size:13.5px;font-weight:600;margin:14px 0 6px}
p{margin:0 0 12px;color:var(--body);text-wrap:pretty}
#content>p,.lede{max-width:780px;font-size:15px;color:var(--body)}
ul,ol{margin:0 0 12px;padding-left:20px}
code,pre{font-family:var(--rer-font-mono);font-size:13px}code{overflow-wrap:anywhere}
strong{font-weight:600;color:var(--ink)}
.help{font-size:13px;color:var(--soft)}
p.help{margin-bottom:10px}
.tnum,time,.money{font-variant-numeric:tabular-nums}

/* Cards: white, a hairline and a soft shadow. */
.panel{min-width:0;margin:0 0 20px;padding:20px 22px;background:var(--rer-surface);border:1px solid var(--line);border-radius:var(--radius-card);box-shadow:var(--shadow-card)}
.panel>h2:first-child{display:flex;align-items:center;gap:8px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,380px),1fr));gap:20px;align-items:start}.grid>.panel{margin:0}
.full{grid-column:1/-1}
.entry{min-width:0;padding:14px 0;border-top:1px solid var(--line)}.entry:first-of-type{border-top:0;padding-top:2px}.entry:last-child{padding-bottom:0}
.entry p{margin-bottom:8px}.entry details{margin-top:10px}.entry form+form{margin-top:10px}
.plain{list-style:none;padding:0;margin:0 0 12px}.plain li{padding:9px 0;border-top:1px solid var(--line)}.plain li:first-child{border-top:0;padding-top:2px}
.steps{padding-left:20px}.steps li{margin-bottom:8px;color:var(--body)}.steps li.done{color:var(--soft)}
.empty{margin:0;padding:18px;border:1px dashed var(--line-strong);border-radius:10px;background:var(--row);color:var(--soft);font-size:13.5px}
.stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin:20px 0}
.stat{min-width:0;padding:16px 18px;background:var(--rer-surface);border:1px solid var(--line);border-radius:var(--radius-card);box-shadow:var(--shadow-card)}
.stat .label{display:block;font-size:13px;color:var(--soft)}.stat .value{display:block;margin-top:4px;font:500 30px/1.1 var(--rer-font-heading);font-variant-numeric:tabular-nums;color:var(--ink)}

/* Chips: quiet by default; sage done, honey waiting, sky booked, coral only for an exception. */
.status,.tag{display:inline-flex;align-items:center;gap:4px;max-width:100%;padding:1px 8px;border-radius:var(--radius-chip);background:var(--row);color:var(--body);font-size:13px;line-height:18px;font-weight:500;white-space:nowrap;vertical-align:1px}
.status{margin:0 4px 4px 0}
.status.sage,.tag.sage{background:var(--sage-tint);color:var(--sage-ink)}
.status.honey,.tag.honey{background:var(--honey-tint);color:var(--honey-ink)}
.status.sky,.tag.sky{background:var(--sky-tint);color:var(--sky-ink)}
.status.coral,.tag.coral{background:var(--coral-tint);color:var(--coral-ink)}

/* Forms: thin quiet fields, a clear teal focus ring. */
form{display:grid;gap:14px;margin:0}
form>p{margin:0}
label{display:grid;gap:6px;font-size:13px;font-weight:500;color:var(--ink);min-width:0}
input:not([type=checkbox]):not([type=radio]):not([type=hidden]),select,textarea{width:100%;min-width:0;min-height:40px;padding:8px 12px;border:1px solid var(--field);border-radius:8px;background:var(--rer-surface);color:var(--ink);font:400 14px/1.4 var(--rer-font-body);transition:border-color .15s,box-shadow .15s}
input[type=file]{padding:7px 10px}
/* Base's shared select rule (runeditrun/base #247): two gradient strokes draw the chevron about 14 px inside the right
   border with 40 px end padding, in the theme's soft ink. Gradients, not an SVG data URI, which the theme frame's CSP blocks. */
select:not([multiple],[size]:not([size="1"])){--rer-select-ink:var(--soft);appearance:none;-webkit-appearance:none;background-image:linear-gradient(to top right,transparent calc(50% - 1.1px),var(--rer-select-ink) calc(50% - .55px),var(--rer-select-ink) calc(50% + .55px),transparent calc(50% + 1.1px)),linear-gradient(to top left,transparent calc(50% - 1.1px),var(--rer-select-ink) calc(50% - .55px),var(--rer-select-ink) calc(50% + .55px),transparent calc(50% + 1.1px));background-repeat:no-repeat;background-position:right 20px center,right 14px center;background-size:6px 6px;padding-inline-end:40px;text-overflow:ellipsis}select:not([multiple],[size]:not([size="1"])):dir(rtl){background-position:left 14px center,left 20px center}select:not([multiple],[size]:not([size="1"])):focus-visible{--rer-select-ink:var(--ink)}select:not([multiple],[size]:not([size="1"])):disabled{--rer-select-ink:color-mix(in srgb,var(--soft) 55%,transparent);cursor:not-allowed}@media(forced-colors:active){select:not([multiple],[size]:not([size="1"])){--rer-select-ink:ButtonText}}
textarea{min-height:120px;resize:vertical;line-height:1.5}
input::placeholder,textarea::placeholder{color:var(--soft);opacity:.8}
input:hover:not(:focus),select:hover:not(:focus),textarea:hover:not(:focus){border-color:var(--rer-border)}
input:not([type=checkbox]):not([type=radio]):focus-visible,select:focus-visible,textarea:focus-visible{outline:none;border-color:var(--teal);box-shadow:0 0 0 3px color-mix(in srgb,var(--teal) 22%,transparent)}
input[type=checkbox],input[type=radio]{width:16px;height:16px;margin:2px 0 0;flex:none;accent-color:var(--pill)}
.check{display:flex;gap:10px;align-items:flex-start;font-weight:400;color:var(--body);font-size:13.5px}
.pair{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,180px),1fr));gap:14px}
fieldset{min-width:0;margin:0;padding:14px 16px 6px;border:1px solid var(--line);border-radius:10px}fieldset legend{padding:0 6px;font-size:13px;font-weight:600;color:var(--ink)}
.charges{border:0;padding:0}.charges legend{padding:0}
fieldset.hours-day,fieldset.question{margin:0 0 12px}fieldset .check{margin-bottom:8px}
.weekdays{display:flex;flex-wrap:wrap;gap:6px 14px;border:0;padding:0}.weekdays .check{gap:6px}
.trap{position:absolute;left:-10000px;width:1px;height:1px;overflow:hidden}

/* Buttons: the deep navy-green pill, a white hairline secondary, and a quiet text button. */
button,.button{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:40px;padding:0 16px;border:1px solid transparent;border-radius:10px;background:var(--pill);color:var(--rer-accent-text);font:600 14px/1 var(--rer-font-body);text-decoration:none;cursor:pointer;justify-self:start;white-space:nowrap;transition:background-color .15s,border-color .15s}
button:hover,.button:hover{background:var(--pill-hover);text-decoration:none}
button.secondary,.button.secondary{background:var(--rer-surface);color:var(--ink);border-color:var(--line-strong)}button.secondary:hover,.button.secondary:hover{background:var(--hover);border-color:var(--field)}
button.quiet{min-height:32px;padding:0 8px;background:transparent;color:var(--body);font-weight:500}button.quiet:hover{background:var(--hover)}
button[disabled]{opacity:.45;cursor:not-allowed}
.actions{display:flex;flex-wrap:wrap;gap:8px;align-items:center}.actions form{display:block}
form+.actions,.actions+.actions,.actions+form{margin-top:10px}
.row-actions{display:flex;flex-wrap:wrap;gap:8px;margin:4px 0 12px}

/* Disclosures read as quiet links with a turning chevron. */
details{min-width:0}
summary{display:flex;align-items:center;gap:6px;width:max-content;max-width:100%;padding:4px 0;color:var(--teal-ink);font-weight:600;font-size:13.5px;cursor:pointer;list-style:none}
summary::-webkit-details-marker{display:none}
summary::before{content:'';width:6px;height:6px;margin:0 4px 0 2px;border-right:1.7px solid currentColor;border-bottom:1.7px solid currentColor;transform:rotate(-45deg);transition:transform .15s;flex:none}
details[open]>summary{margin-bottom:10px}details[open]>summary::before{transform:rotate(45deg)}
details.confirm{margin-top:10px}

/* Notices: sage for done, coral for a refusal. */
.notice{margin:0 0 18px;padding:12px 16px;border:1px solid var(--sage-tint);border-left:3px solid var(--sage);border-radius:10px;background:var(--sage-wash);color:var(--body)}
.notice.error{border-color:var(--coral-tint);border-left-color:var(--coral);background:var(--coral-wash);color:var(--ink)}
.notice h2{margin-bottom:8px}.notice ul{margin:8px 0}

/* Records: tables, notes, answers and code. */
.table{overflow-x:auto}
table{width:100%;border-collapse:collapse;font-size:13px}
th{padding:8px 10px;border-bottom:1px solid var(--line-strong);color:var(--soft);font-size:13px;font-weight:500;text-align:left;vertical-align:bottom}
td{padding:9px 10px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top;overflow-wrap:anywhere;font-variant-numeric:tabular-nums}
tr:last-child td{border-bottom:0}
table.units th,table.units td:not(:nth-child(2)){white-space:nowrap;overflow-wrap:normal}
pre{max-width:100%;margin:0 0 12px;padding:12px 14px;white-space:pre-wrap;overflow-wrap:anywhere;background:var(--row);border:1px solid var(--line);border-radius:10px;line-height:1.55;color:var(--body)}
.note{margin:0 0 10px;padding:12px 14px;white-space:pre-wrap;overflow-wrap:anywhere;background:var(--row);border:1px solid var(--line);border-radius:10px;color:var(--body)}
.secure-body,.waiver-text{white-space:pre-wrap;overflow-wrap:anywhere}
dl.answers{display:block;margin:0}.answers dt{margin-top:10px;font-size:13px;font-weight:600;color:var(--ink)}.answers dd{margin:2px 0 0;white-space:pre-wrap;overflow-wrap:anywhere;color:var(--body)}
.signature{margin-top:10px}
.copy{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:6px 8px;align-items:end;margin:8px 0 12px}.copy label{grid-column:1/-1}.copy input,.copy textarea{font-family:var(--rer-font-mono);font-size:13px}
.copy input{min-width:0;width:100%}.notice .copy{margin:10px 0 4px}.notice .copy label{font-weight:600;color:var(--ink)}.notice .copy input{background:var(--rer-surface)}.notice a{overflow-wrap:anywhere}.open-intake{font-size:13.5px}
small.code{margin-left:4px;font-size:13px;font-weight:400;color:var(--soft);font-variant-numeric:tabular-nums;white-space:nowrap}
nav.pager{display:flex;flex-wrap:wrap;align-items:center;gap:8px 16px;margin:12px 0}
.slots{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:16px}
.slot{display:inline-flex;min-height:36px;align-items:center;padding:0 14px;border:1px solid var(--line-strong);border-radius:9px;background:var(--rer-surface);color:var(--ink);font-weight:500;text-decoration:none;font-variant-numeric:tabular-nums}.slot:hover{border-color:var(--teal);background:var(--hover)}
.slot.chosen{border-color:var(--pill);background:var(--pill);color:var(--rer-accent-text)}
.exercise-image{width:160px;max-width:100%;height:120px;object-fit:contain;border-radius:8px}
@media(max-width:600px){h1{font-size:32px}.panel{padding:16px}.stats{grid-template-columns:repeat(2,minmax(0,1fr))}.stat .value{font-size:26px}}
`
