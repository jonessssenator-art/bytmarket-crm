// Print 360 — тёмная акцентная плашка (как «План продаж» в варианте B макета v2): внутри var(--p-ink), --p-muted,
// --p-track и др. становятся «светлыми на тёмном», поэтому любые компоненты и графики внутри читаются сами.
// В «Авроре» — чуть более плотное стекло, в «Классике» — прежний зелёный #3E5754.
//   <DarkPlate pad={20}><h3>План продаж</h3><Ring value={40} … /></DarkPlate>
import GlassPanel from './GlassPanel.jsx';

export default function DarkPlate({ className, ...rest }) {
  return <GlassPanel {...rest} className={['p-plate', className].filter(Boolean).join(' ')} />;
}
