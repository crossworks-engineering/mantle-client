#!/usr/bin/env python3
"""The scripted sign-in test for the Tauri shell on Linux.

Drives the release build through tauri-driver and WebKitWebDriver, with a
small WebDriver client on the standard library only. Run by run.sh, inside
the Linux image, in one dbus session whose GNOME Keyring is unlocked.

Two profiles name the SAME brain at two origins (127.0.0.1 and localhost):
two profiles, so two windows' data folders and two keychain namespaces.

  a  brain A last used: lands on /login; signs up (fresh brain) or in; lands
     signed in; localStorage holds the presence pref and the session rows,
     and no bearer
  b  quit and start again: still signed in, the bearer read back from the
     keychain and accepted by the brain
  c  brain B last used: B's window is on /login, holds nothing of A's;
     signs in there too
  d  brain A last used again: A still signed in, nothing of B's in it
  f  brain A last used, the shell tracing: A's window goes to /invite (a
     link-code page, served with its own Referrer-Policy) and reads the
     active session's bearer through tokenVault there, as the invite page
     does when it signs someone in; the shell must answer it, and the test
     prints the Origin the shell saw on that request
  g  in that same signed-in window, three frames inside the UI page each
     send the vault call themselves (a harmless getFor of an id no login
     has): a frame on the brain's origin (the brain's /api/version; the
     brain serves no HTML, so WebDriver switches into that JSON document
     and runs the call there), a sandboxed srcdoc frame (allow-scripts
     only: an opaque origin) that reports by postMessage, and a
     same-origin about:blank frame whose script the UI page writes. The
     first two must be refused, the third answered (it is the UI's own
     origin, as the page itself is). The test prints, per frame, what the
     frame saw and the method and Origin the shell traced. Then the page
     asks Tauri's IPC for the opener plugin's open_url and for an app
     command: a brain window has no command, so both must fail
  e  no keychain (a dbus session with no Secret Service): the app starts
     and says at once, in a notice window that does not block, that logins
     last until you quit; its OK closes it; a sign-in WORKS for that run,
     the bearer held by the shell only (in memory: not in localStorage, not
     on disk); the notice is shown once in the run; the next run is back on
     /login, holds nothing, and says it again

The vault is read the way the page reads it: through
window.mantleDesktop.tokenVault, the synchronous API, which asks the shell
on every call.

Prints a PASS or FAIL line per check and exits non-zero on any failure.
Never prints a password, a setup code or a bearer: the checks on those are
made in the page and come back as booleans, except step e's disk scan,
which holds the bearer in this process to look for it in the app's files
and never prints it.
"""

import json
import os
import shutil
import socket
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
import uuid

IDENTIFIER = "engineering.crossworks.mantleos-desktop"
ELEMENT = "element-6066-11e4-a456-4a8e5e1e1b69"
# The keychain notice's window title (windows.rs, notice_page).
NOTICE = "Logins last until you quit"

BIN = os.environ.get("MANTLE_DESKTOP_BIN", "/work/target/release/mantle-desktop")
PORT = os.environ["MANTLE_TEST_BRAIN_PORT"]
LOGIN_FILE = os.environ.get("MANTLE_TEST_LOGIN_FILE", "/run/t1/test-login")
SCRATCH = os.environ["MANTLE_E2E_SCRATCH"]
NO_KEYCHAIN_BUS = os.environ.get("MANTLE_E2E_NO_KEYCHAIN_BUS", "")
DRIVER_PORT = int(os.environ.get("MANTLE_E2E_DRIVER_PORT", "18444"))
NATIVE_PORT = int(os.environ.get("MANTLE_E2E_NATIVE_PORT", "18445"))

ORIGIN_A = f"http://127.0.0.1:{PORT}"
ORIGIN_B = f"http://localhost:{PORT}"

failures = []


def check(name, ok, detail=""):
    print(f"{'PASS' if ok else 'FAIL'} {name}{': ' + detail if detail else ''}", flush=True)
    if not ok:
        failures.append(name)
    return ok


def note(text):
    print(f"  .. {text}", flush=True)


def read_login():
    values = {}
    with open(LOGIN_FILE, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                key, value = line.split("=", 1)
                values[key] = value
    return values["MANTLE_TEST_EMAIL"], values["MANTLE_TEST_PASSWORD"], values.get("MANTLE_TEST_SETUP_CODE", "")


def brain_first_run():
    with urllib.request.urlopen(f"{ORIGIN_A}/api/auth/bootstrap-state", timeout=10) as res:
        return bool(json.load(res).get("firstRun"))


# ── a home for the app: its config and data folders, fresh per test run ─────


class Home:
    def __init__(self, name):
        self.root = os.path.join(SCRATCH, name)
        self.config = os.path.join(self.root, "config", IDENTIFIER)
        self.data = os.path.join(self.root, "data", IDENTIFIER)
        os.makedirs(self.config, exist_ok=True)
        os.makedirs(self.data, exist_ok=True)

    def env(self, bus):
        env = dict(os.environ)
        env.update(
            {
                "XDG_CONFIG_HOME": os.path.join(self.root, "config"),
                "XDG_DATA_HOME": os.path.join(self.root, "data"),
                "XDG_CACHE_HOME": os.path.join(self.root, "cache"),
                "DBUS_SESSION_BUS_ADDRESS": bus,
                "TAURI_WEBVIEW_AUTOMATION": "true",
            }
        )
        return env

    @property
    def profiles_path(self):
        return os.path.join(self.config, "profiles.json")

    def write_profiles(self, profiles):
        with open(self.profiles_path, "w", encoding="utf-8") as f:
            json.dump(profiles, f, indent=2)

    def read_profiles(self):
        with open(self.profiles_path, encoding="utf-8") as f:
            return json.load(f)

    def make_last_used(self, profile_id):
        profiles = self.read_profiles()
        newest = max((p.get("lastUsedAt") or 0) for p in profiles)
        for p in profiles:
            if p["id"] == profile_id:
                p["lastUsedAt"] = newest + 1000
        self.write_profiles(profiles)

    def brain_dir(self, profile_id):
        return os.path.join(self.data, "brains", profile_id)

    def vault_index(self, profile_id):
        return os.path.join(self.data, "vault", f"{profile_id}.json")


# ── a WebDriver client, the few commands this test needs ─────────────────────


class WebDriverError(Exception):
    pass


def wd(method, url, body=None, timeout=120):
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("content-type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as res:
            payload = json.load(res)
    except urllib.error.HTTPError as e:
        try:
            payload = json.load(e)
        except Exception:
            payload = {"value": {"error": str(e)}}
        value = payload.get("value") or {}
        raise WebDriverError(f"{value.get('error')}: {value.get('message', '')[:200]}") from None
    return payload.get("value")


def port_open(port):
    with socket.socket() as s:
        s.settimeout(0.5)
        return s.connect_ex(("127.0.0.1", port)) == 0


def app_pids():
    """Processes running the app binary (read from /proc: no procps here)."""
    pids = []
    for name in os.listdir("/proc"):
        if not name.isdigit():
            continue
        try:
            with open(f"/proc/{name}/cmdline", "rb") as f:
                argv0 = f.read().split(b"\0", 1)[0].decode(errors="replace")
        except OSError:
            continue
        if argv0 == BIN or argv0.endswith("/mantle-desktop"):
            pids.append(int(name))
    return pids


class App:
    """One run of the app: tauri-driver, a WebDriver session, the window."""

    def __init__(self, home, bus, log_name, trace=False):
        if app_pids():
            raise RuntimeError(f"an app process is still running ({app_pids()})")
        self.log_path = os.path.join(SCRATCH, log_name)
        self.log = open(self.log_path, "wb")
        self.driver = subprocess.Popen(
            [
                shutil.which("tauri-driver") or "tauri-driver",
                "--port",
                str(DRIVER_PORT),
                "--native-port",
                str(NATIVE_PORT),
                "--native-driver",
                shutil.which("WebKitWebDriver") or "/usr/bin/WebKitWebDriver",
            ],
            env=dict(home.env(bus), **({"MANTLE_DESKTOP_TRACE": "1"} if trace else {})),
            stdout=self.log,
            stderr=subprocess.STDOUT,
        )
        self.base = f"http://127.0.0.1:{DRIVER_PORT}"
        deadline = time.time() + 20
        while not port_open(DRIVER_PORT):
            if time.time() > deadline or self.driver.poll() is not None:
                raise RuntimeError("tauri-driver did not start")
            time.sleep(0.2)
        caps = {"capabilities": {"alwaysMatch": {"tauri:options": {"application": BIN}}}}
        self.session = wd("POST", f"{self.base}/session", caps)["sessionId"]
        self.started = time.time()
        # The keychain notice is a window of the app's own, which WebDriver
        # cannot reach (automation is the first web context's only). A
        # watcher answers it the way a user would: it focuses the window and
        # presses Return, which is the autofocused OK. Each notice seen is
        # counted, and so is each one that went away after its OK.
        self.notices = set()
        self.closed = set()
        self.watching = threading.Event()
        self.watcher = threading.Thread(target=self.answer_notices, daemon=True)
        self.watcher.start()

    def answer_notices(self):
        while not self.watching.is_set():
            try:
                found = subprocess.run(
                    ["xdotool", "search", "--onlyvisible", "--name", NOTICE],
                    capture_output=True, text=True, timeout=5,
                ).stdout.split()
                for window in self.notices - set(found) - self.closed:
                    self.closed.add(window)
                    note("the notice window is gone after its OK")
                for window in found:
                    if window not in self.notices:
                        self.notices.add(window)
                        note(f"the notice window is up ({NOTICE!r}); pressing OK")
                        # Its page loads after the window maps.
                        time.sleep(1.5)
                    subprocess.run(["xdotool", "windowfocus", "--sync", window], timeout=5,
                                   capture_output=True)
                    subprocess.run(["xdotool", "key", "--clearmodifiers", "Return"], timeout=5,
                                   capture_output=True)
            except (OSError, subprocess.SubprocessError):
                pass
            time.sleep(0.5)

    def wait_notice_closed(self, timeout=20):
        deadline = time.time() + timeout
        while time.time() < deadline:
            if self.notices and self.notices <= self.closed:
                return True
            time.sleep(0.3)
        return False

    def cmd(self, method, path, body=None, timeout=120):
        return wd(method, f"{self.base}/session/{self.session}{path}", body, timeout)

    def url(self):
        return self.cmd("GET", "/url")

    def path(self):
        url = self.url() or ""
        rest = url.split("://", 1)[-1]
        return "/" + rest.split("/", 1)[1] if "/" in rest else "/"

    def js(self, script, *args):
        return self.cmd("POST", "/execute/sync", {"script": script, "args": list(args)})

    def js_async(self, script, *args):
        return self.cmd("POST", "/execute/async", {"script": script, "args": list(args)})

    def find(self, css, timeout=20):
        deadline = time.time() + timeout
        while True:
            try:
                found = self.cmd("POST", "/element", {"using": "css selector", "value": css})
                # The W3C key, or the legacy one an older driver answers with.
                return found.get(ELEMENT) or found.get("ELEMENT") or next(iter(found.values()))
            except WebDriverError:
                if time.time() > deadline:
                    return None
                time.sleep(0.3)

    def type_into(self, element, text):
        self.cmd("POST", f"/element/{element}/value", {"text": text})

    def click(self, element):
        self.cmd("POST", f"/element/{element}/click", {})

    def landed(self, timeout=40, quiet=3.0):
        """The path once the page has settled: loaded, and on one path for
        `quiet` seconds (the boot guard moves a signed-out load to /login)."""
        deadline = time.time() + timeout
        last, since = None, time.time()
        while time.time() < deadline:
            try:
                ready = self.js("return document.readyState") == "complete"
                path = self.path()
            except WebDriverError:
                ready, path = False, None
            if path != last:
                last, since = path, time.time()
            elif ready and time.time() - since >= quiet and time.time() - self.started > 4:
                return path
            time.sleep(0.3)
        return last

    def wait_off_login(self, timeout=45):
        deadline = time.time() + timeout
        while time.time() < deadline:
            path = self.path()
            if not path.startswith("/login"):
                return path
            time.sleep(0.5)
        return self.path()

    def storage(self):
        return self.js(
            "var o = {}; for (var i = 0; i < localStorage.length; i++) {"
            " var k = localStorage.key(i); o[k] = localStorage.getItem(k); } return o;"
        )

    def vault_report(self, origin, email, probe_ids=()):
        """What this window's vault holds, checked in the page through the
        page's own synchronous API: which of the listed sessions (and of
        `probe_ids`, ids from another brain) have a bearer, whether the
        active one does, whether any bearer is also in localStorage, and
        whether the brain accepts the active one. Only booleans and ids
        come back, never a bearer."""
        return self.js_async(
            """
var origin = arguments[0], email = arguments[1], probe = arguments[2];
var done = arguments[arguments.length - 1];
var d = window.mantleDesktop;
var v = d && d.tokenVault;
if (!v || typeof v.getFor !== 'function') { done({ error: 'no tokenVault on this page' }); return; }
var rows = [];
try { rows = JSON.parse(localStorage.getItem('mantle_sessions') || '[]'); } catch (e) {}
var ids = [], held = {};
rows.forEach(function (r) {
  var t = r && typeof r.id === 'string' ? v.getFor(r.id) : null;
  if (t) { ids.push(r.id); held[r.id] = t; }
});
var probed = probe.filter(function (id) { return v.getFor(id) !== null; });
var all = [];
for (var i = 0; i < localStorage.length; i++) {
  var k = localStorage.key(i);
  all.push(k + '\\n' + localStorage.getItem(k));
}
var leaked = ids.some(function (id) {
  return all.some(function (e) { return e.indexOf(held[id]) !== -1; });
});
var active = localStorage.getItem('mantle_active_session');
var token = active ? v.getFor(active) : null;
var out = {
  ids: ids, probed: probed, activeHeld: !!token, leaked: leaked,
  whoami: null, sameEmail: null
};
if (!token) { done(out); return; }
fetch(origin + '/api/auth/whoami', { headers: { authorization: 'Bearer ' + token } })
  .then(function (r) { out.whoami = r.status; return r.ok ? r.json() : null; })
  .then(function (body) { out.sameEmail = !!body && body.email === email; done(out); })
  .catch(function (e) { out.whoami = 'error ' + e; done(out); });
""",
            origin,
            email,
            list(probe_ids),
        )

    def active_bearer(self):
        """The active session's bearer, for the disk scan only. Kept in this
        process, never printed."""
        return self.js(
            "var v = window.mantleDesktop && window.mantleDesktop.tokenVault;"
            " var a = localStorage.getItem('mantle_active_session');"
            " return v && a ? v.getFor(a) : null;"
        )

    def quit(self):
        # Give WebKit a moment to write what the page stored, then end the
        # session: WebKitWebDriver closes the app.
        time.sleep(2)
        try:
            self.cmd("DELETE", "", timeout=30)
        except Exception as e:  # noqa: BLE001 - the app may already be gone
            note(f"ending the session: {e}")
        self.driver.terminate()
        try:
            self.driver.wait(10)
        except subprocess.TimeoutExpired:
            self.driver.kill()
        deadline = time.time() + 15
        while app_pids() and time.time() < deadline:
            time.sleep(0.3)
        for pid in app_pids():
            note(f"app process {pid} still running after quit; stopping it")
            os.kill(pid, 15)
        time.sleep(0.5)
        self.watching.set()
        self.watcher.join(10)
        self.log.close()

    def log_text(self):
        with open(self.log_path, "rb") as f:
            return f.read().decode(errors="replace")


# ── the steps ────────────────────────────────────────────────────────────────


def submit_login(app, email, password, setup_code, label):
    """Fill the login form (or the first-run signup) and submit it. False
    (with a FAIL line) when the form is not there."""
    signup = brain_first_run()
    note(f"{label}: the brain is {'fresh: signing up the owner' if signup else 'claimed: signing in'}")
    email_el = app.find("#email")
    password_el = app.find("#password")
    if not (email_el and password_el):
        return check(f"{label}: the sign-in form is there", False)
    app.type_into(email_el, email)
    app.type_into(password_el, password)
    if signup:
        code_el = app.find("#setup-code", timeout=15)
        if not code_el:
            return check(f"{label}: the setup code field is there", False)
        app.type_into(code_el, setup_code)
    button = app.find("form button[type=submit]")
    if not button:
        return check(f"{label}: the submit button is there", False)
    app.click(button)
    return True


def sign_in(app, email, password, setup_code, label):
    """Sign in, and check the window lands off /login."""
    if not submit_login(app, email, password, setup_code, label):
        return False
    path = app.wait_off_login()
    if path.startswith("/login"):
        error = app.js(
            "var e = document.querySelector('form .text-destructive-ink');"
            " return e ? e.textContent : null;"
        )
        return check(f"{label}: signed in", False, f"still on {path} ({error or 'no error shown'})")
    return check(f"{label}: signed in", True, f"now on {path}")


def storage_checks(app, label, origin, other_origin):
    store = app.storage() or {}
    keys = sorted(store)
    note(f"{label}: localStorage keys: {', '.join(keys) or '(none)'}")
    check(f"{label}: the presence pref is stored", "mantle_pref:mantle_authed" in store)
    try:
        sessions = json.loads(store.get("mantle_sessions") or "[]")
    except ValueError:
        sessions = []
    check(f"{label}: session rows are stored", len(sessions) >= 1, f"{len(sessions)} row(s)")
    check(
        f"{label}: every session row is for this brain",
        bool(sessions) and all(s.get("origin") == origin for s in sessions),
    )
    check(f"{label}: an active session is set", bool(store.get("mantle_active_session")))
    check(
        f"{label}: no bearer key in localStorage",
        not any(k == "mantle_token" or k.startswith("mantle_token:") for k in keys),
    )
    check(
        f"{label}: nothing in localStorage names the other brain",
        not any(other_origin in (store[k] or "") for k in keys),
    )
    return store


def vault_checks(app, label, origin, email, expect_ids=None):
    report = app.vault_report(origin, email) or {}
    if report.get("error"):
        return check(f"{label}: the vault answers", False, report["error"])
    check(f"{label}: the active session's bearer is in the vault", report.get("activeHeld") is True)
    check(f"{label}: no bearer is also in localStorage", report.get("leaked") is False)
    check(
        f"{label}: the brain accepts that bearer",
        report.get("whoami") == 200 and report.get("sameEmail") is True,
        f"whoami {report.get('whoami')}",
    )
    if expect_ids is not None:
        check(
            f"{label}: the vault holds this brain's logins only",
            sorted(report.get("ids") or []) == sorted(expect_ids),
            f"{len(report.get('ids') or [])} login(s)",
        )
    return report


# The vault call each frame sends: getFor of an id no login has, so even an
# answer carries no bearer. Reports the status (or the error) and the
# frame's own origin. `report` is how the answer gets out.
FRAME_CALL = """
var out = { origin: String(self.origin) };
try {
  var x = new XMLHttpRequest();
  x.open('POST', 'mantle-ui://localhost/_mantle/vault', false);
  x.setRequestHeader('X-Mantle-Vault', '1');
  x.send(JSON.stringify({ op: 'getFor', sessionId: 'frame-probe' }));
  out.status = x.status;
} catch (e) {
  out.error = String((e && e.name) || e);
}
"""


UI = "mantle-ui://localhost"


def trace_lines(app, mark, ui=False):
    """The vault trace lines written since `mark`, as `<method or op>
    origin <Origin> -> <status>`: those with an Origin other than the UI's,
    or (ui=True) those with the UI's. The UI page reads the vault itself all
    the time, so a line with the UI's Origin cannot be told apart from the
    page's own. The label is left out (it names the profile); there is
    never a token in these lines."""
    seen = []
    for line in app.log_text()[mark:].splitlines():
        if "[mantle-desktop] vault " not in line or "(origin " not in line:
            continue
        what = line.split("[mantle-desktop] vault ", 1)[1].split(" from ", 1)[0]
        origin = line.split("(origin ", 1)[1].split(")", 1)[0]
        if (origin == UI) != ui:
            continue
        status = line.rsplit("-> ", 1)[-1].strip()
        seen.append(f"{what} origin {origin} -> {status}")
    return seen


def frame_report(result):
    if not isinstance(result, dict):
        return f"no answer ({result!r})"
    got = f"status {result['status']}" if "status" in result else f"error {result.get('error')}"
    return f"{got}, frame origin {result.get('origin')}"


def frame_checks(app):
    """g: the vault from three frames inside the UI page, and no Tauri
    command from the page. See the module docstring."""
    app.js(
        "document.querySelectorAll('iframe[id^=mantle-probe-]').forEach(function (f) { f.remove(); });"
    )

    # a: the brain's origin. WebDriver runs the call inside that frame.
    mark = len(app.log_text())
    loaded = app.js_async(
        """
var done = arguments[arguments.length - 1];
var f = document.createElement('iframe');
f.id = 'mantle-probe-a';
f.onload = function () { done(true); };
setTimeout(function () { done(false); }, 15000);
f.src = arguments[0] + '/api/version';
document.body.appendChild(f);
""",
        ORIGIN_A,
    )
    result_a = None
    frame = app.find("iframe#mantle-probe-a", timeout=5)
    if loaded and frame:
        try:
            app.cmd("POST", "/frame", {"id": {ELEMENT: frame}})
            result_a = app.js(FRAME_CALL + "return out;")
        except WebDriverError as e:
            result_a = {"error": f"webdriver: {e}"}
        finally:
            app.cmd("POST", "/frame/parent", {})
    time.sleep(0.5)
    shell_a = trace_lines(app, mark)
    note(f"g: brain-origin frame: {frame_report(result_a)}; shell saw: {'; '.join(shell_a) or 'nothing'}")
    check(
        "g: a frame on the brain's origin is refused the vault",
        isinstance(result_a, dict) and result_a.get("origin") == ORIGIN_A and result_a.get("status") != 200,
        frame_report(result_a),
    )

    # b: a sandboxed srcdoc frame (opaque origin), reporting by postMessage.
    mark = len(app.log_text())
    result_b = app.js_async(
        """
var done = arguments[arguments.length - 1];
var f = document.createElement('iframe');
f.id = 'mantle-probe-b';
f.setAttribute('sandbox', 'allow-scripts');
window.addEventListener('message', function heard(e) {
  if (e.source !== f.contentWindow) return;
  window.removeEventListener('message', heard);
  done(e.data);
});
setTimeout(function () { done('timeout'); }, 15000);
f.srcdoc = '<script>' + arguments[0] + 'parent.postMessage(out, "*");<\/script>';
document.body.appendChild(f);
""",
        FRAME_CALL,
    )
    time.sleep(0.5)
    shell_b = trace_lines(app, mark)
    note(f"g: sandboxed srcdoc frame: {frame_report(result_b)}; shell saw: {'; '.join(shell_b) or 'nothing'}")
    check(
        "g: a sandboxed srcdoc frame is refused the vault",
        isinstance(result_b, dict) and result_b.get("origin") == "null" and result_b.get("status") != 200,
        frame_report(result_b),
    )

    # c: a same-origin about:blank frame, its script written by the UI page.
    mark = len(app.log_text())
    result_c = app.js_async(
        """
var done = arguments[arguments.length - 1];
var f = document.createElement('iframe');
f.id = 'mantle-probe-c';
document.body.appendChild(f);
window.addEventListener('message', function heard(e) {
  if (e.source !== f.contentWindow) return;
  window.removeEventListener('message', heard);
  done(e.data);
});
setTimeout(function () { done('timeout'); }, 15000);
var doc = f.contentWindow.document;
var s = doc.createElement('script');
s.textContent = arguments[0] + 'parent.postMessage(out, "*");';
(doc.body || doc.documentElement).appendChild(s);
""",
        FRAME_CALL,
    )
    time.sleep(0.5)
    shell_c = trace_lines(app, mark, ui=True)
    note(
        f"g: same-origin about:blank frame: {frame_report(result_c)}; shell saw (with the page's own calls): "
        f"{'; '.join(sorted(set(shell_c))) or 'nothing'}"
    )
    check(
        "g: a same-origin about:blank frame is answered, as the UI page is",
        isinstance(result_c, dict)
        and result_c.get("origin") == UI
        and result_c.get("status") == 200
        and any(line.endswith("-> 200") for line in shell_c),
        frame_report(result_c),
    )
    app.js(
        "document.querySelectorAll('iframe[id^=mantle-probe-]').forEach(function (f) { f.remove(); });"
    )

    # No Tauri command from the page: the opener plugin's, and an app one.
    ipc = app.js_async(
        """
var done = arguments[arguments.length - 1];
var t = window.__TAURI_INTERNALS__;
var out = { internals: !!t };
if (!t || typeof t.invoke !== 'function') { done(out); return; }
function attempt(cmd, args) {
  return Promise.race([
    t.invoke(cmd, args).then(
      function () { return 'resolved'; },
      function (e) { return 'rejected: ' + String(e).slice(0, 160); }
    ),
    new Promise(function (r) { setTimeout(function () { r('no answer in 10 s'); }, 10000); })
  ]);
}
Promise.all([
  attempt('plugin:opener|open_url', { url: 'https://example.invalid' }),
  attempt('profiles_list', {})
]).then(function (r) { out.opener = r[0]; out.app = r[1]; done(out); });
"""
    ) or {}
    note(
        f"g: IPC from the brain window: __TAURI_INTERNALS__ {'present' if ipc.get('internals') else 'absent'}; "
        f"open_url {ipc.get('opener', '(not tried)')}; profiles_list {ipc.get('app', '(not tried)')}"
    )
    for name, key in (("the opener plugin's open_url", "opener"), ("an app command (profiles_list)", "app")):
        outcome = ipc.get(key)
        check(
            f"g: the brain window cannot call {name}",
            not ipc.get("internals") or (isinstance(outcome, str) and outcome.startswith("rejected")),
            outcome or "no __TAURI_INTERNALS__",
        )


def main():
    email, password, setup_code = read_login()
    bus = os.environ["DBUS_SESSION_BUS_ADDRESS"]
    if not os.path.exists(BIN):
        print(f"FAIL the app binary is missing: {BIN}")
        return 1

    home = Home("home-keychain")
    id_a, id_b = str(uuid.uuid4()), str(uuid.uuid4())
    now = int(time.time() * 1000)
    home.write_profiles(
        [
            {"id": id_a, "origin": ORIGIN_A, "name": "Brain A", "lastUsedAt": now},
            {"id": id_b, "origin": ORIGIN_B, "name": "Brain B", "lastUsedAt": now - 60_000},
        ]
    )

    # a
    print("== a: brain A, first start", flush=True)
    app = App(home, bus, "run-a.log")
    try:
        path = app.landed()
        check("a: the window lands on /login", path.startswith("/login"), f"landed on {path}")
        if sign_in(app, email, password, setup_code, "a"):
            time.sleep(2)
            storage_checks(app, "a", ORIGIN_A, ORIGIN_B)
            report_a = vault_checks(app, "a", ORIGIN_A, email)
        else:
            report_a = {}
    finally:
        app.quit()
    ids_a = report_a.get("ids") or []
    check("a: the vault index for A is written", os.path.exists(home.vault_index(id_a)))
    check("a: no keychain notice with a keychain", len(app.notices) == 0, f"{len(app.notices)} dialog(s)")

    # b
    print("== b: quit, start again", flush=True)
    app = App(home, bus, "run-b.log")
    try:
        path = app.landed()
        check("b: still signed in (lands off /login)", not path.startswith("/login"), f"landed on {path}")
        storage_checks(app, "b", ORIGIN_A, ORIGIN_B)
        vault_checks(app, "b", ORIGIN_A, email, expect_ids=ids_a)
    finally:
        app.quit()

    # c
    print("== c: brain B last used", flush=True)
    home.make_last_used(id_b)
    app = App(home, bus, "run-c.log")
    try:
        path = app.landed()
        check("c: B's window lands on /login", path.startswith("/login"), f"landed on {path}")
        store = app.storage() or {}
        check(
            "c: B's localStorage holds no session of A's",
            "mantle_sessions" not in store and "mantle_pref:mantle_authed" not in store,
            f"keys: {', '.join(sorted(store)) or '(none)'}",
        )
        held = app.vault_report(ORIGIN_B, email, ids_a) or {}
        check(
            "c: B's vault holds no login, and none of A's",
            held.get("ids") == [] and held.get("probed") == [] and not held.get("error"),
            held.get("error") or f"{len(held.get('ids') or [])} login(s), {len(held.get('probed') or [])} of A's",
        )
        if sign_in(app, email, password, setup_code, "c"):
            time.sleep(2)
            storage_checks(app, "c", ORIGIN_B, ORIGIN_A)
            report_b = vault_checks(app, "c", ORIGIN_B, email)
        else:
            report_b = {}
    finally:
        app.quit()
    ids_b = report_b.get("ids") or []
    check(
        "c: A and B have their own data folders",
        os.path.isdir(home.brain_dir(id_a)) and os.path.isdir(home.brain_dir(id_b)),
    )
    check(
        "c: A and B have their own keychain namespaces",
        os.path.exists(home.vault_index(id_a))
        and os.path.exists(home.vault_index(id_b))
        and bool(ids_a)
        and bool(ids_b)
        and not set(ids_a) & set(ids_b),
    )

    # d
    print("== d: brain A last used again", flush=True)
    home.make_last_used(id_a)
    app = App(home, bus, "run-d.log")
    try:
        path = app.landed()
        check("d: A is still signed in (lands off /login)", not path.startswith("/login"), f"landed on {path}")
        storage_checks(app, "d", ORIGIN_A, ORIGIN_B)
        vault_checks(app, "d", ORIGIN_A, email, expect_ids=ids_a)
        held = app.vault_report(ORIGIN_A, email, ids_b) or {}
        check("d: A's vault holds none of B's logins", held.get("probed") == [], held.get("error") or "")
    finally:
        app.quit()

    # f (before e: e has a home of its own; this one is A's, signed in)
    print("== f: an invite page in A's signed-in window", flush=True)
    app = App(home, bus, "run-f.log", trace=True)
    try:
        path = app.landed()
        check("f: A is still signed in (lands off /login)", not path.startswith("/login"), f"landed on {path}")
        active = app.js("return localStorage.getItem('mantle_active_session')")
        app.cmd("POST", "/url", {"url": "mantle-ui://localhost/invite"})
        path = app.landed(quiet=2.0)
        check("f: the window is on /invite", path.startswith("/invite"), f"on {path}")
        mark = len(app.log_text())
        held = app.js(
            "var v = window.mantleDesktop && window.mantleDesktop.tokenVault;"
            " return !!v && !!arguments[0] && v.getFor(arguments[0]) !== null;",
            active,
        )
        time.sleep(0.5)
        seen = [
            line.split("(origin ", 1)[1].split(")", 1)[0]
            for line in app.log_text()[mark:].splitlines()
            if "[mantle-desktop] vault" in line and "(origin " in line
        ]
        note(f"f: the Origin the shell saw on the vault call from /invite: {', '.join(seen) or '(no trace line)'}")
        check(
            "f: the vault answers on /invite (an invite sign-in is kept)",
            held is True,
            f"origin {', '.join(seen) or '?'}",
        )

        # g, in the same signed-in window, still tracing.
        print("== g: frames inside the UI page, and no Tauri command", flush=True)
        frame_checks(app)
    finally:
        app.quit()

    # e
    print("== e: no keychain", flush=True)
    if not NO_KEYCHAIN_BUS:
        check("e: a dbus session without a Secret Service", False, "MANTLE_E2E_NO_KEYCHAIN_BUS is not set")
    else:
        bare = Home("home-no-keychain")
        id_e = str(uuid.uuid4())
        bare.write_profiles([{"id": id_e, "origin": ORIGIN_A, "name": "Brain A", "lastUsedAt": now}])
        bearer = None
        ids_e = []
        app = App(bare, NO_KEYCHAIN_BUS, "run-e1.log")
        try:
            path = app.landed()
            check("e: the app starts without a keychain, on /login", path.startswith("/login"), f"landed on {path}")
            # Said at start, before any sign-in, and without blocking: the
            # page loaded and settled while the notice was up.
            check("e: the notice is up at start, before any sign-in", len(app.notices) == 1,
                  f"{len(app.notices)} notice(s)")
            check("e: the notice's OK closes it", app.wait_notice_closed(),
                  f"{len(app.closed)} of {len(app.notices)} closed")
            if sign_in(app, email, password, setup_code, "e"):
                time.sleep(2)
                report = app.vault_report(ORIGIN_A, email) or {}
                check("e: the vault answers", not report.get("error"), report.get("error") or "")
                check("e: the active session's bearer is held by the shell for this run",
                      report.get("activeHeld") is True)
                check(
                    "e: the brain accepts that bearer",
                    report.get("whoami") == 200 and report.get("sameEmail") is True,
                    f"whoami {report.get('whoami')}",
                )
                check("e: no bearer is also in localStorage", report.get("leaked") is False)
                store = app.storage() or {}
                check(
                    "e: no bearer key in localStorage",
                    not any(k == "mantle_token" or k.startswith("mantle_token:") for k in store),
                )
                ids_e = report.get("ids") or []
                bearer = app.active_bearer()
        finally:
            app.quit()
        log = app.log_text()
        check(
            "e: the notice was shown once in that run",
            len(app.notices) == 1 and log.count(f"[mantle-desktop] {NOTICE}") == 1,
            f"{len(app.notices)} notice(s), {log.count(NOTICE)} line(s) in the app's output",
        )
        check("e: no vault index was written", not os.path.exists(os.path.dirname(bare.vault_index(id_e))))
        if bearer:
            needle = bearer.encode()
            hits = 0
            for top in (bare.root, os.environ.get("HOME", "")):
                for folder, _dirs, files in os.walk(top):
                    for name in files:
                        try:
                            with open(os.path.join(folder, name), "rb") as f:
                                hits += needle in f.read()
                        except OSError:
                            pass
            check("e: the bearer is in no file the app wrote", hits == 0, f"{hits} file(s)")
            del needle, bearer
        else:
            check("e: the bearer is in no file the app wrote", False, "no bearer to look for")
        app = App(bare, NO_KEYCHAIN_BUS, "run-e2.log")
        try:
            path = app.landed()
            check("e: the next run is back on /login", path.startswith("/login"), f"landed on {path}")
            check("e: the next run says so at start too", len(app.notices) == 1, f"{len(app.notices)} notice(s)")
            held = app.vault_report(ORIGIN_A, email, ids_e) or {}
            check(
                "e: the next run's vault holds nothing of the last run's",
                bool(ids_e) and held.get("probed") == [] and held.get("activeHeld") is False
                and not held.get("error"),
                held.get("error") or f"{len(held.get('probed') or [])} of {len(ids_e)} still held",
            )
        finally:
            app.quit()

    print(flush=True)
    if failures:
        print(f"FAILED: {len(failures)} check(s): {', '.join(failures)}")
        return 1
    print("ALL PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())
