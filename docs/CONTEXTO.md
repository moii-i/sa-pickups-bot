# SA Pickups Bot

SA Pickups es un bot de Discord para organizar partidas comunitarias 5v5 de **Blue Lock Rivals** en Roblox. Los jugadores se inscriben en Discord, el hoster arma los equipos y la partida se juega en un servidor privado del juego. El bot lleva la convocatoria, la sala privada, el marcador, las notas y el historial competitivo.

- Código compartido en el [repositorio privado `moii-i/sa-pickups-bot`](https://github.com/moii-i/sa-pickups-bot). El estado descrito aquí parte del [commit `5478554`](https://github.com/moii-i/sa-pickups-bot/commit/5478554). Usa `main` para consultar la versión más reciente y el [README](../README.md) para la referencia de comandos e instalación.
- Producción en Wispbyte con Node.js 24 y una base SQLite persistente. El bot recibe comandos, botones y menús en `POST /discord/interactions` y verifica su firma. La API de Discord se usa para administrar salas y publicar o actualizar mensajes. Una conexión al Gateway recibe eventos para el recordatorio de convocatorias.
- Servidores habilitados en el último despliegue verificado del 14 de noviembre de 2026: **SA Pickups** y **JGAY PICKUPS**. Comparten la aplicación de Discord y el servicio. La configuración de canales y roles, las partidas, los grupos, los perfiles y la clasificación se consultan por servidor.

## Cómo se juega

1. `/pickup crear` abre una **competitiva** por defecto. `/pickup crear modo:amistosa` abre una **amistosa**. Los jugadores pulsan **Entrar a la cola**. Pueden anotarse hasta 25 personas.
2. Quien abrió la pickup o un administrador de Discord pulsa **Organizar equipos** o usa `/pickup iniciar id`. En un panel privado elige diez titulares y asigna Azul o Rojo. Cada equipo tiene un portero (GK), un mediocampista (CM), dos extremos (Winger) y un delantero (CF). Al confirmar la alineación completa con **Iniciar pickup** se libera la inscripción de quienes quedaron fuera.
3. El bot crea una sala de texto privada y avisa a los diez titulares. Allí comparten el enlace de Blue Lock Rivals y ven la alineación con dorsales, posiciones y escudos de grupo, tanto en GIF como en el visor 3D. Para abrir el visor, un titular confirma en Discord el código que muestra su navegador.
4. Cinco confirmaciones de fin abren el voto privado al MVP en competitiva o cierran la amistosa. En competitiva, el staff registra el marcador, captura las notas individuales de 0 a 10 y cierra la pickup cuando termina el voto o ya votaron todos. La amistosa se juega sin notas, MVP ni efecto en la clasificación. Su sala se retira al cerrar. Las salas de competitivas cerradas y de partidas canceladas tienen un plazo de 24 horas.

Se puede retirar y vetar a un jugador para esa pickup. Si ya estaba en juego, el bot reabre la cola para asignar un reemplazo y sincronizar la sala. Cancelar y retirar tienen sus propios permisos de creador o dirección autorizada. La asignación de equipos permite al creador o a los administradores. En el servidor principal, abrir convocatorias requiere el rol **Hoster** o superior. En servidores adicionales también pueden abrirlas los administradores. La cola actual caduca tras 15 minutos sin actividad.

## Funciones que conviene conservar

- **Grupos.** `/grupo` sirve para crear e invitar, aceptar o rechazar invitaciones por DM y elegir nombre y escudo. El líder pulsa `/pickup buscar` para anotar al grupo. La alineación definitiva la decide quien organiza la pickup.
- **Perfil y clasificación.** `/perfil` publica una tarjeta arcade con avatar, nota media, rango, victorias, MVP, mejor racha y últimas cinco notas. El jugador puede personalizar su posición favorita, título y marco. Primer MVP, cinco victorias y tres victorias competitivas seguidas desbloquean estilos. `/clasificacion` muestra hasta 15 jugadores por promedio con un mínimo de tres partidas competitivas cerradas.
- **Estilo.** Interfaz en español, estética pixel art arcade en blanco y negro, Azul y Rojo para distinguir equipos y GIFs según la fase. El cierre competitivo con ganador usa la animación **Gol en llamas**. `/help` explica el flujo desde Discord.
- **Avisos.** En el canal configurado del servidor principal, el bot contesta **Usenme /pickup crear** a la mención del rol de pickups o a una mención general.

## Dónde trabajar

| Archivo o carpeta | Contenido |
| --- | --- |
| [`src/interactions.js`](../src/interactions.js) y [`src/commands.js`](../src/commands.js) | Comandos de Discord, embeds, componentes y permisos de cada acción. |
| [`src/store.js`](../src/store.js) y [`src/rules.js`](../src/rules.js) | SQLite, migraciones, estados de partida, cola, alineaciones, resultados y estadísticas. Los formatos de versiones anteriores siguen teniendo rutas compatibles. |
| [`src/server.js`](../src/server.js), [`src/discord.js`](../src/discord.js) y [`src/rooms.js`](../src/rooms.js) | Entrada HTTP, configuración por servidor, llamadas a Discord y mantenimiento de fichas y salas. |
| [`src/lineup-viewer.js`](../src/lineup-viewer.js), [`src/lineup-scene.js`](../src/lineup-scene.js) y [`assets/lineup/`](../assets/lineup/) | Acceso al visor de participantes, escena, recursos web y base del GIF de alineación. |
| [`src/arcade.js`](../src/arcade.js), [`src/media.js`](../src/media.js) y [`assets/arcade/`](../assets/arcade/) | Temas, escudos, logros y GIFs. |
| [`test/`](../test/) y [`.env.example`](../.env.example) | Pruebas con base temporal y variables de entorno de referencia. |

## Cómo coordinar cambios entre Claude y Codex

1. Comparte este archivo y el objetivo concreto. Si Claude puede acceder al repositorio privado, indícale la rama o el commit exacto. Así ambos trabajan sobre el mismo código.
2. Antes de editar, ejecuta `git status` y comprueba qué rama y commit estás usando. Para trabajos simultáneos, usa ramas y carpetas de trabajo separadas. Si uno continúa el trabajo del otro, pásale la misma rama y el último commit.
3. Ejecuta `npm ci` con Node.js 24 al preparar una copia nueva y `npm test` antes de entregar. La última comprobación ejecutó 16 pruebas. Para cambios en colas, salas o permisos, comprueba el efecto en ambos modos y el aislamiento por servidor.
4. Al entregar, anota **objetivo, rama o commit, archivos tocados, pruebas ejecutadas y pendiente**. Usa un pull request si ambos van a revisar el mismo cambio. Mantén en Wispbyte los tokens, claves y bases de datos reales. Registra los comandos en cada servidor con `npm run registrar` si cambias su definición y comprueba `/health` después de un despliegue autorizado.

En JGAY PICKUPS quedó pendiente verificar en vivo un reemplazo en una sala privada. En la última revisión, el bot podía publicar en `#pickups-1` y `#pickups-2`, y le faltaba **Manage Permissions** para cambiar el acceso a la sala al sustituir a un jugador. La información operativa de este apartado refleja la última revisión y puede cambiar.
