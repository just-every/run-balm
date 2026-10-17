// The page frame every signed-in and public page shares: ivory paper with the
// homepage's warm glow, the Balm lockup, the identity line and the tab row.
// Tokens come from /rer-theme.css and /tokens.css; Base's frame style is
// overridden where the app is wider than Base's centred card.
export const shellStyle = `
.rer-themed{color-scheme:light;background:var(--paper)}
.rer-themed body{margin:0;padding:0;min-height:100vh;background:var(--glow),var(--paper);background-attachment:fixed;color:var(--ink);font:400 15px/1.55 var(--font-body);font-feature-settings:'calt' 0;-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}
.rer-themed main{max-width:1376px;margin:0 auto;padding:18px 32px 72px;background:none;border-radius:0;box-shadow:none;overflow-wrap:anywhere}
.rer-themed main.public{max-width:800px}
.rer-themed a{color:var(--teal-ink);text-underline-offset:3px;text-decoration-thickness:1px}
.rer-themed :focus-visible{outline:2px solid var(--teal);outline-offset:2px;border-radius:6px}
.rer-themed .skip{position:absolute;left:16px;top:-60px;padding:8px 14px;background:var(--surface);border-radius:var(--radius-chip);box-shadow:var(--shadow-card);z-index:10}.rer-themed .skip:focus{top:12px}
.rer-themed .app-header{display:flex;align-items:center;justify-content:space-between;gap:12px 24px;flex-wrap:wrap;min-height:60px;margin:0 0 14px}
.rer-themed .app-header>a{text-decoration:none;border-radius:8px}
.rer-themed .rer-brand{display:flex;align-items:center;gap:10px;margin:0;color:var(--ink);font:500 30px/1 var(--font-head);letter-spacing:var(--rer-wordmark-tracking)}
.rer-themed .rer-brand::before{width:34px;height:34px;margin-top:-6px}
.rer-themed .identity{display:flex;align-items:center;gap:8px 20px;flex-wrap:wrap;color:var(--soft);font-size:13.5px}
.rer-themed .identity a{font-weight:500}
.rer-themed .identity form{display:block}
.rer-themed .identity button{min-height:36px;padding:0 16px;font-size:13.5px}
.rer-themed nav.tabs{display:flex;gap:8px;flex-wrap:wrap;margin:0 0 30px;padding:0}
.rer-themed nav.tabs a{display:inline-flex;align-items:center;min-height:36px;padding:0 16px;border:1px solid var(--line);border-radius:var(--radius-chip);background:var(--surface);color:var(--body);font-size:14px;font-weight:500;text-decoration:none;white-space:nowrap;box-shadow:0 1px 1px rgba(23,50,58,.03)}
.rer-themed nav.tabs a:hover{border-color:var(--line-strong);color:var(--ink)}
.rer-themed nav.tabs a[aria-current]{background:var(--sage-tint);border-color:transparent;color:var(--navy);font-weight:600}
.rer-themed h1{margin:0 0 8px;font:500 52px/1.05 var(--font-head);letter-spacing:-.025em;color:var(--ink);text-wrap:balance}
.rer-themed h2,.rer-themed h3,.rer-themed h4{color:var(--ink);text-wrap:balance}
.rer-themed p{margin:0 0 12px;color:var(--body)}
.rer-themed #content>p:first-of-type,.rer-themed .lead{font-size:16px;color:var(--body);margin-bottom:24px;max-width:72ch}
@media(max-width:700px){
.rer-themed main{padding:10px 16px 56px}
.rer-themed .app-header{gap:4px 12px;margin-bottom:12px}
.rer-themed .app-header>a{order:1}
.rer-themed .identity{display:contents}
.rer-themed .identity>span{order:3;flex-basis:100%;font-size:12.5px;line-height:1.45}
.rer-themed .identity>a{order:4;font-size:12.5px}
.rer-themed .identity>form{order:2}
.rer-themed .rer-brand{font-size:27px}
.rer-themed nav.tabs{flex-wrap:nowrap;overflow-x:auto;margin:0 -16px 22px;padding:2px 16px 6px;scrollbar-width:none}
.rer-themed nav.tabs::-webkit-scrollbar{display:none}
.rer-themed h1{font-size:40px}
}
`
