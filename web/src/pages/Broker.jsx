import './broker.css'
import html from './broker.body.html?raw'
import StaticPage from './StaticPage'

export default function Broker() {
  return <StaticPage name="broker" html={html} />
}
