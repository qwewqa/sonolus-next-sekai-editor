import './index.css'
import './selectLists.css'

import { createApp } from 'vue'
import App from './App.vue'
import { installSelectLists } from './modals/form/selectLists'

installSelectLists()

const app = createApp(App)

app.mount('#app')
