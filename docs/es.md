# Vallox

Controle su **unidad de ventilación Vallox con recuperación de calor** desde Gladys Assistant:
perfiles (en casa, ausente, boost, chimenea), velocidades de ventilación, temperaturas de aire
impulsado y todos los sensores de la unidad (temperaturas, humedad, CO2, filtro). Incluye
disparadores de escena, acciones de escena y un widget para el panel.

Todo se queda en su red local: la integración habla con la unidad como lo hace su propia interfaz
web. Sin cuenta en la nube, sin acceso a internet.

## Unidades compatibles

Las unidades Vallox con regulación **MV** y puerto de red, cuya interfaz web se abre en
`http://<dirección de la unidad>`: Vallox 51/90/96/99/101/110/125/139/145/245 MV, ValloPlus 180/240/
270/350/370/510/850 MV, ValloMulti 200/300 MV, TSK Multi MV, y las unidades Helios KWL construidas
sobre la misma regulación.

Las unidades antiguas sin puerto de red (Digit SE, Digit 2…) no son compatibles.

## Antes de empezar

1. Conecte la unidad a su red (cable en su puerto Ethernet).
2. Asígnele una **dirección IP fija** en su router (reserva DHCP): la integración encuentra la
   unidad por su dirección.
3. Compruebe que `http://<esa dirección>` abre la interfaz web de Vallox en un navegador, desde un
   ordenador de la misma red que Gladys.

## Instalación

En Gladys, vaya a **Integraciones**, busque **Vallox** e instálela.

## Configuración

| Campo                          | Qué poner                                                                               |
| ------------------------------ | --------------------------------------------------------------------------------------- |
| Dirección IP de la unidad      | La dirección de la unidad, p. ej. `192.168.1.50`. Varias unidades: sepárelas con comas. |
| Intervalo de actualización (s) | Cada cuánto se lee la unidad. 60 s por defecto, 15 s como mínimo.                       |
| Aviso de filtro (días)         | El disparador «Cambio de filtro próximo» se activa cuando quedan estos días de filtro.  |

Guarde y pulse **Probar la conexión**: la respuesta indica el modelo, el firmware, el perfil y las
temperaturas de cada unidad, o el motivo por el que no ha respondido.

Después vaya a **Descubrir** en la integración y cree el dispositivo.

## El dispositivo

La unidad se convierte en un dispositivo de Gladys con el nombre de su modelo. Se reconoce por el
identificador único que lleva: cambiar su dirección IP más adelante no crea un dispositivo nuevo.

| Funcionalidad                       | Tipo            | Para qué                                                     |
| ----------------------------------- | --------------- | ------------------------------------------------------------ |
| Ventilation on/off                  | interruptor     | Para o arranca la unidad                                     |
| Away mode (ausente)                 | interruptor     | Perfil ausente / vuelta a en casa                            |
| Boost                               | interruptor     | Boost durante el tiempo fijado en la unidad / parar el boost |
| Fireplace mode (chimenea)           | interruptor     | Modo chimenea durante el tiempo fijado en la unidad / parar  |
| Fan speed                           | sensor (%)      | Velocidad de ventilación actual                              |
| Indoor air (extract)                | temperatura     | Aire extraído de las estancias                               |
| Outdoor air                         | temperatura     | Aire exterior que entra                                      |
| Supply air                          | temperatura     | Aire impulsado a las estancias                               |
| Exhaust air                         | temperatura     | Aire expulsado al exterior                                   |
| Humidity                            | humedad (%)     | Si la unidad tiene la sonda                                  |
| CO2                                 | CO2 (ppm)       | Si la unidad tiene la sonda                                  |
| Fan speed (home/away/boost)         | ajuste (%)      | Velocidad de ventilación de cada perfil                      |
| Supply air target (home/away/boost) | consigna (°C)   | Temperatura de impulsión de cada perfil (5 a 25 °C)          |
| Boost / fireplace time left         | duración (min)  | Tiempo restante del boost o del modo chimenea en curso       |
| Filter change in                    | duración (días) | Días que faltan para el próximo cambio de filtro             |

Los nombres de las funcionalidades están en inglés (Gladys los muestra tal cual): puede
renombrarlos en el dispositivo.

La tarjeta del dispositivo muestra una insignia **local** mientras la unidad responde, e
**inaccesible** si no.

## Escenas

### Disparadores

| Disparador                           | Cuándo                                                                        | Variables                                 |
| ------------------------------------ | ----------------------------------------------------------------------------- | ----------------------------------------- |
| Ha cambiado el perfil de ventilación | El perfil cambió desde el panel de la unidad, su app o un temporizador        | nombre, nuevo perfil, perfil anterior     |
| Alarma de ventilación                | Hay una nueva alarma activa (ventilador, intercambiador congelado, filtros…)  | nombre, gravedad, alarma, código, mensaje |
| Cambio de filtro próximo             | La vida restante del filtro ha llegado a los días fijados en la configuración | nombre, días restantes, fecha de cambio   |
| Unidad de ventilación inaccesible    | La unidad ha dejado de responder (dos lecturas seguidas han fallado)          | nombre, dirección                         |

Cada disparador puede limitarse a una unidad, «perfil cambiado» a ciertos perfiles, «alarma» a una
gravedad.

Las órdenes dadas por Gladys (panel, escenas, widget) nunca activan «perfil cambiado»: una escena
que reacciona a un cambio de perfil y lo cambia de nuevo no puede entrar en bucle.

Valores del perfil en las variables: `home` (en casa), `away` (ausente), `boost`, `fireplace`
(chimenea), `extra`. El mensaje de alarma está en inglés.

### Acciones

| Acción                              | Para qué                                                            | Resultado para las acciones siguientes                          |
| ----------------------------------- | ------------------------------------------------------------------- | --------------------------------------------------------------- |
| Cambiar el perfil de ventilación    | En casa, ausente, boost o chimenea; duración en minutos opcional    | perfil                                                          |
| Ajustar la ventilación de un perfil | Velocidad (%) del perfil en casa, ausente o boost                   | velocidad                                                       |
| Registrar un cambio de filtro       | Los filtros se han cambiado hoy: la unidad reinicia su recordatorio | fecha del próximo cambio                                        |
| Leer los valores de ventilación     | Lee la unidad ahora                                                 | perfil, temperaturas, humedad, CO2, ventilación, días de filtro |

Ejemplo: _cuando la humedad del baño supere el 75 %, poner el boost durante 30 minutos_.

## Widget del panel

Añada el widget **Ventilación Vallox** a un panel. Muestra:

- mosaicos en directo: temperatura interior y exterior, ventilación, y CO2 (o humedad, o aire
  impulsado);
- una lista de estado: perfil y tiempo restante, estado del intercambiador (recuperación de calor,
  bypass, descongelación), cambio de filtro, alarmas, conexión;
- tres botones: **En casa**, **Ausente**, **Boost**.

Con varias unidades, elija la unidad en los ajustes del widget.

## Botones de la pantalla de configuración

- **Probar la conexión**: lee cada unidad ahora y dice lo que ha encontrado.
- **Filtros cambiados hoy**: tras cambiar los filtros, elija la unidad; su recordatorio vuelve a
  empezar hoy.

## Solución de problemas

| Problema                               | Qué comprobar                                                                                   |
| -------------------------------------- | ----------------------------------------------------------------------------------------------- |
| «Sin respuesta de 192.168.1.50»        | La dirección, el cable, y que `http://<dirección>` se abra en un navegador de la red de Gladys. |
| El dispositivo no aparece en Descubrir | La unidad debe haber respondido una vez: **Probar la conexión** y luego **Descubrir** otra vez. |
| La humedad o el CO2 siguen vacíos      | La unidad no tiene esa sonda: el valor no se publica.                                           |
| Los valores llegan tarde               | Baje el intervalo de actualización (15 s como mínimo).                                          |
| La app de Vallox deja de funcionar     | La unidad acepta pocas conexiones a la vez: evite un intervalo inferior a 30 s.                 |

Los registros de la integración (Integraciones → Vallox → Registros) indican qué unidad ha fallado
y por qué.

## Privacidad

La integración solo habla con la dirección introducida, en su red local (puerto 80). No se envía
nada a Vallox ni a ningún otro servicio. El único archivo que escribe es `/data/units.json`, que
guarda el identificador, el modelo y el firmware de las unidades ya conocidas.
