export default function CartaoMetrica({ item }) {
  return (
    <div className={`metrica ${item.nivel}`}>
      <div className="linha">
        <h3>{item.titulo}</h3>
        <span className="medida">
          {item.medida} · {item.nota.toFixed(0)}/100
        </span>
      </div>
      <div className="barra">
        <i style={{ width: `${Math.max(2, item.nota)}%` }} />
      </div>
      <p className="conselho">{item.conselho}</p>
      <details>
        <summary>Como isso é medido</summary>
        <p className="porque">{item.explicacao}</p>
      </details>
    </div>
  );
}
