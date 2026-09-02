# Dependencias para desarrollo
** Instalar NodeJs v 24.15.0 (Solo para modo desarrollo)
** Instalar el gestor de paquetes yarn
npm install -g yarn

# Sincronizacion con el repositorio
** Iniciar Terminal (Ctrl+Shift+P)
Escribir el comando clone
 -> Clone from GitHub (Si es necesario autenticarse desde la we y enlazar la cuenta)
 -> Seleccionar el repositorio trivia-app.git

# Preparar el Backend
** Crea y activa el entorno virtual
ir a la carpeta backend cd .\backend\
py -m venv venv
Powershell
.\venv\Scripts\Activate.ps1
Cmd
.\venv\Scripts\activate.bat
Linux\Mac
source venv/bin/activate
** Actualizar pip
py -m pip install --upgrade pip

# Instalar todas las librerías y dependencias
pip install -r requirements.txt

# Preparar el Frontend
** descargar y sincronizar todas las dependencias
yarn install
** configurar eas cli
npm install -g eas-cli
** autenticar
eas login
**crear el archivo eas.json
eas build:configure
**crear el apk
eas build --platform android --profile preview