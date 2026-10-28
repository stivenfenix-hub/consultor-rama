# Servicio de WhatsApp de Estradox

Mantiene vinculados dos WhatsApp de Estradox, como dispositivos vinculados (igual que WhatsApp Web), y envía despacio los mensajes que Estradox deja en la cola. Los dos WhatsApp son:

- **avisos**: actuaciones nuevas, solo para quienes activaron recibirlas por WhatsApp, y avisos de pago.
- **comercial**: quienes no han cargado procesos y las promociones que envía el root.

Todo se maneja desde **Panel admin → WhatsApp**: el QR, el estado, pausar, desvincular, el máximo por día, la cola y el mensaje de prueba.

Reglas de envío:
- un mensaje cada 25 a 70 segundos, con una pausa al azar;
- solo de 8:00 a.m. a 8:00 p.m., hora de Bogotá;
- nunca más del máximo diario de cada número.

> Debe correr en **un solo proceso siempre encendido**. No lo subas a Hostinger web (varios procesos que se reinician): úsalo en un servidor aparte.

## 1. Contratar el servidor

Sirve un VPS pequeño con Ubuntu 24.04, de 1 vCPU y 1 GB de RAM. Por ejemplo:
- Hostinger VPS KVM 1;
- DigitalOcean / Vultr / Contabo, de unos 5 USD al mes.

Al crearlo, el proveedor te da la **IP** y la **contraseña de root** (o una llave SSH). Esos datos son tuyos: no los compartas.

## 2. Instalar (una sola vez)

Conéctate por SSH desde tu computador. En Windows, abre PowerShell y escribe `ssh root@TU_IP`.

Luego ejecuta:

```bash
# Node.js 20 y herramientas
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs git
npm install -g pm2

# Hora de Colombia (para los registros)
timedatectl set-timezone America/Bogota

# Código (te pedirá tu usuario de GitHub y un token de acceso)
git clone https://github.com/stivenfenix-hub/consultor-rama.git
cd consultor-rama/whatsapp-worker
npm ci --omit=dev
```

## 3. Conectarlo a la base de datos de Estradox

Crea el archivo `.env` con **la misma `DATABASE_URL` que usa Estradox**. La encuentras en Hostinger, en las variables de entorno del sitio. Pégala tú: no la envíes por chat.

```bash
nano .env
```

Escribe una sola línea, guarda con `Ctrl+O`, presiona Enter y sal con `Ctrl+X`:

```
DATABASE_URL=postgresql://...
```

## 4. Encenderlo y dejarlo siempre encendido

```bash
pm2 start worker.mjs --name estradox-whatsapp --node-args="--env-file=.env"
pm2 save
pm2 startup   # copia y ejecuta el comando que te muestre
```

Listo. En Estradox, en **Panel admin → WhatsApp**, aparecen los dos QR en menos de un minuto:

1. **WhatsApp de avisos**: escanéalo con el celular del número de avisos.
2. **WhatsApp comercial**: escanéalo con el celular del número comercial.

En cada celular: WhatsApp → ⋮ o Configuración → **Dispositivos vinculados → Vincular un dispositivo**.

Después usa **Enviar prueba** con tu número para confirmar que llega.

## Comandos útiles

```bash
pm2 logs estradox-whatsapp     # ver lo que está pasando
pm2 restart estradox-whatsapp  # reiniciar (no pide QR otra vez)
pm2 status                     # ver si está encendido
```

Para actualizar el servicio cuando haya cambios en el código:

```bash
cd ~/consultor-rama && git pull && cd whatsapp-worker && npm ci --omit=dev && pm2 restart estradox-whatsapp
```

## Recomendaciones para no perder el número

- Usa **números dedicados** a Estradox, nunca tu número personal.
- Calienta los números: antes de usarlos, chatea normal con ellos unos días.
- Empieza con un máximo bajo, de 30 a 50 por día, y súbelo poco a poco.
- Guarda una foto de perfil y un nombre de empresa en cada WhatsApp.
- Si alguien pide no recibir más mensajes, respétalo: desactívale la opción en su cuenta.
