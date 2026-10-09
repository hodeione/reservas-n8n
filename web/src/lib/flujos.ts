/** Las automatizaciones de n8n, para enseñarlas en el panel. */
export interface Flujo {
  id: string
  nombre: string
  cuando: string
  hace: string
  ahorra: string
  /** Se puede lanzar a mano desde el panel. */
  manual?: boolean
  icono: string
}

export const FLUJOS: Flujo[] = [
  { id: '01', icono: '🗓️', nombre: 'Reservas web y API', cuando: 'Al momento, en cada reserva', hace: 'Comprueba mesas, ritmo de cocina y duplicados, asigna la mejor mesa y envía la confirmación con enlace para cancelar.', ahorra: 'Coger el teléfono en pleno servicio' },
  { id: '02', icono: '🔗', nombre: 'Gestión del cliente', cuando: 'Cuando el cliente abre su enlace', hace: 'El cliente confirma o cancela con un clic. Si cancela, avisa a la lista de espera.', ahorra: 'Llamadas para anular' },
  { id: '03', icono: '⏰', nombre: 'Recordatorio el día antes', cuando: 'Cada hora de 10:00 a 21:00', hace: 'Recuerda la reserva de mañana con botones «Allí estaremos» y «No podemos ir».', ahorra: 'Llamar para confirmar', manual: true },
  { id: '04', icono: '⭐', nombre: 'Petición de reseña', cuando: 'Cada día a las 12:00', hace: 'Pide reseña en Google solo a quien vino ayer, una sola vez.', ahorra: 'Pedir reseñas a mano', manual: true },
  { id: '05', icono: '⏳', nombre: 'Lista de espera automática', cuando: 'Al liberarse una mesa y cada 30 minutos', hace: 'Asigna la mesa libre al primero de la lista y le avisa de que ya tiene reserva.', ahorra: 'Mesas vacías por cancelaciones', manual: true },
  { id: '06', icono: '🧑‍🍳', nombre: 'Administración del restaurante', cuando: 'Al usar este panel', hace: 'Guarda carta, plano y horarios validados, y cambia estados y mesas de las reservas.', ahorra: 'Depender de un programador' },
  { id: '07', icono: '📊', nombre: 'Informe diario', cuando: 'Cada día a las 9:00', hace: 'Envía al dueño las reservas de hoy con alergias y el balance de ayer.', ahorra: 'Repasar la libreta cada mañana', manual: true },
  { id: '08', icono: '🌧️', nombre: 'Terraza según el tiempo', cuando: 'A las 10:00 y a las 17:00', hace: 'Consulta la previsión de lluvia. Si supera el umbral, pasa las reservas de terraza al salón y avisa a cada cliente.', ahorra: 'Recolocar mesas y llamar a todos cuando llueve', manual: true },
  { id: '09', icono: '🔪', nombre: 'Hoja de cocina', cuando: 'A las 12:00 y a las 19:00', hace: 'Manda a cocina los comensales por hora, las alergias por mesa y las celebraciones del turno.', ahorra: 'Sorpresas con alergias y tartas', manual: true },
  { id: '10', icono: '💌', nombre: 'Recuperar clientes', cuando: 'Los lunes a las 11:00', hace: 'Invita a volver a los clientes habituales que llevan tiempo sin venir, sin repetir.', ahorra: 'Perder clientes sin darse cuenta', manual: true },
]

export const nombreFlujo = (id: string) => FLUJOS.find((f) => f.id === id)?.nombre ?? id
