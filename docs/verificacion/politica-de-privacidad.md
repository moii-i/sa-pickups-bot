# Política de privacidad de SA Pickups

> Borrador para revisión antes de publicar.

La cuenta `moi6.` administra SA Pickups en Discord. Esta política describe el tratamiento de datos en la versión actual del bot de partidas.

## Datos y uso

- **Cuenta y servidor.** Cuando usas un comando o botón, Discord proporciona tu identificador, nombre visible, servidor, canal y los roles o permisos necesarios para comprobar el acceso. El bot usa la imagen de tu perfil desde Discord cuando solicitas `/perfil`.
- **Partidas.** El bot guarda los jugadores inscritos, sus equipos y posiciones, los resultados, las notas y los identificadores de los organizadores que los registran. También guarda confirmaciones de fin y votos al MVP. Con esos registros calcula el historial, la clasificación y el resultado de la votación.
- **Grupos e invitaciones.** El bot guarda los integrantes, sus posiciones, el líder y los datos necesarios para entregar, aceptar o rechazar una invitación. Las invitaciones caducan a los diez minutos.
- **Fichas.** El bot guarda los identificadores de los mensajes que necesita actualizar, por ejemplo cuando caduca una convocatoria.

El bot recibe interacciones de Discord para operar sus comandos, botones y menús. Los datos de las partidas y los grupos se guardan en una base de datos administrada por SA Pickups.

## Visibilidad y servicios utilizados

Los miembros con acceso al canal pueden ver las convocatorias, alineaciones y resultados publicados allí. `/perfil` publica tu avatar y tus estadísticas cuando lo solicitas. `/clasificacion` muestra el rendimiento de los jugadores clasificados. Cada voto al MVP se emite en privado y la ficha muestra el resultado de la votación. Las invitaciones de grupo pueden llegar por mensaje directo de Discord.

SA Pickups usa Discord para recibir interacciones, mostrar fichas y entregar invitaciones. En la instalación actual, Cloudflare proporciona la conexión HTTPS por la que llegan las interacciones al servicio del bot. El historial se conserva para calcular perfiles y clasificaciones mientras esa información sea necesaria para operar el bot.

## Consulta, corrección y eliminación

Envía un mensaje directo a `moi6.` desde la cuenta de Discord asociada a los datos para pedir acceso, corrección o eliminación. Indica el servidor y, si lo tienes, el número de pickup. La cuenta responsable atenderá la solicitud y puede pedirte información suficiente para identificar el registro. Los mensajes ya publicados en Discord se gestionan aparte de la base del bot. Si tu solicitud incluye una ficha o un perfil publicado, indica también el enlace al mensaje.
