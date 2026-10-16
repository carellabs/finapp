"""
Prueba del alta de usuario (`node dist/crear-usuario.js`) con un TERMINAL DE VERDAD: un pty.

Corre DENTRO de la imagen del pty (scripts/pty/Dockerfile: la de production mas python3), lanzada
por scripts/verificar-imagenes.mjs: asi no depende de Python en la maquina de quien la ejecuta (ni en
Windows ni en el runner de GitHub). Solo usa la libreria estandar.

Cada escenario arranca el alta en un pty nuevo, espera a que aparezca cada pregunta (no duerme a
ciegas: teclear antes de que el script este listo falsearia el resultado) y escribe como lo haria una
persona, o un gestor de contrasenas (la contrasena entera, con su Enter, de un golpe). Comprueba:
  - que el terminal tiene el ECO DESACTIVADO mientras se pide la contrasena (termios del pty);
  - que NADA de lo tecleado aparece en lo que el pty mostro (la salida completa);
  - el codigo de salida y el mensaje.
Que el usuario se haya creado (o no) y que su hash sea el de la contrasena que se tecleo lo
comprueba el script de Node, contra la base de datos.

Las contrasenas llegan por el ENTORNO de este proceso (PTY_CLAVE_*) y se quitan de el antes de lanzar
el alta: el script bajo prueba no debe heredarlas.

Salida: una linea `PTY {json}` por escenario ({"nombre", "ok", "detalle"}); termina con 0 si todos
pasaron. Nada de lo tecleado se imprime.
"""
import json
import os
import pty
import select
import sys
import termios
import time

COMANDO = ["node", "dist/crear-usuario.js"]
ESPERA = 30  # segundos por pregunta
ESC = b"\x1b"
CTRL_C = b"\x03"


class Fallo(Exception):
    pass


class Alta:
    """El alta corriendo en un pty."""

    def __init__(self):
        self.pid, self.fd = pty.fork()
        if self.pid == 0:
            os.execvp(COMANDO[0], COMANDO)
        self.salida = b""
        self.cursor = 0

    def _leer(self, limite):
        listo, _, _ = select.select([self.fd], [], [], limite)
        if not listo:
            return True
        try:
            datos = os.read(self.fd, 65536)
        except OSError:  # EIO: el hijo cerro su lado del pty
            return False
        if not datos:
            return False
        self.salida += datos
        return True

    def esperar(self, texto):
        """Espera a que aparezca `texto` en lo que el pty ha mostrado DESDE la pregunta anterior."""
        objetivo = texto.encode()
        fin = time.time() + ESPERA
        while True:
            posicion = self.salida.find(objetivo, self.cursor)
            if posicion >= 0:
                self.cursor = posicion + len(objetivo)
                return
            if time.time() > fin:
                raise Fallo("no aparecio %r a tiempo" % texto)
            if not self._leer(0.2):
                if objetivo in self.salida[self.cursor :]:
                    continue
                raise Fallo("el proceso termino antes de mostrar %r" % texto)

    def eco_activo(self):
        return bool(termios.tcgetattr(self.fd)[3] & termios.ECHO)

    def enviar(self, datos):
        os.write(self.fd, datos)

    def terminar(self):
        """Espera a que acabe y devuelve su codigo de salida."""
        fin = time.time() + ESPERA
        while True:
            self._leer(0.1)
            pid, estado = os.waitpid(self.pid, os.WNOHANG)
            if pid:
                break
            if time.time() > fin:
                os.kill(self.pid, 9)
                raise Fallo("el proceso no termino")
        # Lo que quedara por leer del pty.
        while self._leer(0.1):
            pass
        os.close(self.fd)
        if os.WIFEXITED(estado):
            return os.WEXITSTATUS(estado)
        return 128 + os.WTERMSIG(estado)

    def texto(self):
        return self.salida.decode("utf-8", "replace")


def sin_clave(alta, *claves):
    for clave in claves:
        if clave in alta.texto():
            raise Fallo("una contrasena tecleada aparece en lo que el terminal mostro")


def escenario_pegado(clave):
    """Alta correcta: la contrasena (con espacios) se PEGA con su Enter, dos veces."""
    alta = Alta()
    alta.esperar("Nombre de usuario: ")
    alta.enviar(b"pty-pegado\r")
    alta.esperar("Contrasena (no se mostrara): ")
    if alta.eco_activo():
        raise Fallo("el terminal tiene el eco ACTIVO mientras se pide la contrasena")
    alta.enviar(clave.encode() + b"\r")
    alta.esperar("Repite la contrasena: ")
    if alta.eco_activo():
        raise Fallo("el terminal tiene el eco ACTIVO mientras se pide la repeticion")
    alta.enviar(clave.encode() + b"\r")
    codigo = alta.terminar()
    if codigo != 0:
        raise Fallo("salio con %d, no con 0" % codigo)
    if "creado/actualizado correctamente" not in alta.texto():
        raise Fallo("no confirma el alta")
    sin_clave(alta, clave)
    return "alta correcta, eco desactivado, la contrasena no se vio"


def escenario_escape(clave):
    """Una flecha en medio de la contrasena no se cuela en ella (ni se come el Enter)."""
    alta = Alta()
    alta.esperar("Nombre de usuario: ")
    alta.enviar(b"pty-esc\r")
    cortada = clave.encode()
    for pregunta in ("Contrasena (no se mostrara): ", "Repite la contrasena: "):
        alta.esperar(pregunta)
        # Flecha izquierda (ESC [ D) a mitad de la contrasena, y todo con su Enter en un golpe.
        alta.enviar(cortada[:4] + ESC + b"[D" + cortada[4:] + b"\r")
    codigo = alta.terminar()
    if codigo != 0:
        raise Fallo("salio con %d, no con 0" % codigo)
    sin_clave(alta, clave)
    return "la secuencia de escape se descarto y el Enter llego"


def escenario_distintas(clave, otra):
    """Dos contrasenas distintas: falla con 1, sin crear nada y sin mostrarlas."""
    alta = Alta()
    alta.esperar("Nombre de usuario: ")
    alta.enviar(b"pty-distintas\r")
    alta.esperar("Contrasena (no se mostrara): ")
    alta.enviar(clave.encode() + b"\r")
    alta.esperar("Repite la contrasena: ")
    alta.enviar(otra.encode() + b"\r")
    codigo = alta.terminar()
    if codigo != 1:
        raise Fallo("salio con %d, no con 1" % codigo)
    if "no coinciden" not in alta.texto():
        raise Fallo("no dice que las contrasenas no coinciden")
    sin_clave(alta, clave, otra)
    return "falla con 1 y no muestra ninguna contrasena"


def escenario_ctrl_c():
    """Ctrl-C tecleando la contrasena: cancela con 130 y no muestra lo tecleado."""
    alta = Alta()
    alta.esperar("Nombre de usuario: ")
    alta.enviar(b"pty-ctrlc\r")
    alta.esperar("Contrasena (no se mostrara): ")
    alta.enviar(b"parcial-xyz")
    alta.enviar(CTRL_C)
    codigo = alta.terminar()
    if codigo != 130:
        raise Fallo("salio con %d, no con 130" % codigo)
    if "Cancelado" not in alta.texto():
        raise Fallo("no dice que se cancelo")
    sin_clave(alta, "parcial-xyz")
    return "cancela con 130 y no muestra lo tecleado"


def principal():
    clave_pegada = os.environ.pop("PTY_CLAVE_PEGADA")
    clave_escape = os.environ.pop("PTY_CLAVE_ESCAPE")
    clave_otra = os.environ.pop("PTY_CLAVE_OTRA")
    escenarios = [
        ("pegado", lambda: escenario_pegado(clave_pegada)),
        ("escape", lambda: escenario_escape(clave_escape)),
        ("distintas", lambda: escenario_distintas(clave_pegada, clave_otra)),
        ("ctrl-c", escenario_ctrl_c),
    ]
    todo_bien = True
    for nombre, ejecutar in escenarios:
        try:
            resultado = {"nombre": nombre, "ok": True, "detalle": ejecutar()}
        except Fallo as fallo:
            todo_bien = False
            resultado = {"nombre": nombre, "ok": False, "detalle": str(fallo)}
        print("PTY " + json.dumps(resultado, ensure_ascii=False))
        sys.stdout.flush()
    sys.exit(0 if todo_bien else 1)


if __name__ == "__main__":
    principal()
