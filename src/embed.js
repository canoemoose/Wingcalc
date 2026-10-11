// Embeddable build: registers a <wing-calc> custom element. The widget renders inside a
// shadow root with its own styles, so it neither depends on nor affects the host page.
//
//   <script src="wingcalc.js"></script>
//   <wing-calc units="imperial" theme="light"></wing-calc>
//
// Attributes (read once, when the element is attached):
//   units  "metric" (default) or "imperial"
//   theme  "auto" (default, follows the OS), "light" or "dark". The viewer can change it
//          in the widget; their choice is remembered in this browser.
import { createApp, h } from 'vue'
import WingCalc from './WingCalc.vue'
import css from './styles/wingcalc.css?inline'

class WingCalcElement extends HTMLElement {
  connectedCallback() {
    if (this._app) return
    const root = this.shadowRoot ?? this.attachShadow({ mode: 'open' })
    const style = document.createElement('style')
    style.textContent = `:host { display: block; }\n${css}`
    const mount = document.createElement('div')
    root.append(style, mount)
    const units = this.getAttribute('units') ?? 'metric'
    const theme = this.getAttribute('theme') ?? 'auto'
    this._app = createApp({ render: () => h(WingCalc, { units, theme }) })
    this._app.mount(mount)
  }

  disconnectedCallback() {
    this._app?.unmount()
    this._app = null
    this.shadowRoot?.replaceChildren()
  }
}

if (!customElements.get('wing-calc')) customElements.define('wing-calc', WingCalcElement)

export { WingCalc, WingCalcElement }
