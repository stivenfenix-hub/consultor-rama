// Se muestra al instante al tocar el menú, mientras el servidor prepara la
// página (el menú lateral se queda quieto). Sin esto, el clic parecía no hacer
// nada cuando el servidor tardaba unos segundos.
export default function CargandoDashboard() {
  return (
    <div className="page" aria-busy="true" aria-label="Cargando">
      <div className="carga-pagina" aria-hidden />
      <div className="skel skel-titulo" />
      <div className="card">
        <div className="skel skel-linea" style={{ width: "40%" }} />
        <div className="skel skel-linea" />
        <div className="skel skel-linea" style={{ width: "70%" }} />
      </div>
      <div className="card">
        <div className="skel skel-linea" style={{ width: "55%" }} />
        <div className="skel skel-linea" style={{ width: "85%" }} />
      </div>
      <div className="card">
        <div className="skel skel-linea" style={{ width: "50%" }} />
        <div className="skel skel-linea" style={{ width: "75%" }} />
      </div>
    </div>
  );
}
