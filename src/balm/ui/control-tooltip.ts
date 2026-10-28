import {h} from './shared'

// A small local tooltip until Base supplies its shared control.
export const controlTooltipStyle = `
.control-tip{position:relative;overflow:visible}
.control-tip [role=tooltip]{position:absolute;top:calc(100% + 8px);left:0;z-index:30;width:max-content;max-width:160px;padding:5px 8px;border-radius:6px;background:#263c34;color:#fff;font-size:13px;line-height:1.4;pointer-events:none;visibility:hidden;opacity:0;transition:visibility 0s,opacity 0s}
.control-tip:hover [role=tooltip]{visibility:visible;opacity:1;transition-delay:300ms}
.control-tip:focus [role=tooltip]{visibility:visible;opacity:1;transition-delay:0s}
`
export const controlLink = (id:string,href:string,label:string,glyph:string,className = 'step') => `<a class="${h(className)} control-tip" href="${h(href)}" aria-label="${h(label)}" aria-describedby="${h(id)}">${glyph}<span id="${h(id)}" role="tooltip">${h(label)}</span></a>`
