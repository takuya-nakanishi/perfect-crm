import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import App from './App'
import { applyTheme, useUI } from './state/ui'
import './styles/index.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // 画面を行き来したときは手元のデータをすぐ出し、裏で取り直す
      staleTime: 15_000,
      gcTime: 10 * 60_000,
      retry: false,
      refetchOnWindowFocus: true,
    },
  },
})

// OS の明暗が変わったら「自動」のときだけ追従する
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if (useUI.getState().theme === 'system') applyTheme('system')
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
)
