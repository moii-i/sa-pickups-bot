# SA Pickups Bot

Bot de Discord para el competitivo privado de SA Pickups. Usa Node.js 24 y SQLite. Recibe comandos y botones mediante las interacciones HTTPS de Discord. La base se crea automáticamente al iniciar.

## Flujo competitivo 5v5

Cada pickup nueva es 5v5, tanto competitiva como amistosa. Los jugadores pulsan **Entrar a la cola**. Pueden anotarse hasta 25 personas. El hoster que abrió la pickup o un administrador de Discord abre **Organizar equipos**, elige un puesto y luego un jugador de la cola. Cada equipo tiene 1 GK, 1 CM, 2 Winger y 1 CF. Con los diez puestos completos, pulsa **Iniciar pickup**. Quienes quedaron fuera pueden anotarse en otra cola. Las partidas de versiones anteriores mantienen su formato.

Con `PICKUP_ROOM_CATEGORY_ID` habilitado, al iniciar el bot abre `#pickup-<id>` en esa categoría y avisa a los diez jugadores seleccionados. La ficha pública muestra **Ir a la sala privada**. Los controles para confirmar el fin y votar MVP aparecen en la sala, donde también se comparte el enlace de Blue Lock Rivals. Al terminar una amistosa, el bot retira la sala enseguida. En competitivas y cancelaciones aplica el plazo de 24 horas.

Si también está configurada `PUBLIC_BASE_URL`, la sala recibe una alineación animada y el botón **Abrir visor 3D**. Cada participante introduce en **Autorizar visor** el código que muestra su navegador. El visor funciona mientras la pickup está en juego o en votación.

Al terminar el encuentro, cinco jugadores distintos pueden pulsar **Confirmar fin** o usar `/pickup confirmar id` para abrir la votación del jugador más valioso. Desde ese momento pueden inscribirse en otra partida. Un organizador que no jugó también puede registrar el resultado y abrir el voto directamente.

Referencia de mecánicas. [SA Rankings Bot](https://github.com/avestlareal/Sa-rankings-bot)

## Parties y colas inactivas

Crea un grupo con `/grupo crear posicion` e invita con `/grupo invitar jugador`. El invitado puede aceptar o rechazar por mensaje privado. Al aceptar, elige un puesto disponible en el equipo. Si Discord bloquea el mensaje privado, puede responder en el servidor con `/grupo aceptar posicion` o `/grupo rechazar`. Las invitaciones vencen en 10 minutos.

El líder usa `/pickup buscar` para apuntar al grupo a la cola 5v5 del canal. Si todavía no hay cola, necesita el rol Hoster o uno superior para abrirla. Las posiciones guardadas en el grupo sirven como referencia. El hoster decide quién juega, en qué posición y en qué equipo. Cada integrante puede usar **Salir de la cola** para retirar su propia inscripción.

Antes de buscar, el líder puede usar `/grupo identidad` para elegir un nombre y un escudo arcade. Aparecen en la ficha y en la presentación de la sala privada. El GIF y el visor muestran un dorsal según la posición de cada jugador.

Quien abrió la pickup o un miembro con un rol de dirección autorizado puede cancelarla con **Cancelar cola** o `/pickup cancelar id`. Configura los roles de dirección con `PICKUP_CANCEL_ROLE_IDS`. Una cola caduca tras 15 minutos sin actividad y libera el canal.

Con `/pickup crear modo:amistosa` se abre una 5v5 con las mismas posiciones y sala privada, sin notas, voto MVP ni impacto en el perfil o la clasificación. Termina con cinco confirmaciones o cuando el creador o la organización usa `/pickup cerrar`.

## Comandos y botones

| Acción | Quién | Qué hace |
| --- | --- | --- |
| `/pickup crear [modo]` | Miembros con el rol Hoster o uno superior | Abre una 5v5 competitiva por defecto. Elige `amistosa` para jugar sin evaluación. |
| `/pickup ver id` | Miembros autorizados | Vuelve a publicar la ficha actual con sus botones. Los cambios de etapa publican una ficha nueva. |
| **Organizar equipos** o `/pickup iniciar id` | Hoster que abrió la cola o administrador de Discord | Abre el panel privado para elegir titulares, asignar posiciones e iniciar. |
| **Confirmar fin** o `/pickup confirmar id` | Participantes | Confirma que se terminó de jugar. En 5v5 abre la votación MVP al llegar a 5 confirmaciones distintas. |
| `/pickup terminar id [resultado] [marcador] [minutos]` | Organización | Registra el marcador Azul–Rojo, por ejemplo `3-1`, o indica el ganador o empate. Si el voto ya empezó, conserva su plazo. Se puede corregir el marcador antes de cerrar. |
| **Votar MVP** o `/pickup votar id` | Participantes | Permite elegir a otro jugador de la misma partida. El voto es privado y se puede cambiar mientras la votación esté abierta. |
| `/pickup calificar id [jugador] [nota]` | Staff | Abre un formulario con todas las notas, una por línea y en el mismo orden que la ficha. También permite indicar un jugador y una nota para guardar ese caso por separado. |
| `/pickup cerrar id` | Staff, o el creador de una amistosa | En competitivas exige resultado, todas las notas y el cierre del voto. Una amistosa en juego se cierra directamente. |
| `/pickup cancelar id` | Creador o dirección autorizada | Anula una partida antes del cierre y libera el canal si seguía activa. |
| `/perfil` | Miembros autorizados | Publica la tarjeta arcade con avatar, rango, promedio, victorias, MVP, racha y últimas cinco notas. |
| `/clasificacion` | Miembros autorizados | Publica el podio y hasta 15 jugadores ordenados por promedio de notas de partidas cerradas. |

Usa los comandos de cada pickup en el canal de convocatoria o en su sala privada. Puede haber una inscripción o partida en juego por canal de convocatoria. Un jugador puede participar en una de esas partidas a la vez. Las partidas en evaluación pueden coexistir con otra partida. El voto MVP y la nota son independientes. Un empate en votos produce MVP compartido. Una partida sin votos al vencer el plazo puede cerrarse con todas las notas y queda sin MVP.

Desde `/perfil`, **Personalizar mi tarjeta** abre un editor privado. El jugador puede elegir una posición favorita y equipar por separado un título y un marco (color y GIF). Se desbloquean estilos con el primer MVP, cinco victorias y una racha de tres victorias competitivas, según el historial de pickups cerradas. Las victorias muestran el GIF de celebración y el cierre destaca a todos los MVP.

## Notas y estrellas

El staff captura una nota de 0 a 10 por jugador y por pickup, con un decimal opcional. La primera estrella se asigna al completar 3 pickups cerradas. El bot usa el promedio histórico exacto para determinar el rango y muestra dos decimales al jugador. El MVP es un reconocimiento separado. Los umbrales y el mínimo de partidas son provisionales y están en `src/rules.js`.

| Estrellas | Promedio |
| --- | --- |
| 1 | Menos de 5 |
| 2 | Desde 5 hasta menos de 6 |
| 3 | Desde 6 hasta menos de 7 |
| 4 | Desde 7 hasta menos de 8 |
| 5 | Desde 8 hasta menos de 9 |
| 6 | Desde 9 hasta 10 |

## Instalación

1. En [Discord Developer Portal](https://discord.com/developers/applications), crea una aplicación **SA Pickups**. En **General Information**, copia **Application ID** y **Public Key**. En **Installation**, habilita **Guild Install** con los scopes `bot` y `applications.commands`. La app responde con callbacks de interacción y evita solicitar Administrator, Manage Roles o permisos privilegiados. Para que solo el dueño pueda instalar el bot, elige **Install Link → None** antes de deshabilitar **Public Bot** y usa un enlace directo del generador OAuth2. En el canal privado de pruebas, dale al bot **Ver canal**, **Enviar mensajes** e **Insertar enlaces** para mostrar las fichas.
2. Instala la app primero en un servidor de pruebas donde tengas permiso para agregar aplicaciones. En Discord, activa **Modo desarrollador** para copiar el ID del servidor, y opcionalmente los IDs del rol del staff, rol de jugador y canales de pickups. Limita el acceso de esos canales con los permisos de Discord.
3. En un repositorio privado, sube estos archivos y despliega el servicio desde GitHub, por ejemplo en [Railway](https://railway.com/new). Usa una réplica, habilita una URL pública HTTPS y monta un volumen persistente en `/data`. El servicio incluye Dockerfile. En la configuración del host, usa `/health` como ruta de comprobación. Evita suspenderlo si el arranque en frío impide responder a Discord a tiempo.
4. Define en el host `DISCORD_APP_ID`, `DISCORD_PUBLIC_KEY`, `DISCORD_GUILD_ID` y `DB_PATH=/data/pickups.sqlite`. Configura `PUBLIC_BASE_URL` con la URL HTTPS pública del servicio para que Discord cargue los GIFs de los embeds. Opcionalmente define `STAFF_ROLE_ID`, `PLAYER_ROLE_ID` y `PICKUP_CHANNEL_IDS` (varios IDs separados por comas). Los permisos Gestionar servidor y Administrador dan acceso a la organización, además del rol configurado. Si hay rol de jugador, el resto necesita ese rol para usar el bot.
5. En **General Information** del portal, guarda **Interactions Endpoint URL** como `https://TU-DOMINIO/discord/interactions`. Discord comprueba la firma del endpoint al guardar.
6. Con Node.js 24, copia `.env.example` a `.env` localmente y define `DISCORD_APP_ID`, `DISCORD_GUILD_ID` y `DISCORD_BOT_TOKEN`. El token se obtiene en **Bot**. Ejecuta `npm run registrar` una vez por servidor y cada vez que cambie la definición de los comandos. Configura también el token como variable secreta del servicio para enviar los DMs y actualizar fichas caducadas. Guarda el token fuera de Git y de chats. La clave pública verifica las interacciones.
7. Prueba `/pickup crear`, **Entrar a la cola** y **Organizar equipos**. Para probar el inicio, el voto y el cierre en Discord se necesitan diez cuentas. Luego repite la configuración para el servidor real con una base separada.

### Permiso para abrir pickups

Configura `PICKUP_HOSTER_ROLE` con el ID del rol Hoster del servidor oficial. Si queda vacío, el bot busca un único rol llamado Hoster. El servicio usa `DISCORD_BOT_TOKEN` para consultar la jerarquía de Discord cada vez que alguien intenta abrir una cola. El rol Hoster también puede abrir convocatorias. Para iniciar, calificar, cerrar o cancelar, se usan los permisos de organización descritos arriba.

Para habilitar salas privadas, indica el ID de una categoría del mismo servidor en `PICKUP_ROOM_CATEGORY_ID`. El bot necesita **Gestionar canales** y los permisos que concede en la sala. Las excepciones de acceso permiten a los participantes y al bot ver y escribir. Los administradores de Discord conservan su acceso habitual.

Para responder a los pings en `#pickups-1`, configura `PICKUP_NOTICE_CHANNEL_ID` con el ID del canal y `PICKUP_NOTICE_ROLE_ID` con el ID del rol `@pickup`. El bot necesita **Ver canal** y **Enviar mensajes**. Usa las menciones que Discord indica en el evento del mensaje, sin leer su texto. Discord agrupa `@everyone` y `@here` en el mismo indicador.

### Verificación local

`npm test` simula solicitudes HTTP firmadas con una clave de prueba y una base SQLite temporal. También prueba el flujo 5v5, el balance y la migración desde la base de la primera versión. `npm start` arranca el servidor con las variables indicadas. Para probar desde Discord en local, el endpoint requiere una URL HTTPS que Discord pueda alcanzar. Usa un volumen persistente con backups para conservar el historial entre despliegues.
