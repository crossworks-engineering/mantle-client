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
  e  no keychain (a dbus session with no Secret Service): the app starts,
     says once that logins are not saved, a sign-in works for that run,
     and the next run is back on /login

Prints a PASS or FAIL line per check and exits non-zero on any failure.
Never prints a password, a setup code or a bearer: the checks on those are
made in the page and come back as booleans.
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
NOTICE = "Logins are not saved"

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

    def __init__(self, home, bus, log_name):
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
            env=home.env(bus),
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
        # The app's one native alert (the keychain notice) is a GTK dialog,
        # which WebDriver cannot see. While it is up the app's main thread
        # waits on it, so a watcher answers it the way a user would: it
        # focuses the dialog and presses Return. Each dialog seen is counted.
        self.notices = set()
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
                for window in found:
                    if window not in self.notices:
                        self.notices.add(window)
                        note(f"the native notice is up ({NOTICE!r}); pressing OK")
                    subprocess.run(["xdotool", "windowfocus", "--sync", window], timeout=5,
                                   capture_output=True)
                    subprocess.run(["xdotool", "key", "--clearmodifiers", "Return"], timeout=5,
                                   capture_output=True)
            except (OSError, subprocess.SubprocessError):
                pass
            time.sleep(0.5)

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

    def vault_report(self, origin, email):
        """What this window's vault holds, checked in the page: which session
        ids, whether the active one has a bearer, whether any bearer is also
        in localStorage, and whether the brain accepts the active one."""
        return self.js_async(
            """
var origin = arguments[0], email = arguments[1], done = arguments[arguments.length - 1];
var v = window.mantleDesktop && window.mantleDesktop.tokenVaultAsync;
if (!v) { done({ error: 'no tokenVaultAsync on this page' }); return; }
v.load().then(function (held) {
  var ids = Object.keys(held);
  var all = [];
  for (var i = 0; i < localStorage.length; i++) {
    var k = localStorage.key(i);
    all.push(k + '\\n' + localStorage.getItem(k));
  }
  var leaked = ids.some(function (id) {
    var t = held[id];
    return !!t && all.some(function (e) { return e.indexOf(t) !== -1; });
  });
  var active = localStorage.getItem('mantle_active_session');
  var token = active ? held[active] : null;
  var out = { ids: ids, activeHeld: !!token, leaked: leaked, whoami: null, sameEmail: null };
  if (!token) { done(out); return; }
  fetch(origin + '/api/auth/whoami', { headers: { authorization: 'Bearer ' + token } })
    .then(function (r) { out.whoami = r.status; return r.ok ? r.json() : null; })
    .then(function (body) { out.sameEmail = !!body && body.email === email; done(out); })
    .catch(function (e) { out.whoami = 'error ' + e; done(out); });
}, function (e) { done({ error: String(e) }); });
""",
            origin,
            email,
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


def sign_in(app, email, password, setup_code, label):
    """Fill the login form (or the first-run signup) and submit it."""
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
        held = app.vault_report(ORIGIN_B, email) or {}
        check("c: B's vault holds no login", held.get("ids") == [], f"{len(held.get('ids') or [])} login(s)")
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
        app = App(bare, NO_KEYCHAIN_BUS, "run-e1.log")
        try:
            path = app.landed()
            check("e: the app starts without a keychain, on /login", path.startswith("/login"), f"landed on {path}")
            if sign_in(app, email, password, setup_code, "e"):
                time.sleep(2)
                report = app.vault_report(ORIGIN_A, email) or {}
                check(
                    "e: the login works for this run (held in memory)",
                    report.get("activeHeld") is True and report.get("whoami") == 200,
                    f"whoami {report.get('whoami')}",
                )
                check("e: no bearer in localStorage", report.get("leaked") is False)
        finally:
            app.quit()
        log = app.log_text()
        check(
            "e: the one-time notice was shown, once",
            len(app.notices) == 1 and log.count(f"[mantle-desktop] {NOTICE}") == 1,
            f"{len(app.notices)} dialog(s), {log.count(NOTICE)} line(s) in the app's output",
        )
        check("e: no vault index was written", not os.path.exists(bare.vault_index(id_e)))
        app = App(bare, NO_KEYCHAIN_BUS, "run-e2.log")
        try:
            path = app.landed()
            check("e: the next run is back on /login", path.startswith("/login"), f"landed on {path}")
        finally:
            app.quit()
        # Not a check: the notice comes the first time the keychain fails in
        # a run, and a run that only loads may or may not touch it.
        note(f"e: the next run showed the notice {len(app.notices)} time(s)")

    print(flush=True)
    if failures:
        print(f"FAILED: {len(failures)} check(s): {', '.join(failures)}")
        return 1
    print("ALL PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())
