import { StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'
import App from './app/App'
import { AuthProvider } from './app/auth'
import { ErrorBoundary } from './app/ErrorBoundary'
import { createQueryClient } from './app/queryClient'
import { ThemeProvider } from './app/theme'
import { PageSpinner, ToastProvider } from './ui'
import './styles/app.css'

const queryClient = createQueryClient()

const rootEl = document.getElementById('root')
if (!rootEl) throw new Error('#root element missing from index.html')

createRoot(rootEl).render(
  <StrictMode>
    <ErrorBoundary fullScreen>
      <ThemeProvider>
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <ToastProvider>
              <BrowserRouter>
                <Suspense fallback={<div className="flex h-full bg-canvas"><PageSpinner /></div>}>
                  <App />
                </Suspense>
              </BrowserRouter>
            </ToastProvider>
          </AuthProvider>
        </QueryClientProvider>
      </ThemeProvider>
    </ErrorBoundary>
  </StrictMode>,
)
