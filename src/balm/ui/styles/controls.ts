// Forms and actions: quiet 1px fields with a teal focus ring, labels above,
// the deep teal pill as the one primary action and white pills beside it, and
// disclosures that read as teal links.
export const controlsStyle = `
.rer-themed form{display:grid;gap:14px;margin:0}
.rer-themed label{display:grid;gap:6px;color:var(--ink);font-size:13.5px;font-weight:500}
.rer-themed input:not([type=checkbox]):not([type=hidden]):not([type=radio]),.rer-themed select,.rer-themed textarea{box-sizing:border-box;width:100%;min-width:0;min-height:42px;padding:9px 12px;border:1px solid var(--field);border-radius:var(--radius-field);background:var(--surface);color:var(--ink);font:400 14.5px/1.4 var(--font-body);box-shadow:none;transition:border-color .12s ease,box-shadow .12s ease}
.rer-themed select{appearance:none;padding-right:36px}
.rer-themed label:has(>select:last-child){position:relative}.rer-themed label:has(>select:last-child)::after{content:'';position:absolute;right:16px;bottom:18px;width:6px;height:6px;border:solid var(--soft);border-width:0 1.5px 1.5px 0;transform:rotate(45deg);pointer-events:none}
.rer-themed textarea{min-height:120px;resize:vertical;line-height:1.55}
.rer-themed input::placeholder,.rer-themed textarea::placeholder{color:var(--faint)}
.rer-themed input:not([type=checkbox]):not([type=radio]):hover,.rer-themed select:hover,.rer-themed textarea:hover{border-color:var(--soft)}
.rer-themed input:not([type=checkbox]):not([type=radio]):focus,.rer-themed select:focus,.rer-themed textarea:focus{outline:none;border-color:var(--teal);box-shadow:var(--ring)}
.rer-themed input[type=checkbox],.rer-themed input[type=radio]{flex:none;width:18px;height:18px;margin:2px 0 0;accent-color:var(--teal)}
.rer-themed .check,.rer-themed label:has(input[type=checkbox]){display:flex;gap:10px;align-items:flex-start;font-weight:400;font-size:14px;color:var(--body)}
.rer-themed .pair{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,190px),1fr));gap:14px 16px}
.rer-themed button,.rer-themed .button{display:inline-flex;align-items:center;justify-content:center;gap:8px;width:auto;justify-self:start;min-height:42px;padding:0 22px;border:1px solid transparent;border-radius:var(--radius-chip);background:var(--pill);color:#fff;font:600 14.5px/1.2 var(--font-body);text-decoration:none;cursor:pointer;box-shadow:inset 0 1px 0 rgba(255,255,255,.08),0 10px 20px -14px rgba(10,40,38,.7);transition:background-color .12s ease}
.rer-themed button:hover{background:var(--pill-hover)}
.rer-themed button.secondary{background:var(--surface);color:var(--ink);border-color:var(--line-strong);box-shadow:0 1px 2px rgba(23,50,58,.05)}
.rer-themed button.secondary:hover{border-color:var(--soft);background:var(--surface)}
.rer-themed button[disabled]{opacity:.45;cursor:not-allowed}
.rer-themed .actions{display:flex;flex-wrap:wrap;gap:10px;align-items:center}
.rer-themed .actions form{display:block}
.rer-themed .row-actions{display:flex;flex-wrap:wrap;gap:8px;margin:4px 0 12px}
.rer-themed .row-actions button{min-height:36px;padding:0 16px}
.rer-themed details{margin:10px 0 0}
.rer-themed details>summary{display:inline-flex;align-items:center;gap:7px;cursor:pointer;list-style:none;color:var(--teal-ink);font-size:14px;font-weight:500;border-radius:6px}
.rer-themed details>summary::-webkit-details-marker{display:none}
.rer-themed details>summary::before{content:'';width:6px;height:6px;border:solid currentColor;border-width:0 1.6px 1.6px 0;transform:rotate(-45deg);transition:transform .12s ease;margin-right:2px}
.rer-themed details[open]>summary{margin-bottom:12px}
.rer-themed details[open]>summary::before{transform:rotate(45deg)}
.rer-themed details[open]{padding:0 0 4px}
.rer-themed details.confirm>summary{color:var(--coral-ink)}
.rer-themed fieldset{min-width:0;margin:0;padding:0;border:0}
.rer-themed fieldset legend{padding:0;font-weight:600;font-size:13.5px;color:var(--ink)}
.rer-themed fieldset.hours-day,.rer-themed fieldset.question{display:grid;gap:10px;padding:14px 16px 16px;margin:0 0 10px;border:1px solid var(--line);border-radius:12px;background:var(--row)}
.rer-themed fieldset.hours-day legend,.rer-themed fieldset.question legend{float:left;width:100%;margin-bottom:2px}
.rer-themed .charges{display:grid;gap:10px}
.rer-themed .slots{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:16px}
.rer-themed .slot{display:inline-flex;align-items:center;min-height:36px;padding:0 14px;border:1px solid var(--line-strong);border-radius:var(--radius-chip);background:var(--surface);color:var(--ink);font-size:14px;font-weight:500;text-decoration:none}
.rer-themed .slot:hover{border-color:var(--teal)}
.rer-themed .slot.chosen{background:var(--pill);border-color:var(--pill);color:#fff;font-weight:600}
.rer-themed .trap{position:absolute;left:-10000px;width:1px;height:1px;overflow:hidden}
@media(max-width:700px){.rer-themed button:not(.secondary){justify-self:stretch}.rer-themed .actions>form,.rer-themed .actions>form button{width:100%}}
`
