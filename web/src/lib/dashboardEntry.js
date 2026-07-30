import { createContext } from 'react'

// A tiny route handoff channel: AppShell owns the document-level cover; Dashboard tells it when the
// real query-backed view is ready to be revealed. It deliberately carries no persistent/global flag.
export const DashboardEntryContext = createContext({
  enteredFromLogin: false,
  signalDashboardReady: () => {},
})
