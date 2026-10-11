// Standalone page / development entry.
import { createApp, h } from 'vue'
import WingCalc from './WingCalc.vue'
import './styles/wingcalc.css'

// Let the page background follow the widget's light/dark choice.
const onThemeChange = (t) => (document.documentElement.dataset.theme = t)

createApp({ render: () => h(WingCalc, { onThemeChange }) }).mount('#app')
