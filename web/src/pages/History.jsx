import './history.css'
import html from './history.body.html?raw'

export default function History() {
  const bodyHtml = html.replace(/<div class="note">[\s\S]*?<\/div>\s*$/, '')

  return (
    <div className="pg-history">
      <div dangerouslySetInnerHTML={{ __html: bodyHtml }} />
      <div className="note">History · transaction ledger</div>
    </div>
  )
}
