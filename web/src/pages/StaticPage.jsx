// Renders a static mockup page's exact markup, scoped under .pg-<name> so its CSS can't leak.
// Used for the dummy-data modules (Strategies, History, Broker, Admin) that have no API yet.
export default function StaticPage({ name, html }) {
  return <div className={`pg-${name}`} dangerouslySetInnerHTML={{ __html: html }} />
}
