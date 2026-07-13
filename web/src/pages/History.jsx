import './history.css'
import html from './history.body.html?raw'
import StaticPage from './StaticPage'

export default function History() {
  return <StaticPage name="history" html={html} />
}
