import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App, { EngineGate, Loading } from './App.tsx'
import { loadEngine } from './wasm/engine'
import { TooltipProvider } from './components/ui/tooltip'
import { Toaster } from './components/ui/sonner'

function Root() {
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    loadEngine()
      .then(() => setReady(true))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
  }, [])

  if (!ready && !error) return <Loading />
  return (
    <EngineGate error={error} ready={ready}>
      <TooltipProvider delay={350}>
        <App />
        <Toaster position="top-center" richColors={false} />
      </TooltipProvider>
    </EngineGate>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
)
