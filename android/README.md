# Estradox para Android

App **nativa** (Kotlin + Jetpack Compose). No usa navegador ni WebView: habla
directo con el servidor de Estradox (`https://app.estradox.com`) por el API
`/api/mobile/*` con un token por dispositivo.

## Qué incluye

- Iniciar sesión, crear cuenta, recuperar contraseña y reenviar verificación.
- Dashboard: tarjetas, antigüedad de la última actuación, gráficos por clase y
  departamento, procesos con actuación reciente y "Actualizar todos" (1 vez/semana).
- Procesos: lista con búsqueda, agregar uno o varios radicados, detalle con las
  pestañas de la web (Resumen, Actuaciones, Documentos, Partes, Grabaciones,
  Sincronización), actualizar (1 vez/día), marcar vistas y eliminar.
- Visor de PDF dentro de la app (zoom con dos dedos), guardar, compartir o abrir con otra app.
- Cuenta: suscripción e historial de pagos (solo consulta), WhatsApp,
  notificaciones, cambiar contraseña, cerrar sesión y **eliminar cuenta**.
- Notificaciones nativas: cada 30 min la app consulta `/api/mobile/notices`
  (actuaciones nuevas del cron diario, fin de "Actualizar todos" y avisos del admin).

El panel de administración sigue en la web.

## Compilar

Requiere JDK 17–21 (el de Android Studio sirve) y el Android SDK.

```bash
./gradlew assembleDebug                 # APK de prueba (contra app.estradox.com)
./gradlew assembleDebug -PapiBase=http://10.0.2.2:3000   # contra el servidor local desde el emulador
./gradlew bundleRelease                 # AAB firmado para Play Store
```

La firma usa `AutoReply/keystore.properties` (o la ruta en `ESTRADOX_KEYSTORE_PROPS`).
El AAB queda en `app/build/outputs/bundle/release/app-release.aab`.

## Publicar en Play Store

1. Despliega primero el backend (las rutas `/api/mobile/*` son nuevas).
2. Play Console → Crear app → sube el AAB a *Prueba interna*.
3. Ficha: ícono 512×512 (`public/icon-512.png`), gráfico destacado 1024×500 y capturas.
4. **Política de privacidad**: Play exige una URL pública.
5. **Eliminación de cuenta**: en la app (Cuenta → Eliminar mi cuenta) y en la web
   (`/dashboard/configuracion#eliminar-cuenta`). Esa URL va en el formulario de Play.
6. **Seguridad de los datos**: se recogen nombre, correo, teléfono (WhatsApp) y los
   procesos del usuario; viajan cifrados (HTTPS) y el usuario puede pedir su eliminación.
7. **Pagos**: la app no vende planes ni enlaza al pago con Bold (Play no lo permite
   para contenido digital fuera de su sistema de facturación). Con el acceso
   vencido muestra un aviso y el botón "Ya renové".
8. Cuentas nuevas en Play: requieren una prueba cerrada con 12 testers durante 14 días
   antes de poder pasar a producción.

Cada nueva versión: sube `versionCode` (y `versionName`) en `app/build.gradle.kts`.
