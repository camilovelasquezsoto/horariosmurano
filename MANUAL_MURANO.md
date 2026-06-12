# 📖 Manual de Uso - Murano Voley Puerto Montt

Este documento explica cómo utilizar la plataforma web de horarios, tanto para los socios (usuarios normales) como para el personal del club (administradores).

---

## 👥 1. Para Usuarios (Socios / Jugadores)

La plataforma está diseñada para ser rápida e intuitiva. No es necesario tener una cuenta para ver los horarios, pero sí para guardar favoritos.

### ¿Qué puedes hacer sin iniciar sesión?
*   **Ver Horarios por Cancha:** Haz clic en el botón "Gimnasios", selecciona una cancha y haz clic en "Ver Horarios". Verás un calendario con todos los entrenamientos de esa semana para esa cancha específica.
*   **Ver Horarios por Categoría/Profesor:** Si solo te interesa saber cuándo entrena tu categoría (ej. "U18 Damas") o tu profesor, selecciona "Categorías" o "Profesores" en el menú superior. Al hacer clic en "Ver Horarios", el calendario te mostrará en qué cancha y a qué hora son las clases.
*   **Ver Ubicación:** Si la cancha tiene un mapa asociado, se desplegará automáticamente un mapa interactivo (Google Maps).

### ¿Para qué sirve Registrarse?
Si te registras, se activará la función de **Favoritos**.
1.  Haz clic en **Ingresar** (esquina superior derecha).
2.  Si no tienes cuenta, usa la opción **Registrarse** (solo necesitas un correo y una contraseña).
3.  Una vez iniciada la sesión, al ver los horarios notarás un icono de estrella (⭐) en cada bloque.
4.  Si haces clic en la estrella, ese entrenamiento se guardará en tu sección personal.
5.  Puedes acceder a tu lista rápida haciendo clic en el botón verde **"⭐ Favoritos"** en el menú principal.

---

## 🛠️ 2. Para Administradores (Directiva / Entrenadores)

El rol de Administrador te permite crear, modificar y eliminar canchas, profesores, categorías y los bloques de horarios.

### ¿Cómo obtener acceso de Administrador?
Para que el sistema te reconozca como administrador, al momento de registrarte (o crear una cuenta nueva) debes llenar el campo que dice **"Clave admin"**.
*   **Clave por defecto:** `1234`
*(Nota: Solo quienes conozcan esta clave podrán hacer cambios en la base de datos).*

### Panel de Administración
Una vez que ingreses con una cuenta de Administrador, verás un botón azul brillante llamado **"Admin"** en la esquina superior derecha. Haz clic ahí para entrar al Panel de Control.

El panel se divide en 3 secciones principales:

#### A. Crear Entrenamiento (Asignar un bloque de horario)
Aquí es donde armas el calendario.
1.  Selecciona la **Cancha** (Gimnasio).
2.  Selecciona la **Categoría**.
3.  Selecciona el **Día de la semana** y el **Bloque de Hora**.
4.  Haz clic en **"Crear Entrenamiento"**. El calendario se actualizará automáticamente para todos los usuarios.

#### B. Crear Nuevas Canchas / Categorías
Si el club suma una nueva cancha o una nueva categoría, agrégala aquí:
*   **Gimnasio (Cancha):** Escribe el nombre (ej. "Cancha 4"). En "Dirección", si pegas un enlace de Google Maps (ej. `https://maps.app.goo.gl/...`), la plataforma lo detectará y mostrará el mapa dinámico. En URL de imagen, puedes pegar un link a una foto (si lo dejas en blanco, se usará un color por defecto).
*   **Categoría:** Escribe el nombre de la categoría (ej. "U10 Mixto") y asigna el nombre del profesor a cargo.

#### C. Gestión de Datos (Eliminar y Limpiar)
Al final del panel, encontrarás listas desplegables con todas las canchas y categorías creadas.
*   Si una categoría deja de existir, un profesor se va, o creaste una cancha por error, simplemente búscalo en la lista y presiona **"Borrar"**.
*   **⚠️ Cuidado:** Si borras una Categoría, se borrarán automáticamente todos los horarios (entrenamientos) que estaban asignados a esa categoría. Esto mantiene la base de datos limpia.

### ¿Cómo eliminar un horario específico?
No necesitas entrar al panel de administración. Simplemente ve a la vista normal de la página (como cualquier usuario), busca el horario que te equivocaste (ej. Lunes a las 19:00 en Cancha 1), expande el calendario, y como eres Administrador, verás un botón rojo con una **"X"** junto a la estrella de favoritos. Haz clic en la "X" para eliminar solo ese bloque.