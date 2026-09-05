import { defineConfig } from 'vite'

export default defineConfig({
  base: '/JourneytoBread/',
  build: {
    target: 'es2022',
    cssMinify: 'lightningcss',
  },
})
