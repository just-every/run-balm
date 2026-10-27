// The frame's layout: the left rail, the top bar and the page area; on phones the
// rail is a header whose menu (a checkbox and its label, no script) opens below it.
// The public pages (booking, intake, offers) share the lockup over one column.
export const shellStyle = `
.app{display:grid;grid-template-columns:228px minmax(0,1fr);min-height:100vh}
.rail{background:var(--rail);border-right:1px solid var(--line)}
.rail-inner{position:sticky;top:0;height:100vh;display:flex;flex-direction:column;padding:24px 14px 18px;overflow-y:auto}
.rail-head{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:0 10px}
.brand{text-decoration:none;color:var(--ink)}
.lockup{display:inline-flex;align-items:center;gap:12px;font:500 34px/1 var(--rer-font-heading);letter-spacing:-.02em;color:var(--ink);font-variation-settings:'opsz' 48}
.lockup img{width:36px;height:42px;margin-top:-5px}
.menu-button,.menu-toggle{display:none}
.rail-body{display:flex;flex-direction:column;flex:1;min-height:0}
.rail-nav{display:grid;gap:5px;margin-top:34px}
.rail-nav a{display:flex;align-items:center;gap:20px;min-height:48px;padding:0 16px;border-radius:10px;color:var(--body);font-size:16px;font-weight:450;text-decoration:none}
.rail-nav a .icon{width:23px;height:23px;color:var(--soft)}
.rail-nav a:hover{background:var(--hover);color:var(--ink)}
.rail-nav a[aria-current=page]{background:var(--sage-tint);color:var(--ink);font-weight:600}.rail-nav a[aria-current=page] .icon{color:var(--ink)}
.rail-nav span:not(.count){min-width:0}
.count{margin-left:auto;min-width:24px;height:24px;padding:0 7px;display:inline-grid;place-items:center;border-radius:12px;background:var(--row);color:var(--ink);font-size:13px;font-weight:600;font-variant-numeric:tabular-nums}
.count.honey{background:var(--honey-tint);color:var(--honey-ink)}.count.coral{background:var(--coral-tint);color:var(--coral-ink)}
.rail-foot{margin-top:auto;padding:18px 10px 0;border-top:1px solid var(--line)}
.rail-foot .clinic{display:flex;align-items:flex-start;gap:8px;margin:0 0 14px;font:500 17px/1.25 var(--rer-font-heading);letter-spacing:-.01em;color:var(--ink)}
.rail-foot .clinic .icon{width:17px;height:17px;margin-top:2px;color:var(--teal-ink)}
.me{display:flex;align-items:center;gap:10px;min-width:0}.me>div{min-width:0}
.me strong{display:block;font-size:13px;line-height:1.3;overflow-wrap:anywhere}.me span:not(.avatar){display:block;font-size:13px;line-height:1.35;color:var(--soft);overflow-wrap:anywhere}
.me-actions{display:flex;flex-wrap:wrap;align-items:center;gap:4px 10px;margin-top:10px;font-size:13px}.me-actions a{color:var(--body)}
.me-actions button.quiet{min-height:30px;padding:0 6px;margin-left:-6px;font-size:13px}.me-actions .icon{width:16px;height:16px}
.avatar{flex:none;width:34px;height:34px;display:inline-grid;place-items:center;border-radius:50%;background:linear-gradient(135deg,var(--sage-tint),var(--sky-tint));color:var(--ink);font-size:13px;font-weight:600;letter-spacing:.02em}
.workspace{min-width:0;display:flex;flex-direction:column}
.topbar{display:flex;align-items:center;gap:14px 18px;min-height:78px;padding:12px 24px;border-bottom:1px solid var(--line);background:color-mix(in srgb,var(--rer-surface) 55%,transparent)}
.topbar .crumb{display:flex;align-items:center;gap:8px;min-width:0;color:var(--soft);font-size:14px}.topbar .crumb a{color:var(--soft)}.topbar .crumb strong{color:var(--ink);font-weight:500}
.topbar .grow{flex:1}
.datenav{display:flex;align-items:center;gap:6px;min-width:0}
.datenav a.step{display:inline-grid;place-items:center;width:34px;height:34px;border-radius:9px;color:var(--ink)}.datenav a.step:hover{background:var(--hover)}.datenav .icon{width:18px;height:18px}
.datenav strong{padding:0 6px;font-size:19px;font-weight:450;letter-spacing:-.01em;white-space:nowrap;font-variant-numeric:tabular-nums}
.button.new{min-height:44px;padding:0 18px;border-radius:16px;font-size:16px;box-shadow:inset 0 1px 0 rgba(255,255,255,.08),0 10px 22px -14px rgba(10,40,38,.65)}.button.new .icon{width:19px;height:19px}
main{display:block;min-width:0;padding:16px 20px 48px}
#content{min-width:0}
main.public{max-width:760px;margin:0 auto;padding:28px 20px 64px}
.public-head{display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap;margin:0 0 28px;padding-bottom:18px;border-bottom:1px solid var(--line)}
.public-head .clinic{color:var(--soft);font-size:14px}
body.public-page{background:radial-gradient(50% 36% at 100% 0%,var(--sky-wash),transparent 70%),radial-gradient(40% 36% at 0% 100%,var(--sage-wash),transparent 70%),var(--rer-page)}
@media(max-width:900px){
.app{display:block}
.rail{border-right:0;border-bottom:1px solid var(--line)}.rail-inner{position:static;height:auto;padding:12px 16px}
.rail-head{padding:0}
.lockup{font-size:26px}.lockup img{width:26px;height:26px}
.menu-button{display:inline-flex;align-items:center;gap:6px;min-height:40px;padding:0 12px;border:1px solid var(--line-strong);border-radius:10px;background:var(--rer-surface);color:var(--ink);font-size:13.5px;font-weight:600;cursor:pointer}
.menu-button .icon{width:18px;height:18px}
.rail-body{display:none}
.menu-toggle{display:block;position:absolute;width:1px;height:1px;opacity:0;pointer-events:none}
.menu-toggle:checked~.rail-body{display:flex}
.menu-toggle:focus-visible+.rail-head .menu-button{outline:3px solid color-mix(in srgb,var(--rer-focus) 70%,transparent);outline-offset:2px}
.rail-nav{margin-top:12px}
.rail-foot{margin-top:12px;padding-top:14px}
.topbar{padding:12px 16px;min-height:0;flex-wrap:wrap}
main{padding:18px 16px 48px}
}
@media(max-width:600px){.datenav strong{font-size:16px}.button.new{min-height:40px;padding:0 14px;font-size:14px}}
`
