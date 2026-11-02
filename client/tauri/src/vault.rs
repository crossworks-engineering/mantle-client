//! The token vault: the bearers a brain window holds, in the OS keychain
//! (macOS Keychain, the Secret Service on Linux), through keyring-core.
//! The same shape and rules as Electron's vault (client/desktop/src/main/
//! vault.ts), with the keychain where Electron has its files:
//!
//!   keychain entry   service = the app identifier
//!                    user    = `<profile>`             the one unscoped slot
//!                    user    = `<profile>/<session>`   one bearer per login
//!   index file       <app data>/vault/<profile>.json: the session ids held,
//!                    and when each was written. Not secret: it is what
//!                    `keep_only` and `remove_profile` walk, and what stands
//!                    in for Electron's file times (the two-minute grace).
//!
//! The store is the ONLY copy of a bearer. Nothing else is kept: every read
//! asks the store, so what the page gets is what is stored. A write the
//! keychain refuses is simply not stored (as in Electron), and the next read
//! tells the truth. The first time the keychain fails in a run, the shell is
//! told once, AFTER the vault's lock is released: the callback may show UI,
//! and nothing that shows UI runs under the lock.
//!
//! With no keychain (none on this platform, or one that will not answer when
//! the vault is made), the store is this process's memory for the whole run
//! (`MemoryStore`), and so is the index: a sign-in works, and lasts until the
//! app quits. Nothing of it is written to disk. Every rule above holds the
//! same, because the memory store answers as the keychain does, and is the
//! only copy in the same way. This is decided once, in `Vault::new`.
//!
//! The profile id is the shell's own (from the window that asks, never from
//! the page). The SESSION id comes from the page, so it is checked against
//! Electron's alphabet before it is used.
//!
//! One lock per process serializes every call: index reads and writes, and
//! the store calls between them. Callers run off the main thread. A caller
//! that must check something under the same lock (is the brain still
//! listed?) uses `Vault::when`.
//!
//! The index is written BEFORE a login's entry, and when it cannot be
//! written the entry is not either: every entry of a brain is one its index
//! names, so `keep_only` and `remove_profile` find it. `remove_profile` also
//! sweeps the keychain for the brain's prefix, in case one was missed.

use std::collections::{BTreeMap, HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use keyring_core::api::{CredentialApi, CredentialPersistence, CredentialStoreApi};
use keyring_core::{Credential, CredentialStore, Entry, Error as KeyError};
use serde::{Deserialize, Serialize};

/// What the page may name a session (Electron's vault.ts): no dot, no
/// slash, nothing a path could be built from.
pub fn is_session_id(value: &str) -> bool {
    (1..=80).contains(&value.len())
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}

/// A login written in the last two minutes may belong to a window mid-sign-in.
pub const RECENT_MS: u64 = 120_000;

/// Far bigger than a real bearer, small enough that a page cannot fill the
/// keychain with one call.
pub const MAX_TOKEN_BYTES: usize = 16 * 1024;

#[derive(Debug, Default, Clone, Serialize, Deserialize)]
struct Index {
    v: u32,
    /// session id -> when its entry was last written (ms since the epoch).
    sessions: BTreeMap<String, u64>,
}

/// What went wrong during one call, reported once the lock is released:
/// the keychain's failures (traced, and the user is told once per run), and
/// the index file's (traced only: the notice is about the keychain, and a
/// disk that will not take a small file is not something it can explain).
#[derive(Default)]
struct Failures {
    keychain: Vec<String>,
    disk: Vec<String>,
}

impl Failures {
    fn note(&mut self, what: &str, error: &KeyError) {
        // The error's text names the store's own failure, never a secret.
        self.keychain.push(format!("{what}: {error}"));
    }

    fn note_index(&mut self, error: &std::io::Error) {
        self.disk
            .push(format!("index: {error}; the login was not stored"));
    }
}

/// Why the user is told that logins are not kept as they should be. Once
/// per run, whichever comes first.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Unavailable {
    /// No keychain at start: logins are kept in memory, for this run only.
    NoKeychain,
    /// The keychain refused a call during the run: that login was not kept.
    KeychainFailed,
}

/// The user an entry is never stored under: what `Vault::new` reads to see
/// whether the keychain answers. Not a profile id (those are UUIDs).
const PROBE_USER: &str = "probe";

pub struct Vault {
    service: String,
    dir: PathBuf,
    /// The keychain, or this run's memory when there is no keychain.
    store: Arc<CredentialStore>,
    /// The index for a run without a keychain: in memory, like the bearers,
    /// so nothing of such a run is on disk. None: the index files.
    memory_index: Option<Mutex<HashMap<String, Index>>>,
    lock: Mutex<()>,
    /// Set once the user has been told.
    told: AtomicBool,
    /// Called once per run: at start when there is no keychain, or the first
    /// time the keychain fails. Never called with the lock held.
    on_unavailable: Box<dyn Fn(Unavailable) + Send + Sync>,
    /// A line per failure on stderr, never a token (MANTLE_DESKTOP_TRACE).
    trace: bool,
}

impl Vault {
    /// `store` is the platform's keychain, or None when there is none. A
    /// keychain that does not answer a read now is treated as none: the run
    /// keeps its logins in memory instead (the module comment).
    pub fn new(
        service: &str,
        data_dir: &Path,
        store: Option<Arc<CredentialStore>>,
        on_unavailable: Box<dyn Fn(Unavailable) + Send + Sync>,
        trace: bool,
    ) -> Self {
        let keychain = store.filter(|store| match Self::probe(store, service) {
            Ok(()) => true,
            Err(error) => {
                if trace {
                    eprintln!("[mantle-desktop] vault: the keychain does not answer ({error})");
                }
                false
            }
        });
        let (store, memory_index) = match keychain {
            Some(store) => (store, None),
            None => {
                if trace {
                    eprintln!("[mantle-desktop] vault: no keychain; logins last for this run only");
                }
                let memory: Arc<CredentialStore> = Arc::new(MemoryStore::default());
                (memory, Some(Mutex::new(HashMap::new())))
            }
        };
        Self {
            service: service.to_string(),
            dir: data_dir.join("vault"),
            store,
            memory_index,
            lock: Mutex::new(()),
            told: AtomicBool::new(false),
            on_unavailable,
            trace,
        }
    }

    /// One read of an entry that is never written: the keychain answers
    /// when it says what is there, even that nothing is.
    fn probe(store: &Arc<CredentialStore>, service: &str) -> Result<(), KeyError> {
        match store
            .build(service, PROBE_USER, None)
            .and_then(|e| e.get_password())
        {
            Ok(_) | Err(KeyError::NoEntry) => Ok(()),
            Err(error) => Err(error),
        }
    }

    /// The platform's keychain store, or None when there is none to be had.
    pub fn platform_store() -> Option<Arc<CredentialStore>> {
        #[cfg(target_os = "macos")]
        {
            apple_native_keyring_store::keychain::Store::new()
                .ok()
                .map(|s| s as Arc<CredentialStore>)
        }
        #[cfg(target_os = "linux")]
        {
            zbus_secret_service_keyring_store::Store::new()
                .ok()
                .map(|s| s as Arc<CredentialStore>)
        }
        #[cfg(not(any(target_os = "macos", target_os = "linux")))]
        {
            None
        }
    }

    /// Whether this run keeps its logins in memory (there is no keychain).
    /// The shell then says so at start.
    pub fn this_run_only(&self) -> bool {
        self.memory_index.is_some()
    }

    /// Tell the user, once per run, that logins are not kept as they should
    /// be. Never call it with the lock held.
    pub fn tell_unavailable(&self) {
        if !self.told.swap(true, Ordering::SeqCst) {
            (self.on_unavailable)(if self.this_run_only() {
                Unavailable::NoKeychain
            } else {
                Unavailable::KeychainFailed
            });
        }
    }

    /// Runs one call under the lock, then (lock released) reports what failed.
    fn with_lock<T>(&self, call: impl FnOnce(&mut Failures) -> T) -> T {
        let mut failures = Failures::default();
        let out = {
            let _guard = self.lock.lock().unwrap_or_else(|e| e.into_inner());
            call(&mut failures)
        };
        if self.trace {
            for line in failures.keychain.iter().chain(&failures.disk) {
                eprintln!("[mantle-desktop] vault: {line}");
            }
        }
        if !failures.keychain.is_empty() {
            self.tell_unavailable();
        }
        out
    }

    fn slot(profile: &str) -> String {
        profile.to_string()
    }

    fn login(profile: &str, session: &str) -> String {
        format!("{profile}/{session}")
    }

    /// The bearer under `user`: Some, None when there is none, or None with
    /// a failure noted when the keychain would not answer.
    fn read(&self, user: &str, failures: &mut Failures) -> Result<Option<String>, ()> {
        match self
            .store
            .build(&self.service, user, None)
            .and_then(|e| e.get_password())
        {
            Ok(token) if !token.is_empty() => Ok(Some(token)),
            Ok(_) | Err(KeyError::NoEntry) => Ok(None),
            Err(e) => {
                failures.note("read", &e);
                Err(())
            }
        }
    }

    fn write(&self, user: &str, token: &str, failures: &mut Failures) -> bool {
        match self
            .store
            .build(&self.service, user, None)
            .and_then(|e| e.set_password(token))
        {
            Ok(()) => true,
            Err(e) => {
                failures.note("write", &e);
                false
            }
        }
    }

    /// Whether the entry is gone afterwards (deleted, or never there).
    fn delete(&self, user: &str, failures: &mut Failures) -> bool {
        match self
            .store
            .build(&self.service, user, None)
            .and_then(|e| e.delete_credential())
        {
            Ok(()) | Err(KeyError::NoEntry) => true,
            Err(e) => {
                failures.note("delete", &e);
                false
            }
        }
    }

    fn index_path(&self, profile: &str) -> PathBuf {
        self.dir.join(format!("{profile}.json"))
    }

    fn read_index(&self, profile: &str) -> Index {
        if let Some(memory) = &self.memory_index {
            let map = memory.lock().unwrap_or_else(|e| e.into_inner());
            return map.get(profile).cloned().unwrap_or_default();
        }
        std::fs::read_to_string(self.index_path(profile))
            .ok()
            .and_then(|t| serde_json::from_str::<Index>(&t).ok())
            .map(|mut index| {
                index.sessions.retain(|id, _| is_session_id(id));
                index
            })
            .unwrap_or_default()
    }

    /// Writes a brain's index: whole, to a temporary file renamed over the
    /// old one; an empty index removes the file. In a run with no keychain
    /// the index is in memory and this cannot fail. An error means the index
    /// on disk is what it was before the call.
    fn write_index(&self, profile: &str, index: &Index) -> std::io::Result<()> {
        if let Some(memory) = &self.memory_index {
            let mut map = memory.lock().unwrap_or_else(|e| e.into_inner());
            if index.sessions.is_empty() {
                map.remove(profile);
            } else {
                map.insert(profile.to_string(), index.clone());
            }
            return Ok(());
        }
        if index.sessions.is_empty() {
            return match std::fs::remove_file(self.index_path(profile)) {
                Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e),
                _ => Ok(()),
            };
        }
        std::fs::create_dir_all(&self.dir)?;
        let body = serde_json::to_string(&Index {
            v: 1,
            sessions: index.sessions.clone(),
        })?;
        let tmp = self.dir.join(format!("{profile}.json.tmp"));
        std::fs::write(&tmp, body)?;
        std::fs::rename(&tmp, self.index_path(profile))
    }

    /// Lists a login in its brain's index. An error: it is not listed.
    fn index_add(&self, profile: &str, session: &str, now: u64) -> std::io::Result<()> {
        let mut index = self.read_index(profile);
        index.sessions.insert(session.to_string(), now);
        self.write_index(profile, &index)
    }

    /// Takes a login off its brain's index. Best effort: a login the index
    /// still names after its entry is gone is harmless (it is dropped when
    /// found missing), so a failure here is not one to act on.
    fn index_remove(&self, profile: &str, session: &str) {
        let mut index = self.read_index(profile);
        if index.sessions.remove(session).is_some() {
            let _ = self.write_index(profile, &index);
        }
    }

    fn token_ok(token: &str) -> bool {
        !token.is_empty() && token.len() <= MAX_TOKEN_BYTES
    }

    /// Runs one call with the lock held (the ops are `Held`'s).
    fn held<T>(&self, call: impl FnOnce(&mut Held<'_>) -> T) -> T {
        self.with_lock(|failures| {
            call(&mut Held {
                vault: self,
                failures,
            })
        })
    }

    /// Runs one call with the lock held, only when `allowed` says so, asked
    /// under that same lock. vault_endpoint.rs asks here whether the brain
    /// is still listed: a brain removed meanwhile (commands.rs removes it
    /// from the list, then calls `remove_profile`, which waits for this lock)
    /// is either refused here or swept by `remove_profile` afterwards, never
    /// written to after its removal. None: not allowed, nothing done.
    pub fn when<T>(
        &self,
        allowed: impl FnOnce() -> bool,
        call: impl FnOnce(&mut Held<'_>) -> T,
    ) -> Option<T> {
        self.held(|held| allowed().then(|| call(held)))
    }

    // The ops, each under the lock (Held has their rules).

    pub fn get(&self, profile: &str) -> Option<String> {
        self.held(|h| h.get(profile))
    }

    pub fn set(&self, profile: &str, token: &str) {
        self.held(|h| h.set(profile, token))
    }

    pub fn clear(&self, profile: &str) {
        self.held(|h| h.clear(profile))
    }

    pub fn get_for(&self, profile: &str, session: &str) -> Option<String> {
        self.held(|h| h.get_for(profile, session))
    }

    pub fn set_for(&self, profile: &str, session: &str, token: &str, now: u64) {
        self.held(|h| h.set_for(profile, session, token, now))
    }

    pub fn clear_for(&self, profile: &str, session: &str) {
        self.held(|h| h.clear_for(profile, session))
    }

    pub fn adopt(&self, profile: &str, session: &str, now: u64) -> Option<String> {
        self.held(|h| h.adopt(profile, session, now))
    }

    pub fn keep_only(
        &self,
        profile: &str,
        session_ids: &[String],
        stray_bearers: &[String],
        now: u64,
    ) {
        self.held(|h| h.keep_only(profile, session_ids, stray_bearers, now))
    }

    /// A brain was removed from the app: none of its logins stay behind.
    /// The entries its index names, the unscoped slot, and then whatever
    /// else the keychain holds under this brain's prefix (`<profile>/`), in
    /// case the index missed one: keyring-core's search, which the macOS
    /// keychain, the Secret Service, the mock and the memory store all
    /// answer. A store that cannot search is left to the index.
    ///
    /// Answers whether nothing of the brain is left: false when the keychain
    /// refused a delete or a search, or its index could not be written. The
    /// caller then lists the brain in pending-removals.json, and the next
    /// start calls this again (windows.rs, retry_removals) until it answers
    /// true. Safe to call again: what is already gone is not an error.
    pub fn remove_profile(&self, profile: &str) -> bool {
        self.with_lock(|f| {
            let mut all_gone = self.delete(&Self::slot(profile), f);
            let mut index = self.read_index(profile);
            let held: Vec<String> = index.sessions.keys().cloned().collect();
            for session in held {
                if self.delete(&Self::login(profile, &session), f) {
                    index.sessions.remove(&session);
                } else {
                    all_gone = false;
                }
            }
            all_gone &= self.sweep(profile, f);
            // What could not be deleted stays in the index, so the retry
            // finds it again by name as well as by the sweep.
            all_gone &= self.write_index(profile, &index).is_ok();
            all_gone
        })
    }

    /// Deletes every entry of this service whose user is `<profile>/...`.
    /// Whether nothing under that prefix is left, as far as the store can
    /// tell: a store that cannot search answers true (the index is all
    /// there is), one whose search or delete fails answers false.
    fn sweep(&self, profile: &str, failures: &mut Failures) -> bool {
        let prefix = format!("{profile}/");
        let spec = HashMap::from([("service", self.service.as_str())]);
        let found = match self.store.search(&spec) {
            Ok(found) => found,
            Err(KeyError::NotSupportedByStore(_)) => return true,
            Err(e) => {
                // Not a login that failed to be kept: the trace only.
                if self.trace {
                    eprintln!("[mantle-desktop] vault: search: {e}");
                }
                return false;
            }
        };
        let mut all_gone = true;
        for entry in found {
            let Some((service, user)) = entry.get_specifiers() else {
                continue;
            };
            if service != self.service || !user.starts_with(&prefix) {
                continue;
            }
            if let Err(e) = entry.delete_credential() {
                if !matches!(e, KeyError::NoEntry) {
                    failures.note("delete", &e);
                    all_gone = false;
                }
            }
        }
        all_gone
    }
}

/// The vault with its lock held: every op, with its rules. Made only by
/// `Vault::held` and `Vault::when`, so whatever runs here runs under the
/// lock, one call at a time.
pub struct Held<'a> {
    vault: &'a Vault,
    failures: &'a mut Failures,
}

impl Held<'_> {
    fn read(&mut self, user: &str) -> Result<Option<String>, ()> {
        self.vault.read(user, self.failures)
    }

    fn write(&mut self, user: &str, token: &str) -> bool {
        self.vault.write(user, token, self.failures)
    }

    fn delete(&mut self, user: &str) -> bool {
        self.vault.delete(user, self.failures)
    }

    // ── the unscoped slot: what an earlier build kept, one per brain ───────

    pub fn get(&mut self, profile: &str) -> Option<String> {
        self.read(&Vault::slot(profile)).ok().flatten()
    }

    pub fn set(&mut self, profile: &str, token: &str) {
        if Vault::token_ok(token) {
            self.write(&Vault::slot(profile), token);
        }
    }

    pub fn clear(&mut self, profile: &str) {
        self.delete(&Vault::slot(profile));
    }

    // ── one bearer per login ────────────────────────────────────────────────

    pub fn get_for(&mut self, profile: &str, session: &str) -> Option<String> {
        if !is_session_id(session) {
            return None;
        }
        self.read(&Vault::login(profile, session)).ok().flatten()
    }

    /// The index first: an entry the index names but the keychain lacks is
    /// harmless (it is dropped when found missing), while an entry the index
    /// does not name could outlive its brain. So when the index cannot be
    /// written the keychain is not either: the login is simply not stored,
    /// as a write the keychain refuses is not (Electron's rule), and the
    /// next read tells the truth.
    pub fn set_for(&mut self, profile: &str, session: &str, token: &str, now: u64) {
        if !is_session_id(session) || !Vault::token_ok(token) {
            return;
        }
        if let Err(e) = self.vault.index_add(profile, session, now) {
            self.failures.note_index(&e);
            return;
        }
        self.write(&Vault::login(profile, session), token);
    }

    pub fn clear_for(&mut self, profile: &str, session: &str) {
        if !is_session_id(session) {
            return;
        }
        if self.delete(&Vault::login(profile, session)) {
            self.vault.index_remove(profile, session);
        }
    }

    /// Give the unscoped bearer to a login that has none, and answer with
    /// it: a move, as Electron's rename is. A login that already has a
    /// bearer of its own keeps it and the slot is left alone. When the slot
    /// cannot be emptied the copy is taken back, so the bearer is never left
    /// in both places by this call. Index first, as set_for.
    pub fn adopt(&mut self, profile: &str, session: &str, now: u64) -> Option<String> {
        if !is_session_id(session) {
            return None;
        }
        let target = Vault::login(profile, session);
        let slot = Vault::slot(profile);
        match self.read(&target) {
            Ok(Some(own)) => return Some(own),
            Ok(None) => {}
            Err(()) => return None,
        }
        let token = self.read(&slot).ok().flatten()?;
        if let Err(e) = self.vault.index_add(profile, session, now) {
            self.failures.note_index(&e);
            return None;
        }
        if !self.write(&target, &token) {
            self.vault.index_remove(profile, session);
            return None;
        }
        if !self.delete(&slot) {
            if self.delete(&target) {
                self.vault.index_remove(profile, session);
            }
            return None;
        }
        Some(token)
    }

    /// Drop this brain's leftover logins: those under an id the page's list
    /// does not name AND holding one of `stray_bearers`, the bearers the page
    /// still holds under the ids it keeps (so each one dropped is a copy). A
    /// login written in the last two minutes is left alone: another window
    /// of this brain may be listing it right now. Ids that are not session
    /// ids are ignored, and the unscoped slot is not a login. Electron's rule.
    pub fn keep_only(
        &mut self,
        profile: &str,
        session_ids: &[String],
        stray_bearers: &[String],
        now: u64,
    ) {
        let keep: HashSet<&str> = session_ids
            .iter()
            .map(String::as_str)
            .filter(|id| is_session_id(id))
            .collect();
        let stray: HashSet<&str> = stray_bearers
            .iter()
            .map(String::as_str)
            .filter(|b| !b.is_empty())
            .collect();
        if stray.is_empty() {
            return;
        }
        let mut index = self.vault.read_index(profile);
        let candidates: Vec<String> = index
            .sessions
            .iter()
            .filter(|(s, at)| !keep.contains(s.as_str()) && now.saturating_sub(**at) >= RECENT_MS)
            .map(|(s, _)| s.clone())
            .collect();
        let mut changed = false;
        for session in candidates {
            let user = Vault::login(profile, &session);
            let gone = match self.read(&user) {
                Ok(Some(token)) if stray.contains(token.as_str()) => self.delete(&user),
                Ok(None) => true,
                _ => false,
            };
            if gone {
                index.sessions.remove(&session);
                changed = true;
            }
        }
        if changed {
            // Best effort, as index_remove.
            let _ = self.vault.write_index(profile, &index);
        }
    }
}

/// The store of a run with no keychain: each bearer in this process's
/// memory under the same (service, user) the keychain would use, gone when
/// the app quits. It answers as the keychain does (NoEntry when there is
/// nothing), and like the keychain it is the only copy: the vault keeps no
/// other. It never fails, so the user is told once, at start, and not again.
#[derive(Default)]
struct MemoryStore {
    entries: MemoryEntries,
}

/// (service, user) -> the secret.
type MemoryEntries = Arc<Mutex<HashMap<(String, String), Vec<u8>>>>;

/// One entry of the memory store. Holds a key, never a secret of its own.
struct MemoryEntry {
    entries: MemoryEntries,
    key: (String, String),
}

impl MemoryEntry {
    fn entries(&self) -> std::sync::MutexGuard<'_, HashMap<(String, String), Vec<u8>>> {
        self.entries.lock().unwrap_or_else(|e| e.into_inner())
    }
}

impl CredentialApi for MemoryEntry {
    fn set_secret(&self, secret: &[u8]) -> keyring_core::Result<()> {
        self.entries().insert(self.key.clone(), secret.to_vec());
        Ok(())
    }

    fn get_secret(&self) -> keyring_core::Result<Vec<u8>> {
        self.entries()
            .get(&self.key)
            .cloned()
            .ok_or(KeyError::NoEntry)
    }

    fn delete_credential(&self) -> keyring_core::Result<()> {
        self.entries()
            .remove(&self.key)
            .map(|_| ())
            .ok_or(KeyError::NoEntry)
    }

    fn get_credential(&self) -> keyring_core::Result<Option<Arc<Credential>>> {
        if self.entries().contains_key(&self.key) {
            Ok(None)
        } else {
            Err(KeyError::NoEntry)
        }
    }

    fn get_specifiers(&self) -> Option<(String, String)> {
        Some(self.key.clone())
    }

    fn as_any(&self) -> &dyn std::any::Any {
        self
    }
}

impl CredentialStoreApi for MemoryStore {
    fn vendor(&self) -> String {
        "mantle-desktop".into()
    }

    fn id(&self) -> String {
        "this-run".into()
    }

    fn build(
        &self,
        service: &str,
        user: &str,
        _: Option<&HashMap<&str, &str>>,
    ) -> keyring_core::Result<Entry> {
        Ok(Entry::new_with_credential(Arc::new(MemoryEntry {
            entries: self.entries.clone(),
            key: (service.to_string(), user.to_string()),
        })))
    }

    /// Every entry of the service named in `spec` (all of them without one),
    /// as the keychain's own search answers: what `remove_profile` sweeps.
    fn search(&self, spec: &HashMap<&str, &str>) -> keyring_core::Result<Vec<Entry>> {
        let service = spec.get("service").copied();
        let keys: Vec<(String, String)> = self
            .entries
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .keys()
            .filter(|(s, _)| service.is_none_or(|want| s == want))
            .cloned()
            .collect();
        Ok(keys
            .into_iter()
            .map(|key| {
                Entry::new_with_credential(Arc::new(MemoryEntry {
                    entries: self.entries.clone(),
                    key,
                }))
            })
            .collect())
    }

    fn as_any(&self) -> &dyn std::any::Any {
        self
    }

    fn persistence(&self) -> CredentialPersistence {
        CredentialPersistence::ProcessOnly
    }
}

#[cfg(test)]
mod tests {
    //! Electron's vault.test.ts, case for case where the keychain allows,
    //! on keyring-core's mock store; plus what the keychain adds: a write it
    //! refuses is not stored, the user is told once, and never under the lock;
    //! and a run with no keychain, which keeps its logins in memory.

    use super::*;
    use keyring_core::api::{CredentialApi, CredentialStoreApi};
    use keyring_core::{Credential, Entry};

    const A: &str = "11111111-1111-4111-8111-111111111111";
    const B: &str = "22222222-2222-4222-8222-222222222222";
    const SERVICE: &str = "engineering.crossworks.mantleos-desktop";
    const LATER: u64 = 10 * 60_000;

    /// What the mock store is told to refuse, for as long as it is set.
    #[derive(Default)]
    struct Refuse {
        all: AtomicBool,
        writes: AtomicBool,
        deletes_of: Mutex<Option<String>>,
    }

    /// keyring-core's mock store, with failures that last until cleared
    /// (the mock's own `set_error` is one-shot).
    struct Flaky {
        inner: Arc<keyring_core::mock::Store>,
        refuse: Arc<Refuse>,
    }

    struct FlakyCred {
        inner: Entry,
        user: String,
        refuse: Arc<Refuse>,
    }

    fn locked() -> KeyError {
        KeyError::PlatformFailure("locked".into())
    }

    impl CredentialApi for FlakyCred {
        fn set_secret(&self, secret: &[u8]) -> keyring_core::Result<()> {
            if self.refuse.all.load(Ordering::SeqCst) || self.refuse.writes.load(Ordering::SeqCst) {
                return Err(locked());
            }
            self.inner.set_secret(secret)
        }
        fn get_secret(&self) -> keyring_core::Result<Vec<u8>> {
            if self.refuse.all.load(Ordering::SeqCst) {
                return Err(locked());
            }
            self.inner.get_secret()
        }
        fn delete_credential(&self) -> keyring_core::Result<()> {
            let refused = self.refuse.all.load(Ordering::SeqCst)
                || self.refuse.deletes_of.lock().unwrap().as_deref() == Some(self.user.as_str());
            if refused {
                return Err(locked());
            }
            self.inner.delete_credential()
        }
        fn get_credential(&self) -> keyring_core::Result<Option<Arc<Credential>>> {
            Ok(None)
        }
        fn get_specifiers(&self) -> Option<(String, String)> {
            self.inner.get_specifiers()
        }
        fn as_any(&self) -> &dyn std::any::Any {
            self
        }
    }

    impl CredentialStoreApi for Flaky {
        fn vendor(&self) -> String {
            "flaky".into()
        }
        fn id(&self) -> String {
            "flaky".into()
        }
        fn build(
            &self,
            service: &str,
            user: &str,
            _: Option<&std::collections::HashMap<&str, &str>>,
        ) -> keyring_core::Result<Entry> {
            let inner = self.inner.build(service, user, None)?;
            Ok(Entry::new_with_credential(Arc::new(FlakyCred {
                inner,
                user: user.to_string(),
                refuse: self.refuse.clone(),
            })))
        }
        fn search(
            &self,
            spec: &std::collections::HashMap<&str, &str>,
        ) -> keyring_core::Result<Vec<Entry>> {
            if self.refuse.all.load(Ordering::SeqCst) {
                return Err(locked());
            }
            Ok(self
                .inner
                .search(spec)?
                .into_iter()
                .map(|inner| {
                    let user = inner.get_specifiers().map(|(_, u)| u).unwrap_or_default();
                    Entry::new_with_credential(Arc::new(FlakyCred {
                        inner,
                        user,
                        refuse: self.refuse.clone(),
                    }))
                })
                .collect())
        }
        fn as_any(&self) -> &dyn std::any::Any {
            self
        }
    }

    struct Fixture {
        dir: PathBuf,
        store: Arc<keyring_core::mock::Store>,
        refuse: Arc<Refuse>,
        told: Arc<Mutex<Vec<Unavailable>>>,
    }

    impl Fixture {
        fn new() -> Self {
            let dir =
                std::env::temp_dir().join(format!("mantle-tauri-vault-{}", uuid::Uuid::new_v4()));
            std::fs::create_dir_all(&dir).unwrap();
            Self {
                dir,
                store: keyring_core::mock::Store::new().unwrap(),
                refuse: Arc::new(Refuse::default()),
                told: Arc::new(Mutex::new(Vec::new())),
            }
        }

        fn vault(&self) -> Vault {
            let store = Arc::new(Flaky {
                inner: self.store.clone(),
                refuse: self.refuse.clone(),
            });
            self.vault_with(Some(store as Arc<CredentialStore>))
        }

        fn vault_with(&self, store: Option<Arc<CredentialStore>>) -> Vault {
            let told = self.told.clone();
            Vault::new(
                SERVICE,
                &self.dir,
                store,
                Box::new(move |why| {
                    told.lock().unwrap().push(why);
                }),
                false,
            )
        }

        fn keychain(&self, user: &str) -> Option<String> {
            self.store
                .build(SERVICE, user, None)
                .unwrap()
                .get_password()
                .ok()
        }

        fn told(&self) -> usize {
            self.told.lock().unwrap().len()
        }

        fn told_why(&self) -> Vec<Unavailable> {
            self.told.lock().unwrap().clone()
        }

        /// Every entry the mock keychain holds for this service, by user.
        fn keychain_has_any(&self, users: &[&str]) -> bool {
            users.iter().any(|u| self.keychain(u).is_some())
        }

        /// Every byte the vault wrote to disk, to show no token is in it.
        fn disk(&self) -> String {
            let mut all = String::new();
            if let Ok(entries) = std::fs::read_dir(self.dir.join("vault")) {
                for e in entries.flatten() {
                    all.push_str(&std::fs::read_to_string(e.path()).unwrap_or_default());
                }
            }
            all
        }

        fn indexed(&self, profile: &str) -> Vec<String> {
            std::fs::read_to_string(self.dir.join("vault").join(format!("{profile}.json")))
                .ok()
                .and_then(|t| serde_json::from_str::<Index>(&t).ok())
                .map(|i| i.sessions.into_keys().collect())
                .unwrap_or_default()
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.dir);
        }
    }

    fn now() -> u64 {
        crate::profiles::now_ms()
    }

    // ── one bearer per login ────────────────────────────────────────────────

    #[test]
    fn round_trips_through_the_keychain_and_never_puts_a_token_on_disk() {
        let f = Fixture::new();
        let vault = f.vault();
        vault.set_for(A, "session-1", "bearer.one", now());
        assert_eq!(
            f.keychain(&format!("{A}/session-1")).as_deref(),
            Some("bearer.one")
        );
        assert_eq!(vault.get_for(A, "session-1").as_deref(), Some("bearer.one"));
        // A fresh vault (the next run) reads the same keychain.
        assert_eq!(
            f.vault().get_for(A, "session-1").as_deref(),
            Some("bearer.one")
        );
        assert!(f.disk().contains("session-1"));
        assert!(!f.disk().contains("bearer.one"));
    }

    #[test]
    fn keeps_the_logins_of_one_brain_apart_and_the_brains_apart() {
        let f = Fixture::new();
        let vault = f.vault();
        vault.set_for(A, "s1", "a.one", now());
        vault.set_for(A, "s2", "a.two", now());
        vault.set_for(B, "s1", "b.one", now());
        assert_eq!(vault.get_for(A, "s1").as_deref(), Some("a.one"));
        assert_eq!(vault.get_for(A, "s2").as_deref(), Some("a.two"));
        assert_eq!(vault.get_for(B, "s1").as_deref(), Some("b.one"));

        vault.clear_for(A, "s1");
        assert_eq!(vault.get_for(A, "s1"), None);
        assert_eq!(vault.get_for(A, "s2").as_deref(), Some("a.two"));
        assert_eq!(vault.get_for(B, "s1").as_deref(), Some("b.one"));
        assert_eq!(f.indexed(A), vec!["s2".to_string()]);
    }

    #[test]
    fn a_session_id_is_the_pages_so_it_is_not_trusted() {
        let f = Fixture::new();
        let vault = f.vault();
        vault.set_for(B, "s1", "b.one", now());
        let long = "x".repeat(81);
        let hostile = [
            "../other-brain/s1",
            "..",
            ".",
            "a/b",
            "a\\b",
            "with.dot",
            "",
            long.as_str(),
            "nul\0byte",
            "é",
        ];
        assert!(is_session_id("3f0e8a52-6f0b-4b5e-9d5e-2f0f6f1f7a10"));
        assert!(is_session_id("sl9x2k4abcd"));
        assert!(is_session_id(&"x".repeat(80)));
        for id in hostile {
            assert!(!is_session_id(id), "{id:?}");
            vault.set_for(A, id, "x", now());
            assert_eq!(vault.get_for(A, id), None, "{id:?}");
            assert_eq!(vault.adopt(A, id, now()), None, "{id:?}");
            vault.clear_for(A, id);
        }
        // The neighbour a traversal was aiming at is untouched, and nothing
        // at all was created for this brain.
        assert_eq!(vault.get_for(B, "s1").as_deref(), Some("b.one"));
        assert!(f.indexed(A).is_empty());
        assert_eq!(f.keychain(&format!("{A}/..")), None);
    }

    #[test]
    fn refuses_an_empty_or_oversized_bearer() {
        let f = Fixture::new();
        let vault = f.vault();
        vault.set_for(A, "s1", "", now());
        vault.set_for(A, "s1", &"t".repeat(MAX_TOKEN_BYTES + 1), now());
        vault.set(A, "");
        assert_eq!(vault.get_for(A, "s1"), None);
        assert_eq!(vault.get(A), None);
        assert!(f.indexed(A).is_empty());
    }

    // ── the update from one slot per brain ──────────────────────────────────

    #[test]
    fn adopts_the_unscoped_bearer_into_a_login_and_the_slot_is_emptied() {
        let f = Fixture::new();
        let vault = f.vault();
        vault.set(A, "legacy.bearer");
        assert_eq!(f.keychain(A).as_deref(), Some("legacy.bearer"));

        assert_eq!(
            vault.adopt(A, "s1", now()).as_deref(),
            Some("legacy.bearer")
        );
        assert_eq!(vault.get_for(A, "s1").as_deref(), Some("legacy.bearer"));
        assert_eq!(vault.get(A), None);
        assert_eq!(f.keychain(A), None);
        assert_eq!(f.indexed(A), vec!["s1".to_string()]);
    }

    #[test]
    fn never_overwrites_a_login_that_already_has_a_bearer_of_its_own() {
        let f = Fixture::new();
        let vault = f.vault();
        vault.set_for(A, "s1", "own.bearer", now());
        vault.set(A, "legacy.bearer");
        assert_eq!(vault.adopt(A, "s1", now()).as_deref(), Some("own.bearer"));
        assert_eq!(vault.get(A).as_deref(), Some("legacy.bearer"));
    }

    #[test]
    fn adopts_once_a_second_login_finds_nothing() {
        let f = Fixture::new();
        let vault = f.vault();
        vault.set(A, "legacy.bearer");
        vault.adopt(A, "s1", now());
        assert_eq!(vault.adopt(A, "s2", now()), None);
        assert_eq!(f.indexed(A), vec!["s1".to_string()]);
    }

    #[test]
    fn with_nothing_to_adopt_answers_none_and_creates_nothing() {
        let f = Fixture::new();
        let vault = f.vault();
        assert_eq!(vault.adopt(A, "s1", now()), None);
        assert!(!f.dir.join("vault").exists());
        assert_eq!(f.keychain(&format!("{A}/s1")), None);
    }

    #[test]
    fn an_adopt_that_cannot_empty_the_slot_takes_its_copy_back() {
        let f = Fixture::new();
        let vault = f.vault();
        vault.set(A, "legacy.bearer");
        *f.refuse.deletes_of.lock().unwrap() = Some(A.to_string());
        assert_eq!(vault.adopt(A, "s1", now()), None);
        // One place only: still the slot, not the login.
        assert_eq!(f.keychain(A).as_deref(), Some("legacy.bearer"));
        assert_eq!(f.keychain(&format!("{A}/s1")), None);
        assert!(f.indexed(A).is_empty());
        assert_eq!(f.told(), 1);
        // Once the keychain lets go, the next try moves it.
        *f.refuse.deletes_of.lock().unwrap() = None;
        assert_eq!(
            vault.adopt(A, "s1", now()).as_deref(),
            Some("legacy.bearer")
        );
        assert_eq!(f.keychain(A), None);
    }

    #[test]
    fn the_unscoped_slot_round_trips_and_clears() {
        let f = Fixture::new();
        let vault = f.vault();
        vault.set(A, "legacy.bearer");
        assert_eq!(vault.get(A).as_deref(), Some("legacy.bearer"));
        assert_eq!(vault.get(B), None);
        vault.clear(A);
        assert_eq!(vault.get(A), None);
        assert!(!f.disk().contains("legacy"));
    }

    // ── removing a brain ────────────────────────────────────────────────────

    #[test]
    fn remove_profile_leaves_nothing_of_that_brain_and_every_other_alone() {
        let f = Fixture::new();
        let vault = f.vault();
        vault.set(A, "legacy");
        vault.set_for(A, "s1", "a.one", now());
        vault.set_for(A, "s2", "a.two", now());
        vault.set_for(B, "s1", "b.one", now());
        assert!(vault.remove_profile(A), "everything went");
        assert_eq!(f.keychain(A), None);
        assert_eq!(f.keychain(&format!("{A}/s1")), None);
        assert_eq!(f.keychain(&format!("{A}/s2")), None);
        assert!(!f.dir.join("vault").join(format!("{A}.json")).exists());
        assert_eq!(vault.get_for(B, "s1").as_deref(), Some("b.one"));
    }

    /// An entry under this brain's prefix that its index does not name (an
    /// earlier build's, or one written while the index was lost) goes too;
    /// another brain's, another service's and the probe's stay.
    #[test]
    fn remove_profile_sweeps_what_the_index_does_not_name() {
        let f = Fixture::new();
        let vault = f.vault();
        vault.set_for(A, "s1", "a.one", now());
        vault.set_for(B, "s1", "b.one", now());
        let plant = |service: &str, user: &str| {
            f.store
                .build(service, user, None)
                .unwrap()
                .set_password("planted")
                .unwrap();
        };
        plant(SERVICE, &format!("{A}/unindexed"));
        plant(SERVICE, &format!("{B}/unindexed"));
        plant("another.app", &format!("{A}/s1"));
        vault.remove_profile(A);
        assert_eq!(f.keychain(&format!("{A}/s1")), None);
        assert_eq!(f.keychain(&format!("{A}/unindexed")), None);
        assert_eq!(
            f.keychain(&format!("{B}/unindexed")).as_deref(),
            Some("planted")
        );
        assert_eq!(vault.get_for(B, "s1").as_deref(), Some("b.one"));
        let other = f
            .store
            .build("another.app", &format!("{A}/s1"), None)
            .unwrap();
        assert_eq!(other.get_password().unwrap(), "planted");
        assert_eq!(f.told(), 0);
    }

    /// The same in a run with no keychain: the memory store searches too.
    #[test]
    fn remove_profile_sweeps_the_memory_store_too() {
        let f = Fixture::new();
        let vault = f.vault_with(None);
        vault.set_for(A, "s1", "a.one", now());
        vault.set_for(B, "s1", "b.one", now());
        // Written past the index, as an index that was lost would leave it.
        vault
            .store
            .build(SERVICE, &format!("{A}/unindexed"), None)
            .unwrap()
            .set_password("planted")
            .unwrap();
        vault.remove_profile(A);
        assert_eq!(vault.get_for(A, "s1"), None);
        assert_eq!(vault.get_for(A, "unindexed"), None);
        assert_eq!(vault.get_for(B, "s1").as_deref(), Some("b.one"));
    }

    /// A delete the keychain refuses: the removal says it is not done, the
    /// login stays in the index, and the next call (the start's retry)
    /// finishes it. Calling it again once all is gone is harmless.
    #[test]
    fn a_removal_the_keychain_refuses_once_says_so_and_a_retry_finishes_it() {
        let f = Fixture::new();
        let vault = f.vault();
        vault.set(A, "legacy");
        vault.set_for(A, "s1", "a.one", now());
        vault.set_for(A, "s2", "a.two", now());
        vault.set_for(B, "s1", "b.one", now());
        let s1 = format!("{A}/s1");
        *f.refuse.deletes_of.lock().unwrap() = Some(s1.clone());
        assert!(!vault.remove_profile(A), "a refused delete is not done");
        assert_eq!(f.keychain(&s1).as_deref(), Some("a.one"));
        assert_eq!(f.indexed(A), vec!["s1".to_string()]);
        assert_eq!(f.keychain(A), None);
        assert_eq!(f.keychain(&format!("{A}/s2")), None);

        // The keychain answers again: the retry removes what was left.
        *f.refuse.deletes_of.lock().unwrap() = None;
        assert!(vault.remove_profile(A));
        assert_eq!(f.keychain(&s1), None);
        assert!(f.indexed(A).is_empty());
        assert!(!f.dir.join("vault").join(format!("{A}.json")).exists());
        assert!(vault.remove_profile(A), "again, with nothing left");
        assert_eq!(vault.get_for(B, "s1").as_deref(), Some("b.one"));

        // A keychain that will not search cannot say the sweep is done.
        vault.set_for(A, "s3", "a.three", now());
        f.refuse.all.store(true, Ordering::SeqCst);
        assert!(!vault.remove_profile(A));
        f.refuse.all.store(false, Ordering::SeqCst);
        assert!(vault.remove_profile(A));
        assert_eq!(f.keychain(&format!("{A}/s3")), None);
    }

    /// `when` asks under the lock: a call it allows finishes before a
    /// removal waiting on that lock starts, so the removal finds what the
    /// call wrote; a call it refuses does nothing at all.
    #[test]
    fn a_call_allowed_under_the_lock_is_swept_by_a_removal_waiting_on_it() {
        let f = Fixture::new();
        let vault = Arc::new(f.vault());
        let remover = vault.clone();
        let (started_tx, started_rx) = std::sync::mpsc::channel();
        let mut removal = None;
        let done = vault.when(
            || {
                // The brain is removed from the list now: the removal then
                // waits for this call's lock.
                removal = Some(std::thread::spawn(move || {
                    let _ = started_tx.send(());
                    remover.remove_profile(A);
                }));
                started_rx.recv().unwrap();
                true
            },
            |held| held.set_for(A, "s1", "a.one", now()),
        );
        assert_eq!(done, Some(()));
        removal.unwrap().join().unwrap();
        assert_eq!(f.keychain(&format!("{A}/s1")), None);
        assert!(f.indexed(A).is_empty());

        // Refused: nothing written, nothing listed.
        assert_eq!(
            vault.when(|| false, |held| held.set_for(A, "s2", "a.two", now())),
            None
        );
        assert_eq!(f.keychain(&format!("{A}/s2")), None);
        assert!(f.indexed(A).is_empty());
    }

    // ── when the index cannot be written ────────────────────────────────────

    /// The index first: a login whose index cannot be written is not stored
    /// at all (the keychain is not written), so no entry is ever one that
    /// keepOnly and removeProfile cannot find. Not the keychain's fault, so
    /// the keychain notice is not shown.
    #[test]
    fn a_login_whose_index_cannot_be_written_is_not_stored() {
        let f = Fixture::new();
        let vault = f.vault();
        vault.set(A, "legacy");
        // The index folder is a file: nothing can be written under it.
        std::fs::write(f.dir.join("vault"), b"not a folder").unwrap();
        vault.set_for(A, "s1", "a.one", now());
        assert_eq!(f.keychain(&format!("{A}/s1")), None);
        assert_eq!(vault.get_for(A, "s1"), None);
        // adopt does not move the slot either: it stays where it was.
        assert_eq!(vault.adopt(A, "s2", now()), None);
        assert_eq!(f.keychain(&format!("{A}/s2")), None);
        assert_eq!(vault.get(A).as_deref(), Some("legacy"));
        assert_eq!(f.told(), 0);
        // Once the index can be written, the next sign-in is stored.
        std::fs::remove_file(f.dir.join("vault")).unwrap();
        vault.set_for(A, "s1", "a.one", now());
        assert_eq!(vault.get_for(A, "s1").as_deref(), Some("a.one"));
        assert_eq!(f.indexed(A), vec!["s1".to_string()]);
    }

    // ── leftover logins ─────────────────────────────────────────────────────

    #[test]
    fn keep_only_drops_copies_the_page_no_longer_names_and_nothing_else() {
        let f = Fixture::new();
        let vault = f.vault();
        let t = now();
        vault.set(A, "legacy");
        vault.set_for(A, "keep", "a.keep", t);
        vault.set_for(A, "copy1", "a.keep", t);
        vault.set_for(A, "copy2", "a.keep", t);
        vault.set_for(B, "copy1", "a.keep", t);

        vault.keep_only(
            A,
            &["keep".into(), "../escape".into()],
            &["a.keep".into(), "".into()],
            t + LATER,
        );

        assert_eq!(f.indexed(A), vec!["keep".to_string()]);
        assert_eq!(vault.get_for(A, "keep").as_deref(), Some("a.keep"));
        assert_eq!(vault.get_for(A, "copy1"), None);
        assert_eq!(vault.get_for(A, "copy2"), None);
        // The slot and the other brain are not this call's.
        assert_eq!(vault.get(A).as_deref(), Some("legacy"));
        assert_eq!(vault.get_for(B, "copy1").as_deref(), Some("a.keep"));
    }

    #[test]
    fn keep_only_keeps_another_windows_new_login() {
        let f = Fixture::new();
        let vault = f.vault();
        let t = now();
        vault.set_for(A, "keep", "a.keep", t);
        vault.set_for(A, "other-window", "brand.new", t);
        vault.keep_only(A, &["keep".into()], &["a.keep".into()], t + LATER);
        assert_eq!(
            vault.get_for(A, "other-window").as_deref(),
            Some("brand.new")
        );
    }

    #[test]
    fn keep_only_keeps_a_copy_written_in_the_last_two_minutes() {
        let f = Fixture::new();
        let vault = f.vault();
        let t = now();
        vault.set_for(A, "keep", "a.keep", t);
        vault.set_for(A, "just-now", "a.keep", t);
        vault.keep_only(A, &["keep".into()], &["a.keep".into()], t + 60_000);
        assert_eq!(vault.get_for(A, "just-now").as_deref(), Some("a.keep"));
        vault.keep_only(A, &["keep".into()], &["a.keep".into()], t + LATER);
        assert_eq!(vault.get_for(A, "just-now"), None);
    }

    #[test]
    fn keep_only_with_no_bearers_or_no_index_does_nothing() {
        let f = Fixture::new();
        let vault = f.vault();
        let t = now();
        vault.set_for(A, "s1", "a.one", t);
        vault.keep_only(A, &[], &[], t + LATER);
        vault.keep_only(A, &[], &["".into()], t + LATER);
        assert_eq!(vault.get_for(A, "s1").as_deref(), Some("a.one"));
        vault.keep_only(B, &[], &["x".into()], t + LATER);
    }

    #[test]
    fn an_entry_gone_from_the_keychain_leaves_the_index() {
        let f = Fixture::new();
        let vault = f.vault();
        let t = now();
        vault.set_for(A, "s1", "a.one", t);
        f.store
            .build(SERVICE, &format!("{A}/s1"), None)
            .unwrap()
            .delete_credential()
            .unwrap();
        assert_eq!(vault.get_for(A, "s1"), None);
        vault.keep_only(A, &[], &["x".into()], t + LATER);
        assert!(f.indexed(A).is_empty());
    }

    // ── when the keychain says no ───────────────────────────────────────────

    #[test]
    fn a_refused_write_is_not_stored_and_the_next_read_tells_the_truth() {
        let f = Fixture::new();
        let vault = f.vault();
        vault.set_for(A, "s1", "a.one", now());
        f.refuse.writes.store(true, Ordering::SeqCst);
        vault.set_for(A, "s2", "a.two", now());
        vault.set_for(A, "s1", "a.rotated", now());
        // Nothing held anywhere but the keychain: s2 is not there, and s1 is
        // what the keychain still has.
        assert_eq!(vault.get_for(A, "s2"), None);
        assert_eq!(vault.get_for(A, "s1").as_deref(), Some("a.one"));
        assert!(!f.disk().contains("a.two"));
        assert_eq!(f.told(), 1, "told once, however often it fails");
        f.refuse.writes.store(false, Ordering::SeqCst);
        vault.set_for(A, "s2", "a.two", now());
        assert_eq!(vault.get_for(A, "s2").as_deref(), Some("a.two"));
    }

    #[test]
    fn a_keychain_that_will_not_answer_reads_as_nothing_and_says_so_once() {
        let f = Fixture::new();
        let vault = f.vault();
        vault.set_for(A, "s1", "a.one", now());
        vault.set(A, "legacy");
        f.refuse.all.store(true, Ordering::SeqCst);
        assert_eq!(vault.get_for(A, "s1"), None);
        assert_eq!(vault.get(A), None);
        assert_eq!(vault.adopt(A, "s2", now()), None);
        vault.clear_for(A, "s1");
        // A delete that failed keeps the login listed, to be found again.
        assert_eq!(f.indexed(A), vec!["s1".to_string()]);
        assert_eq!(f.told(), 1);
        f.refuse.all.store(false, Ordering::SeqCst);
        assert_eq!(vault.get_for(A, "s1").as_deref(), Some("a.one"));
    }

    #[test]
    fn a_failing_keychain_is_told_as_a_failure_not_as_no_keychain() {
        let f = Fixture::new();
        let vault = f.vault();
        assert!(!vault.this_run_only());
        f.refuse.writes.store(true, Ordering::SeqCst);
        vault.set_for(A, "s1", "a.one", now());
        assert_eq!(f.told_why(), vec![Unavailable::KeychainFailed]);
    }

    // ── no keychain: this run only ──────────────────────────────────────────

    /// A run with no keychain: the same calls, the same answers, all in
    /// memory. Nothing reaches the disk, and the next run starts empty.
    #[test]
    fn no_keychain_keeps_logins_for_this_run_only_and_writes_nothing_to_disk() {
        let f = Fixture::new();
        let vault = f.vault_with(None);
        assert!(vault.this_run_only());
        let t = now();

        // A sign-in works, and reads back from the one copy.
        vault.set_for(A, "s1", "a.one", t);
        assert_eq!(vault.get_for(A, "s1").as_deref(), Some("a.one"));
        vault.set_for(A, "s1", "a.rotated", t);
        assert_eq!(vault.get_for(A, "s1").as_deref(), Some("a.rotated"));
        vault.set_for(B, "s1", "b.one", t);
        assert_eq!(vault.get_for(B, "s1").as_deref(), Some("b.one"));

        // The page's id is still not trusted.
        vault.set_for(A, "../b", "x", t);
        assert_eq!(vault.get_for(A, "../b"), None);
        vault.set_for(A, "s9", &"t".repeat(MAX_TOKEN_BYTES + 1), t);
        assert_eq!(vault.get_for(A, "s9"), None);

        // adopt is a move, and a login with its own bearer keeps it.
        vault.set(A, "legacy");
        assert_eq!(vault.adopt(A, "s1", t).as_deref(), Some("a.rotated"));
        assert_eq!(vault.get(A).as_deref(), Some("legacy"));
        assert_eq!(vault.adopt(A, "s2", t).as_deref(), Some("legacy"));
        assert_eq!(vault.get(A), None);
        assert_eq!(vault.get_for(A, "s2").as_deref(), Some("legacy"));

        // keepOnly walks the in-memory index with the same grace.
        vault.set_for(A, "copy", "a.rotated", t);
        vault.keep_only(
            A,
            &["s1".into(), "s2".into()],
            &["a.rotated".into()],
            t + 60_000,
        );
        assert_eq!(vault.get_for(A, "copy").as_deref(), Some("a.rotated"));
        vault.keep_only(
            A,
            &["s1".into(), "s2".into()],
            &["a.rotated".into()],
            t + LATER,
        );
        assert_eq!(vault.get_for(A, "copy"), None);
        assert_eq!(vault.get_for(A, "s1").as_deref(), Some("a.rotated"));

        // clearFor and removing a brain.
        vault.clear_for(A, "s2");
        assert_eq!(vault.get_for(A, "s2"), None);
        vault.remove_profile(A);
        assert_eq!(vault.get_for(A, "s1"), None);
        assert_eq!(vault.get_for(B, "s1").as_deref(), Some("b.one"));

        // Nothing on disk: no index, no bearer.
        assert!(!f.dir.join("vault").exists());
        assert_eq!(f.disk(), "");

        // The next run starts with nothing.
        let next = f.vault_with(None);
        assert_eq!(next.get_for(B, "s1"), None);
        assert_eq!(next.get(A), None);

        // The shell tells the user at start; the calls do not repeat it.
        assert_eq!(f.told(), 0);
        vault.tell_unavailable();
        vault.tell_unavailable();
        assert_eq!(f.told_why(), vec![Unavailable::NoKeychain]);
    }

    /// A keychain that is there but will not answer when the vault is made
    /// counts as none: memory for the run, and the keychain is never written.
    #[test]
    fn a_keychain_that_fails_at_start_is_replaced_by_memory_for_the_run() {
        let f = Fixture::new();
        f.refuse.all.store(true, Ordering::SeqCst);
        let vault = f.vault();
        assert!(vault.this_run_only());
        // It answers again later in the run: still not used, the memory store
        // is this run's only copy.
        f.refuse.all.store(false, Ordering::SeqCst);
        vault.set_for(A, "s1", "a.one", now());
        vault.set(A, "legacy");
        assert_eq!(vault.get_for(A, "s1").as_deref(), Some("a.one"));
        assert_eq!(vault.get(A).as_deref(), Some("legacy"));
        assert!(!f.keychain_has_any(&[A, &format!("{A}/s1"), PROBE_USER]));
        assert_eq!(f.disk(), "");
        assert_eq!(f.told(), 0, "nothing failed during the run");
        vault.tell_unavailable();
        assert_eq!(f.told_why(), vec![Unavailable::NoKeychain]);
    }

    /// Only a read that fails makes the keychain count as none: an empty
    /// keychain, or one holding logins already, is used.
    #[test]
    fn a_keychain_that_answers_at_start_is_used() {
        let f = Fixture::new();
        f.vault().set_for(A, "s1", "a.one", now());
        let vault = f.vault();
        assert!(!vault.this_run_only());
        assert_eq!(vault.get_for(A, "s1").as_deref(), Some("a.one"));
        assert_eq!(f.keychain(PROBE_USER), None, "the probe writes nothing");
    }

    /// The notice is never shown under the lock: a callback that calls back
    /// into the vault (as a UI run loop could) finishes instead of hanging.
    #[test]
    fn the_notice_runs_after_the_lock_is_released() {
        let f = Fixture::new();
        let slot: Arc<Mutex<Option<Arc<Vault>>>> = Arc::new(Mutex::new(None));
        let inner = slot.clone();
        let reentered = Arc::new(AtomicBool::new(false));
        let flag = reentered.clone();
        let store = Arc::new(Flaky {
            inner: f.store.clone(),
            refuse: f.refuse.clone(),
        });
        let vault = Arc::new(Vault::new(
            SERVICE,
            &f.dir,
            Some(store as Arc<CredentialStore>),
            Box::new(move |_| {
                let vault = inner.lock().unwrap().clone().unwrap();
                let _ = vault.get_for(A, "s1");
                flag.store(true, Ordering::SeqCst);
            }),
            false,
        ));
        *slot.lock().unwrap() = Some(vault.clone());
        f.refuse.writes.store(true, Ordering::SeqCst);
        let (done_tx, done_rx) = std::sync::mpsc::channel();
        let worker = vault.clone();
        std::thread::spawn(move || {
            worker.set_for(A, "s1", "a.one", now());
            let _ = done_tx.send(());
        });
        assert!(
            done_rx
                .recv_timeout(std::time::Duration::from_secs(5))
                .is_ok(),
            "the vault deadlocked on its own notice"
        );
        assert!(reentered.load(Ordering::SeqCst));
        *slot.lock().unwrap() = None;
    }
}
